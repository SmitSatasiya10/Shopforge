import { ZipArchive } from "archiver";
import path from "node:path";
import { PAGE_TEMPLATES, StoreConfiguration } from "@/lib/store-config/store";

const BASE_THEME_DIR = path.join(process.cwd(), "public", "base-theme");

// Bump whenever public/base-theme changes, so a stale cached zip never gets pushed. The Liquid
// bundle only changes when the Base Theme itself does — far less often than a publish, which
// only rewrites the two JSON templates (see lib/shopify/publish.ts) — so caching the zip across
// requests avoids re-archiving ~500 files on every publish.
export const BASE_THEME_VERSION = "2";

let cached: { version: string; buffer: Buffer } | null = null;

/** Zips public/base-theme into a buffer suitable for Shopify's stagedUploadsCreate upload target. */
export async function buildBaseThemeZip(): Promise<Buffer> {
  if (cached?.version === BASE_THEME_VERSION) return cached.buffer;

  const buffer = await new Promise<Buffer>((resolve, reject) => {
    const archive = new ZipArchive({ zlib: { level: 9 } });
    const chunks: Buffer[] = [];
    archive.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.on("warning", (err: { code?: string }) => {
      if (err.code !== "ENOENT") reject(err);
    });
    archive.on("error", reject);
    archive.on("end", () => resolve(Buffer.concat(chunks)));
    // public/base-theme/images/ (~22MB of demo product photography) pushes the zip well past
    // Shopify's 20MB stagedUploadsCreate cap on its own — everything that makes the theme
    // actually function (Liquid, JSON, CSS/JS, locales) is under 2MB total. Real product
    // imagery is supplied by the Store Configuration at publish time anyway, so these demo
    // photos aren't load-bearing for the install.
    archive.directory(BASE_THEME_DIR, false, (entry) =>
      entry.name.startsWith("images/") ? false : entry,
    );
    archive.finalize();
  });

  cached = { version: BASE_THEME_VERSION, buffer };
  return buffer;
}

/**
 * Same bundle as buildBaseThemeZip, but with templates/index.json and templates/product.json
 * replaced by this project's own current configuration — the same two files
 * publishProjectToShopify pushes to a connected store (lib/shopify/publish.ts,
 * buildTemplateFiles). Lets a merchant download and manually upload the theme to check it
 * without needing a Shopify connection. Not cached, since it's per-project.
 */
export async function buildProjectThemeZip(config: StoreConfiguration): Promise<Buffer> {
  const overridePaths = new Set(PAGE_TEMPLATES.map((page) => `templates/${page}.json`));

  return new Promise<Buffer>((resolve, reject) => {
    const archive = new ZipArchive({ zlib: { level: 9 } });
    const chunks: Buffer[] = [];
    archive.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.on("warning", (err: { code?: string }) => {
      if (err.code !== "ENOENT") reject(err);
    });
    archive.on("error", reject);
    archive.on("end", () => resolve(Buffer.concat(chunks)));
    archive.directory(BASE_THEME_DIR, false, (entry) =>
      entry.name.startsWith("images/") || overridePaths.has(entry.name) ? false : entry,
    );
    for (const page of PAGE_TEMPLATES) {
      archive.append(JSON.stringify(config.templates[page]), { name: `templates/${page}.json` });
    }
    archive.finalize();
  });
}
