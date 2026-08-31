import { prisma } from "@/lib/db/prisma";
import { getValidAccessToken } from "@/lib/shopify/token-refresh";
import { executeAdminGraphQL, assertNoUserErrors, AdminApiError } from "@/lib/shopify/admin-client";
import { buildBaseThemeZip } from "@/lib/shopify/theme-bundle";
import { resolveProjectAssets } from "@/lib/shopify/asset-upload";
import { PublishError } from "@/lib/shopify/errors";
import { parseConfiguration, PAGE_TEMPLATES, StoreConfiguration } from "@/lib/store-config/store";

export { PublishError };

export interface ThemeFileInput {
  filename: string;
  body: { type: "TEXT"; value: string };
}

/** configurationJson is already Shopify-native template JSON (lib/preview/shopify-template.ts)
 * — this just serializes each page template to the theme file Shopify expects it at. */
export function buildTemplateFiles(config: StoreConfiguration): ThemeFileInput[] {
  return PAGE_TEMPLATES.map((page) => ({
    filename: `templates/${page}.json`,
    body: { type: "TEXT", value: JSON.stringify(config.templates[page]) },
  }));
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

interface ThemeCreateData {
  themeCreate: {
    theme: { id: string; name: string; role: string } | null;
    userErrors: { field?: string[] | null; message: string }[];
  };
}

interface ThemeFilesUpsertData {
  themeFilesUpsert: {
    upsertedThemeFiles: { filename: string }[];
    userErrors: { field?: string[] | null; message: string }[];
  };
}

interface ThemePublishData {
  themePublish: {
    theme: { id: string; name: string } | null;
    userErrors: { field?: string[] | null; message: string }[];
  };
}

interface ThemeProcessingData {
  theme: { id: string; processing: boolean } | null;
}

const THEME_PROCESSING_POLL_MS = 1000;
const THEME_PROCESSING_TIMEOUT_MS = 60_000;

/**
 * themeCreate returns as soon as Shopify accepts the zip, not once it's done extracting it —
 * the theme's files (including every section .liquid the JSON templates reference) stay
 * unqueryable for a few seconds after that, so a themeFilesUpsert called immediately after
 * themeCreate fails with "Section type '...' does not refer to an existing section file" for
 * every section, even though the same theme works seconds later. Confirmed directly against a
 * real store: `theme { processing }` is true right after creation, false ~1-2 minutes on.
 */
async function waitForThemeProcessed(shopDomain: string, accessToken: string, themeId: string): Promise<void> {
  const deadline = Date.now() + THEME_PROCESSING_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const result = await executeAdminGraphQL<ThemeProcessingData>(
      shopDomain,
      accessToken,
      `query themeProcessing($id: ID!) { theme(id: $id) { id processing } }`,
      { id: themeId },
    );
    if (result.theme && !result.theme.processing) return;
    await new Promise((resolve) => setTimeout(resolve, THEME_PROCESSING_POLL_MS));
  }
  throw new PublishError("Timed out waiting for Shopify to finish processing the installed theme.");
}

async function stageBaseThemeZip(shopDomain: string, accessToken: string): Promise<string> {
  const zipBuffer = await buildBaseThemeZip();

  const staged = await executeAdminGraphQL<StagedUploadsCreateData>(
    shopDomain,
    accessToken,
    `mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets { url resourceUrl parameters { name value } }
        userErrors { field message }
      }
    }`,
    {
      input: [
        {
          filename: "base-theme.zip",
          mimeType: "application/zip",
          httpMethod: "POST",
          // "THEME" isn't a valid resource value — Shopify's own schema error enumerated the
          // real options (COLLECTION_IMAGE, FILE, IMAGE, MODEL_3D, PRODUCT_IMAGE, SHOP_IMAGE,
          // VIDEO, ...); "FILE" is the generic bucket a theme zip belongs to.
          resource: "FILE",
          // Without this, the generated upload policy's max-size condition defaults far below
          // this bundle's real size, and the storage backend rejects the upload as EntityTooLarge.
          fileSize: String(zipBuffer.length),
        },
      ],
    },
  );
  assertNoUserErrors(staged.stagedUploadsCreate.userErrors, "stagedUploadsCreate");
  const target = staged.stagedUploadsCreate.stagedTargets[0];
  if (!target) throw new PublishError("Shopify returned no staged upload target for the theme bundle.");

  const formData = new FormData();
  for (const param of target.parameters) formData.append(param.name, param.value);
  formData.append("file", new Blob([new Uint8Array(zipBuffer)], { type: "application/zip" }), "base-theme.zip");

  const uploadRes = await fetch(target.url, { method: "POST", body: formData });
  if (!uploadRes.ok) {
    const body = await uploadRes.text().catch(() => "");
    throw new PublishError(
      `Uploading the theme bundle to Shopify failed: ${uploadRes.status} ${uploadRes.statusText} — ${body.slice(0, 500)}`,
    );
  }

  return target.resourceUrl;
}

async function ensureInstalledTheme(
  projectId: string,
  installedThemeShopifyId: string | null,
  shopDomain: string,
  accessToken: string,
): Promise<string> {
  if (installedThemeShopifyId) return installedThemeShopifyId;

  const resourceUrl = await stageBaseThemeZip(shopDomain, accessToken);

  const created = await executeAdminGraphQL<ThemeCreateData>(
    shopDomain,
    accessToken,
    `mutation themeCreate($name: String!, $source: URL!) {
      themeCreate(name: $name, source: $source) {
        theme { id name role }
        userErrors { field message }
      }
    }`,
    { name: "Shopforge", source: resourceUrl },
  );
  assertNoUserErrors(created.themeCreate.userErrors, "themeCreate");
  const theme = created.themeCreate.theme;
  if (!theme) throw new PublishError("themeCreate returned no theme.");

  await waitForThemeProcessed(shopDomain, accessToken, theme.id);

  await prisma.project.update({
    where: { id: projectId },
    data: { installedThemeShopifyId: theme.id },
  });

  return theme.id;
}

/** Pushes the given Store Configuration's two page templates onto the given theme. Takes an
 * already-resolved config (see resolveProjectAssets) rather than parsing configurationJson
 * itself, so the caller controls whether the raw project config or an asset-rewritten copy
 * of it gets pushed. */
async function pushConfigurationJson(
  shopDomain: string,
  accessToken: string,
  themeId: string,
  config: StoreConfiguration,
): Promise<void> {
  const files = buildTemplateFiles(config);

  const upserted = await executeAdminGraphQL<ThemeFilesUpsertData>(
    shopDomain,
    accessToken,
    `mutation themeFilesUpsert($themeId: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) {
      themeFilesUpsert(themeId: $themeId, files: $files) {
        upsertedThemeFiles { filename }
        userErrors { field message }
      }
    }`,
    { themeId, files },
  );
  assertNoUserErrors(upserted.themeFilesUpsert.userErrors, "themeFilesUpsert");
}

async function publishTheme(shopDomain: string, accessToken: string, themeId: string): Promise<void> {
  const published = await executeAdminGraphQL<ThemePublishData>(
    shopDomain,
    accessToken,
    `mutation themePublish($id: ID!) {
      themePublish(id: $id) {
        theme { id name }
        userErrors { field message }
      }
    }`,
    { id: themeId },
  );
  assertNoUserErrors(published.themePublish.userErrors, "themePublish");
}

export interface PublishResult {
  status: "success";
  shopifyThemeId: string;
  storeUrl: string;
}

/**
 * Installs the Base Theme on first publish (or reuses the previously installed one), pushes the
 * project's current Store Configuration onto it, and publishes it live. Synchronous end-to-end —
 * reasonable for the small file count a publish actually writes per call (see plan doc for why
 * this doesn't need the full async job/polling contract docs/product-spec/14 describes).
 */
export async function publishProjectToShopify(projectId: string): Promise<PublishResult> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { store: { include: { shopifyStore: true } } },
  });
  if (!project) throw new PublishError("Project not found.");
  if (!project.store.shopifyStore) {
    throw new PublishError("This project isn't connected to a Shopify store yet.");
  }

  const { shopDomain } = project.store.shopifyStore;
  // Theme-write calls require Shopify's separate write_themes exemption on top of the OAuth
  // scope, which can take weeks to be granted (docs/product-spec/21-security-and-multi-tenancy.md
  // §5). Try the OAuth token for the store this project is actually connected to first — a
  // Theme Access password is per-store (generated from Shopify's own "Theme Access" app, scoped
  // to exactly read_themes/write_themes) and only ever a stand-in for the exemption above, so
  // it's the fallback here, not the default: preferring it unconditionally would silently
  // publish through whichever single store SHOPIFY_THEME_ACCESS_PASSWORD happens to be scoped
  // to, regardless of which store was actually connected. Used only here, never for product
  // listing (lib/shopify/products.ts), since it grants no read_products access.
  //
  // A valid-looking OAuth token doesn't guarantee the exemption — Shopify only reveals that by
  // rejecting the actual API call (AdminApiError), not while just reading the stored token — so
  // both candidates are tried in order against the real calls below, not decided upfront.
  const accessTokenCandidates: string[] = [];
  try {
    accessTokenCandidates.push(await getValidAccessToken(project.store.shopifyStore));
  } catch {
    // No usable OAuth token for this store — fall through to the Theme Access password, if any.
  }
  if (process.env.SHOPIFY_THEME_ACCESS_PASSWORD) accessTokenCandidates.push(process.env.SHOPIFY_THEME_ACCESS_PASSWORD);
  if (accessTokenCandidates.length === 0) {
    throw new PublishError("No usable Shopify access token — reconnect the store, or set SHOPIFY_THEME_ACCESS_PASSWORD.");
  }

  const baseConfig = parseConfiguration(project.configurationJson);

  let record = await prisma.publishRecord.create({
    data: { projectId, shopifyThemeId: project.installedThemeShopifyId ?? "", status: "pending" },
  });

  try {
    let themeId: string | null = null;
    let lastErr: unknown;
    for (const accessToken of accessTokenCandidates) {
      try {
        // Re-read rather than reuse project.installedThemeShopifyId: an earlier candidate in
        // this same loop may have already created and saved the theme before failing on a
        // later call, and a stale null here would create a second one on retry.
        const current = await prisma.project.findUnique({
          where: { id: projectId },
          select: { installedThemeShopifyId: true },
        });
        themeId = await ensureInstalledTheme(projectId, current?.installedThemeShopifyId ?? null, shopDomain, accessToken);
        // Every image_picker/video/image setting must point at a real Shopify-hosted file —
        // themeFilesUpsert rejects the whole push otherwise. Upload whatever isn't already a
        // shopify:// reference and push that rewritten copy; project.configurationJson (and the
        // editor's own preview, which needs the original URLs) is never touched.
        const resolvedConfig = await resolveProjectAssets(project.store.shopifyStore.id, shopDomain, accessToken, baseConfig);
        await pushConfigurationJson(shopDomain, accessToken, themeId, resolvedConfig);
        await publishTheme(shopDomain, accessToken, themeId);
        lastErr = null;
        break;
      } catch (err) {
        themeId = null;
        lastErr = err;
        // Only an API-level rejection (wrong permissions, wrong store) is worth retrying with
        // the next candidate token — anything else (missing project, bad config) will fail the
        // same way regardless of which token is used.
        if (!(err instanceof AdminApiError)) throw err;
      }
    }
    if (lastErr) throw lastErr;
    if (!themeId) throw new PublishError("Publish finished without a theme ID — this should be unreachable.");

    record = await prisma.publishRecord.update({
      where: { id: record.id },
      data: { status: "success", shopifyThemeId: themeId },
    });

    // This theme is now the one live on the shop — mirror that locally so the dashboard/theme
    // list can show an accurate Active badge without an extra Shopify API round-trip.
    await prisma.store.update({
      where: { id: project.storeId },
      data: { activeThemeId: projectId },
    });

    return { status: "success", shopifyThemeId: themeId, storeUrl: `https://${shopDomain}` };
  } catch (err) {
    // Always log the real error server-side and surface its actual message — silently
    // replacing it with a generic string here made every failure indistinguishable.
    console.error("Shopify publish failed:", err);
    const message = err instanceof Error ? err.message : "Publish failed unexpectedly.";
    await prisma.publishRecord.update({
      where: { id: record.id },
      data: { status: "failed", errorMessage: message },
    });
    throw err instanceof PublishError || err instanceof AdminApiError ? err : new PublishError(message);
  }
}
