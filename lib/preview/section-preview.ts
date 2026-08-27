import type { NormalizedProduct } from "@/lib/product/types";
import { createSectionInstance, generateInstanceId, presetBlockTypes } from "@/lib/store-config/section-factory";
import { loadBlockSchema, loadSectionSchema } from "./section-schema";
import { renderTemplate } from "./template-renderer";
import type { BinaryReader, TemplateReader } from "./template-loader";

// Builds a real, standalone preview of one catalog section for the Add Section picker's cards
// — reusing the exact same instantiation (section-factory.ts) and rendering (renderTemplate)
// the app already uses to build and preview a real section, rather than a second renderer.
// renderTemplate always returns a full theme document (layout + header/footer groups); the
// section's own data-sf-section-id wrapper (added by the renderer for click-to-select) is what
// makes it possible to pull just that one section's markup back out of the full document.

export interface SectionPreviewOptions {
  catalogId: string;
  templateName: string;
  readTemplate: TemplateReader;
  readBinary?: BinaryReader;
  product: NormalizedProduct | null;
  storeName: string;
}

const cache = new Map<string, Promise<string | null>>();

async function buildPreview(opts: SectionPreviewOptions): Promise<string | null> {
  const sectionSchema = await loadSectionSchema(opts.readTemplate, opts.catalogId);
  if (!sectionSchema) return null;

  const blockSchemas = new Map(
    await Promise.all(
      presetBlockTypes(sectionSchema).map(
        async (type) => [type, await loadBlockSchema(opts.readTemplate, type)] as const,
      ),
    ),
  );
  const previewId = generateInstanceId(opts.catalogId);
  const instance = createSectionInstance(opts.catalogId, sectionSchema, blockSchemas);

  const page = await renderTemplate({
    template: { sections: { [previewId]: instance }, order: [previewId] },
    product: opts.product,
    storeName: opts.storeName,
    readTemplate: opts.readTemplate,
    readBinary: opts.readBinary,
    templateName: opts.templateName,
  });

  const doc = new DOMParser().parseFromString(page, "text/html");
  const sectionEl = doc.querySelector(`[data-sf-section-id="${previewId}"]`);
  if (!sectionEl) return null;

  return `<!doctype html><html><head>${doc.head.innerHTML}</head><body><div style="width:1440px">${sectionEl.outerHTML}</div></body></html>`;
}

/** Deterministic given a catalog id + page, so the result is cached for the session — a
 * failing render is cached too (as null), so a broken section type is never retried forever. */
export function getSectionPreviewHtml(opts: SectionPreviewOptions): Promise<string | null> {
  const key = `${opts.catalogId}:${opts.templateName}`;
  let entry = cache.get(key);
  if (!entry) {
    entry = buildPreview(opts).catch(() => null);
    cache.set(key, entry);
  }
  return entry;
}
