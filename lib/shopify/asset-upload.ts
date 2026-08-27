import { randomUUID, createHash } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { executeAdminGraphQL, assertNoUserErrors } from "@/lib/shopify/admin-client";
import { PublishError } from "@/lib/shopify/errors";
import { createFsTemplateReader } from "@/lib/preview/fs-template-reader";
import { loadSectionSchema, loadBlockSchema, ShopifySettingDef } from "@/lib/preview/section-schema";
import type { ShopifyBlock } from "@/lib/preview/shopify-template";
import { PAGE_TEMPLATES, StoreConfiguration } from "@/lib/store-config/store";

// Shopify's themeFilesUpsert rejects any image_picker/video/image setting that isn't a real
// shopify://shop_images/<file> reference — plain external URLs and data: URIs (which is what
// every image setting in this app holds today: product photos, AI-generated images, and the
// "Your media" picker's picks) are rejected outright, one error per setting. This module uploads
// each one into the connected shop's own Files library at publish time and rewrites the setting.

const UPLOADABLE_SETTING_TYPES = new Set(["image_picker", "image", "video"]);
const ALREADY_SHOPIFY_HOSTED = /^shopify:\/\//;

type ShopifyContentType = "IMAGE" | "VIDEO";

interface UploadTarget {
  apply: (value: string) => void;
  value: string;
  contentType: ShopifyContentType;
}

const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "webm", "avi", "m4v"]);
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "avif", "svg", "bmp"]);

/** The schema's declared setting type (image_picker/image/video) doesn't reliably match the
 * actual content — this app's own generation pipeline isn't always careful keeping video-typed
 * settings pointed at a real video (confirmed live: several "video" settings in a real project
 * hold plain .png URLs). Detect the real content type from the value itself — the file extension
 * for a URL, the mime type for a data: URI — returning null when neither is recognized. */
function detectContentType(value: string): ShopifyContentType | null {
  const mimeMatch = /^data:([^;,]+)/.exec(value);
  if (mimeMatch) {
    if (mimeMatch[1].startsWith("video/")) return "VIDEO";
    if (mimeMatch[1].startsWith("image/")) return "IMAGE";
    return null;
  }
  const ext = value.split(/[?#]/)[0].split(".").pop()?.toLowerCase();
  if (ext && VIDEO_EXTENSIONS.has(ext)) return "VIDEO";
  if (ext && IMAGE_EXTENSIONS.has(ext)) return "IMAGE";
  return null;
}

/** Walks both page templates' sections and (recursively nested) blocks, collecting every
 * image/video setting whose value needs uploading — i.e. isn't blank and isn't already a
 * shopify:// reference. Loads real per-type {% schema %} JSON off disk (not the curated AI
 * catalog, which only covers a subset of sections) via the same section-schema loader the
 * editor's own Inspector uses, just with the server-side file reader instead of the browser one. */
async function collectUploadTargets(config: StoreConfiguration): Promise<UploadTarget[]> {
  const readTemplate = createFsTemplateReader();
  const targets: UploadTarget[] = [];

  const collectFromSettings = (settings: Record<string, unknown>, defs: ShopifySettingDef[]) => {
    for (const def of defs) {
      if (!def.id) continue;
      // Unrelated to asset upload, but this walk already has every setting's schema type in
      // hand — cheapest place to fix it. Confirmed live: a range-typed setting can hold a
      // numeric-looking string ("1") instead of a real number, which themeFilesUpsert rejects
      // outright ("must be a valid number") for the whole push, same as an unresolved image.
      if ((def.type === "range" || def.type === "number") && typeof settings[def.id] === "string") {
        const numeric = Number(settings[def.id]);
        if (!Number.isNaN(numeric)) settings[def.id] = numeric;
        continue;
      }
      if (!UPLOADABLE_SETTING_TYPES.has(def.type)) continue;
      const value = settings[def.id];
      if (typeof value !== "string" || !value || ALREADY_SHOPIFY_HOSTED.test(value)) continue;
      const settingId = def.id;
      const detected = detectContentType(value);
      if (def.type === "video" && detected !== "VIDEO") {
        // A video-typed setting whose content genuinely isn't a video can't be made to satisfy
        // Shopify's validation no matter what it's uploaded as (confirmed live both ways: as
        // VIDEO, fileCreate itself rejects it — "Invalid video url"; as IMAGE, themeFilesUpsert
        // still rejects the setting — "does not point to an applicable shopify-hosted video
        // resource"). Every section using a video setting already falls back to its image
        // setting when video is blank (e.g. image-with-text.liquid's video/image/placeholder
        // branches) — blanking it is what makes the section render correctly instead of
        // failing the whole publish over a setting that was never fixable here.
        settings[settingId] = "";
        continue;
      }
      targets.push({
        apply: (next) => {
          settings[settingId] = next;
        },
        value,
        contentType: detected ?? "IMAGE",
      });
    }
  };

  // Traditional (pre-theme-blocks) sections declare their blocks' settings inline, in the
  // section's own {% schema %}.blocks[] array — confirmed live: blocks/column.liquid (the
  // standalone, newer-architecture "Column" theme block) has entirely different settings than
  // the "column" block testimonials.liquid declares inline for itself (image/video/author_avatar
  // vs. width/border/shadow), same type name, different schema. But an inline blocks[] entry can
  // ALSO be just `{ "type": "..." }` with no settings key at all — confirmed live in
  // main-product.liquid's own "product_quantity-gifts" entry — meaning "look up the real
  // standalone file", not "this block has zero settings". Only build the inline map from entries
  // that actually declare a settings array; anything else (not present, or present but
  // settings-less) falls back to loadBlockSchema.
  const inlineBlockMap = (schema: { blocks?: { type: string; settings?: ShopifySettingDef[] }[] } | null) =>
    new Map((schema?.blocks ?? []).filter((b) => b.settings).map((b) => [b.type, b.settings!]));

  const visitBlocks = async (blocks: Record<string, ShopifyBlock> | undefined, inlineDefs: Map<string, ShopifySettingDef[]>) => {
    for (const block of Object.values(blocks ?? {})) {
      const inline = inlineDefs.get(block.type);
      if (inline) {
        collectFromSettings(block.settings, inline);
        // Inline-declared blocks carry no schema of their own for a deeper level of nesting —
        // that only exists for genuine standalone block files.
        await visitBlocks(block.blocks, new Map());
      } else {
        const schema = await loadBlockSchema(readTemplate, block.type);
        if (schema) collectFromSettings(block.settings, schema.settings);
        await visitBlocks(block.blocks, inlineBlockMap(schema));
      }
    }
  };

  for (const page of PAGE_TEMPLATES) {
    for (const section of Object.values(config.templates[page].sections)) {
      const schema = await loadSectionSchema(readTemplate, section.type);
      if (schema) collectFromSettings(section.settings, schema.settings);
      await visitBlocks(section.blocks, inlineBlockMap(schema));
    }
  }

  return targets;
}

interface StagedTarget {
  url: string;
  resourceUrl: string;
  parameters: { name: string; value: string }[];
}

interface StagedUploadsCreateData {
  stagedUploadsCreate: {
    stagedTargets: StagedTarget[];
    userErrors: { field?: string[] | null; message: string }[];
  };
}

/** data: URIs aren't hosted anywhere Shopify can fetch from, so they need the same
 * stage-then-reference two-step lib/shopify/publish.ts's stageBaseThemeZip already does for the
 * theme zip, just with resource IMAGE/VIDEO instead of FILE. Returns a resourceUrl usable as
 * fileCreate's originalSource. */
async function stageDataUri(
  shopDomain: string,
  accessToken: string,
  dataUri: string,
  contentType: ShopifyContentType,
): Promise<string> {
  const match = /^data:([^;,]+)(?:;charset=[^;,]+)?;base64,([\s\S]+)$/.exec(dataUri);
  if (!match) throw new PublishError("Could not parse a data: URI image setting — unrecognized format.");
  const [, mimeType, base64] = match;
  const bytes = Buffer.from(base64, "base64");
  const filename = `shopforge-${randomUUID()}.${mimeType.split("/")[1] || "bin"}`;

  const staged = await executeAdminGraphQL<StagedUploadsCreateData>(
    shopDomain,
    accessToken,
    `mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets { url resourceUrl parameters { name value } }
        userErrors { field message }
      }
    }`,
    { input: [{ filename, mimeType, httpMethod: "POST", resource: contentType, fileSize: String(bytes.length) }] },
  );
  assertNoUserErrors(staged.stagedUploadsCreate.userErrors, "stagedUploadsCreate");
  const target = staged.stagedUploadsCreate.stagedTargets[0];
  if (!target) throw new PublishError("Shopify returned no staged upload target for an image setting.");

  const formData = new FormData();
  for (const param of target.parameters) formData.append(param.name, param.value);
  formData.append("file", new Blob([new Uint8Array(bytes)], { type: mimeType }), filename);

  const uploadRes = await fetch(target.url, { method: "POST", body: formData });
  if (!uploadRes.ok) {
    const body = await uploadRes.text().catch(() => "");
    throw new PublishError(
      `Uploading an image setting to Shopify failed: ${uploadRes.status} ${uploadRes.statusText} — ${body.slice(0, 300)}`,
    );
  }
  return target.resourceUrl;
}

interface FileCreateData {
  fileCreate: {
    files: { id: string; fileStatus: string }[];
    userErrors: { field?: string[] | null; message: string }[];
  };
}

interface FileStatusNode {
  id: string;
  fileStatus: string;
  image?: { url: string } | null;
  filename?: string | null;
}

interface FileStatusData {
  node: FileStatusNode | null;
}

const FILE_PROCESSING_POLL_MS = 1000;
const FILE_PROCESSING_TIMEOUT_MS = 60_000;

/** Mirrors publish.ts's waitForThemeProcessed — a freshly created File isn't queryable-as-ready
 * immediately either (confirmed live: FileStatus is UPLOADED/PROCESSING right after fileCreate,
 * READY once Shopify finishes generating CDN derivatives). Returns the final filename Shopify
 * assigned once ready — the shopify://shop_images/<filename> reference needs the ACTUAL
 * filename, which duplicateResolutionMode may have changed from what was requested. */
async function waitForFileReady(shopDomain: string, accessToken: string, fileId: string): Promise<string> {
  const deadline = Date.now() + FILE_PROCESSING_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const result = await executeAdminGraphQL<FileStatusData>(
      shopDomain,
      accessToken,
      `query fileStatus($id: ID!) {
        node(id: $id) {
          ... on MediaImage { id fileStatus image { url } }
          ... on Video { id fileStatus filename }
        }
      }`,
      { id: fileId },
    );
    const node = result.node;
    if (node?.fileStatus === "FAILED") throw new PublishError(`Shopify failed to process an uploaded image (file ${fileId}).`);
    if (node?.fileStatus === "READY") {
      // MediaImage exposes no bare filename field — Video does. Either way, this is the one
      // in-repo-confirmed source of the real assigned filename (lib/shopify-compat's own
      // shopify://shop_images/<filename> parsing is the read-side counterpart of this format).
      const filename = node.filename ?? (node.image?.url ? new URL(node.image.url).pathname.split("/").pop() : null);
      if (filename) return filename;
      throw new PublishError(`Shopify marked an uploaded file ready but returned no filename (file ${fileId}).`);
    }
    await new Promise((resolve) => setTimeout(resolve, FILE_PROCESSING_POLL_MS));
  }
  throw new PublishError("Timed out waiting for Shopify to finish processing an uploaded image.");
}

async function uploadAsset(
  shopDomain: string,
  accessToken: string,
  value: string,
  contentType: ShopifyContentType,
): Promise<string> {
  const originalSource = value.startsWith("data:") ? await stageDataUri(shopDomain, accessToken, value, contentType) : value;

  const created = await executeAdminGraphQL<FileCreateData>(
    shopDomain,
    accessToken,
    `mutation fileCreate($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files { id fileStatus }
        userErrors { field message }
      }
    }`,
    { files: [{ originalSource, contentType, duplicateResolutionMode: "APPEND_UUID" }] },
  );
  assertNoUserErrors(created.fileCreate.userErrors, "fileCreate");
  const file = created.fileCreate.files[0];
  if (!file) throw new PublishError("fileCreate returned no file for an image setting.");

  const filename = await waitForFileReady(shopDomain, accessToken, file.id);
  return `shopify://shop_images/${filename}`;
}

function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const UPLOAD_CONCURRENCY = 4;

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Returns a copy of `config` with every image_picker/video/image setting that isn't already
 * shopify-hosted rewritten to a real shopify://shop_images/<file> reference, uploading whatever
 * isn't already cached for this store. Never mutates `config` itself — the caller (publish.ts)
 * pushes this rewritten copy to Shopify while project.configurationJson, and the editor's own
 * preview, keep the original URLs untouched.
 */
export async function resolveProjectAssets(
  shopifyStoreId: string,
  shopDomain: string,
  accessToken: string,
  config: StoreConfiguration,
): Promise<StoreConfiguration> {
  const resolved: StoreConfiguration = JSON.parse(JSON.stringify(config));
  const targets = await collectUploadTargets(resolved);
  if (targets.length === 0) return resolved;

  // Same source value can (and very often does) appear in many settings — resolve each unique
  // value once, not once per occurrence.
  const uniqueByHash = new Map<string, { value: string; contentType: ShopifyContentType }>();
  for (const target of targets) {
    const hash = hashValue(target.value);
    if (!uniqueByHash.has(hash)) uniqueByHash.set(hash, { value: target.value, contentType: target.contentType });
  }

  const cached = await prisma.shopifyUploadedAsset.findMany({
    where: { shopifyStoreId, sourceUrlHash: { in: [...uniqueByHash.keys()] } },
  });
  const referenceByHash = new Map(cached.map((row) => [row.sourceUrlHash, row.shopifyReference]));

  const misses = [...uniqueByHash.entries()].filter(([hash]) => !referenceByHash.has(hash));
  const failures: { value: string; error: string }[] = [];

  await mapWithConcurrency(misses, UPLOAD_CONCURRENCY, async ([hash, { value, contentType }]) => {
    try {
      const reference = await uploadAsset(shopDomain, accessToken, value, contentType);
      referenceByHash.set(hash, reference);
      await prisma.shopifyUploadedAsset.upsert({
        where: { shopifyStoreId_sourceUrlHash: { shopifyStoreId, sourceUrlHash: hash } },
        create: { shopifyStoreId, sourceUrlHash: hash, shopifyReference: reference },
        update: { shopifyReference: reference },
      });
    } catch (err) {
      failures.push({ value: value.slice(0, 80), error: err instanceof Error ? err.message : String(err) });
    }
  });

  if (failures.length > 0) {
    throw new PublishError(
      `Failed to upload ${failures.length} image/video setting(s) to Shopify: ` +
        failures.map((f) => `"${f.value}…" — ${f.error}`).join("; "),
    );
  }

  for (const target of targets) {
    const reference = referenceByHash.get(hashValue(target.value));
    if (reference) target.apply(reference);
  }

  return resolved;
}
