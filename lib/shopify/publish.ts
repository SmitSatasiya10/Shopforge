import { prisma } from "@/lib/db/prisma";
import { getValidAccessToken } from "@/lib/shopify/token-refresh";
import { executeAdminGraphQL, assertNoUserErrors, AdminApiError } from "@/lib/shopify/admin-client";
import { buildBaseThemeZip } from "@/lib/shopify/theme-bundle";
import { parseConfiguration, PAGE_TEMPLATES, StoreConfiguration } from "@/lib/store-config/store";

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

export class PublishError extends Error {}

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

  await prisma.project.update({
    where: { id: projectId },
    data: { installedThemeShopifyId: theme.id },
  });

  return theme.id;
}

/** Pushes the project's current Store Configuration's two page templates onto the given theme. */
async function pushConfigurationJson(
  shopDomain: string,
  accessToken: string,
  themeId: string,
  configurationJson: unknown,
): Promise<void> {
  const config = parseConfiguration(configurationJson);
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
    include: { shopifyStore: true },
  });
  if (!project) throw new PublishError("Project not found.");
  if (!project.shopifyStore) {
    throw new PublishError("This project isn't connected to a Shopify store yet.");
  }

  const { shopDomain } = project.shopifyStore;
  // Theme-write calls require Shopify's separate write_themes exemption on top of the OAuth
  // scope, which can take weeks to be granted (docs/product-spec/21-security-and-multi-tenancy.md
  // §5). A Theme Access password — generated per-store from Shopify's own "Theme Access" app,
  // scoped to exactly read_themes/write_themes — is Shopify's documented workaround for testing
  // theme pushes before that exemption lands, and authenticates identically (X-Shopify-Access-
  // Token). Used only here, never for product listing (lib/shopify/products.ts), since it grants
  // no read_products access.
  const accessToken = process.env.SHOPIFY_THEME_ACCESS_PASSWORD || (await getValidAccessToken(project.shopifyStore));

  let record = await prisma.publishRecord.create({
    data: { projectId, shopifyThemeId: project.installedThemeShopifyId ?? "", status: "pending" },
  });

  try {
    const themeId = await ensureInstalledTheme(
      projectId,
      project.installedThemeShopifyId,
      shopDomain,
      accessToken,
    );
    await pushConfigurationJson(shopDomain, accessToken, themeId, project.configurationJson);
    await publishTheme(shopDomain, accessToken, themeId);

    record = await prisma.publishRecord.update({
      where: { id: record.id },
      data: { status: "success", shopifyThemeId: themeId },
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
