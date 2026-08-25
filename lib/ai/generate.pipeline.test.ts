import { describe, it, expect } from "vitest";
import { loadCatalog, type BlockSchema, type SectionSchema } from "./catalog";
import { loadFixedSections, type FixedSection } from "./fixed-sections";
import { applyToFixedStructure, assertFixedTemplateStructure, type GeneratedSection } from "./content-generator";
import { renderTemplate } from "@/lib/preview/template-renderer";
import { createFsTemplateReader, createFsBinaryReader } from "@/lib/preview/fs-template-reader";
import { NormalizedProduct } from "@/lib/product/types";

// Closes the exact gap a real "sections missing in preview" report exposed: the fast test
// suite asserted generateTemplate()'s in-memory output was structurally complete, but never
// actually rendered AI-shaped output through the real base-theme .liquid files — only the
// skip-by-default, paid `generate.integration.test.ts` did that. This test does the same
// generation -> saved configuration -> renderer walk with a synthetic-but-realistic model
// response instead of a live API call, so it runs in every `npx vitest run`.

function syntheticValue(spec: unknown): unknown {
  if (Array.isArray(spec)) return spec[0];
  if (spec && typeof spec === "object") {
    const { type, default: def, min } = spec as { type?: string; default?: unknown; min?: number };
    if (def !== undefined) return def;
    if (type === "checkbox") return true;
    if (type === "range" || type === "number") return min ?? 1;
    return "Generated content";
  }
  switch (spec) {
    case "checkbox":
      return true;
    case "image":
    case "image_picker":
    case "video":
    case "video_url":
    case "collection":
    case "collection_picker":
    case "product_picker":
    case "liquid":
    case "url":
      // The model is told to leave image/reference settings empty; images are filled outside
      // of it and it has no real collection/product handle to invent.
      return "";
    case "color":
    case "color_picker":
      return "#336699";
    case "richtext":
    case "inline_richtext":
      return "<p>Generated content for this product.</p>";
    default:
      return "Generated text";
  }
}

function syntheticSettings(settings: Record<string, unknown> | undefined): Record<string, unknown> {
  return Object.fromEntries(Object.entries(settings ?? {}).map(([key, spec]) => [key, syntheticValue(spec)]));
}

/** Stands in for a model response: every fixed section filled, using AI-invented block ids
 * distinct from the base theme's own seed ids — the exact scenario (block-id churn, settings
 * overlaid on the seed) the real generation pipeline produces. */
function buildSyntheticModelResponse(
  fixed: FixedSection[],
  blocksCatalog: BlockSchema[],
): Record<string, GeneratedSection> {
  const blockById = new Map(blocksCatalog.map((b) => [b.id, b]));
  const result: Record<string, GeneratedSection> = {};
  for (const { id, schema } of fixed) {
    const allowed = schema.allowed_blocks ?? [];
    const blockCount = allowed.length === 0 ? 0 : Math.min(schema.max_blocks ?? 3, 3, allowed.length * 2);
    const blocks: Record<string, { type: string; settings: Record<string, unknown> }> = {};
    const blockOrder: string[] = [];
    for (let i = 0; i < blockCount; i++) {
      const type = allowed[i % allowed.length];
      const blockId = `synthetic-${i}`;
      blocks[blockId] = { type, settings: syntheticSettings(blockById.get(type)?.settings) };
      blockOrder.push(blockId);
    }
    result[id] = {
      settings: syntheticSettings(schema.settings),
      ...(blockCount > 0 ? { blocks, block_order: blockOrder } : {}),
    };
  }
  return result;
}

const product: NormalizedProduct = {
  title: "Aurora Merino Crew",
  description: "A midweight 100% merino wool crew neck knit.",
  price: 128,
  compareAtPrice: 160,
  currency: "USD",
  images: [{ url: "https://example.com/front.jpg", altText: "Front" }],
  variants: [{ title: "Small / Fog", price: 128, sku: "AMC-S-FOG" }],
  options: [{ name: "Size", values: ["Small", "Medium", "Large"] }],
  vendor: "Northwake",
  productUrl: "https://example.com/products/aurora-merino-crew",
  source: "shopify",
};

describe.each(["index", "product"] as const)("full pipeline for %s.json", (templateName) => {
  it("renders every fixed base-theme section with zero render failures", async () => {
    const { sections, blocks } = await loadCatalog();
    const readTemplate = createFsTemplateReader();
    const fixedTemplate = await loadFixedSections(readTemplate, templateName, sections as SectionSchema[]);

    const modelResponse = buildSyntheticModelResponse(fixedTemplate.fixed, blocks);
    const { template } = applyToFixedStructure(fixedTemplate, modelResponse);
    assertFixedTemplateStructure(template, fixedTemplate);

    const html = await renderTemplate({
      template,
      product,
      storeName: product.vendor!,
      readTemplate,
      readBinary: createFsBinaryReader(),
      templateName,
    });
    const failures = [...html.matchAll(/<!-- shopforge: [^\n]*?-->/g)].map((m) => m[0]);

    expect(failures).toEqual([]);
    for (const { id } of fixedTemplate.fixed) {
      expect(html).toContain(`data-sf-section-id="${id}"`);
    }
  });
});
