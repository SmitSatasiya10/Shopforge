import { describe, it, expect } from "vitest";
import { loadFixedSections, describeFixedSections, type FixedSection } from "./fixed-sections";
import { loadCatalog, type SectionSchema, type BlockSchema } from "./catalog";
import { createFsTemplateReader } from "@/lib/preview/fs-template-reader";
import type { ShopifySection } from "@/lib/preview/shopify-template";

// Regression guard for the base-theme/catalog contract that generation now depends on
// (lib/ai/content-generator.ts's applyToFixedStructure): every section the base theme's own
// templates/{name}.json actually uses must have a matching, eligible AI catalog schema, or
// generation can't fill it. A mismatch here should fail loudly at generation time rather than
// silently producing a broken or incomplete page.

describe("loadFixedSections", () => {
  it("resolves every section in the real base theme's index.json against the AI catalog", async () => {
    const { sections } = await loadCatalog();
    const readTemplate = createFsTemplateReader();
    const fixed = await loadFixedSections(readTemplate, "index", sections);

    expect(fixed.fixed.length).toBeGreaterThan(0);
    expect(fixed.order).toEqual(fixed.fixed.map((f) => f.id));
    for (const section of fixed.fixed) {
      expect(section.schema.id).toBe(section.type);
    }
  });

  it("resolves every section in the real base theme's product.json against the AI catalog", async () => {
    const { sections } = await loadCatalog();
    const readTemplate = createFsTemplateReader();
    const fixed = await loadFixedSections(readTemplate, "product", sections);

    expect(fixed.fixed.length).toBeGreaterThan(0);
    for (const section of fixed.fixed) {
      expect(section.schema.id).toBe(section.type);
    }
  });

  it("marks the real base theme's main product section fixed_blocks and lists every seeded block id", async () => {
    const { sections, blocks } = await loadCatalog();
    const readTemplate = createFsTemplateReader();
    const fixed = await loadFixedSections(readTemplate, "product", sections);
    const main = fixed.fixed.find((f) => f.type === "main-product")!;
    expect(main.schema.fixed_blocks).toBe(true);

    const description = describeFixedSections(fixed.fixed, blocks);
    const seededBlockIds = main.seed.block_order ?? Object.keys(main.seed.blocks ?? {});
    expect(seededBlockIds.length).toBeGreaterThan(0);
    for (const blockId of seededBlockIds) {
      expect(description).toContain(`block id "${blockId}"`);
    }
    expect(description).toContain("blocks (fixed");
  });

  it("marks the real base theme's horizontal ticker fixed_blocks and lists every seeded block id", async () => {
    const { sections, blocks } = await loadCatalog();
    const readTemplate = createFsTemplateReader();
    const fixed = await loadFixedSections(readTemplate, "product", sections);
    const ticker = fixed.fixed.find((f) => f.type === "horizontal-ticker")!;
    expect(ticker.schema.fixed_blocks).toBe(true);
    expect(ticker.schema.locked).toBeFalsy();

    const description = describeFixedSections(fixed.fixed, blocks);
    const seededBlockIds = ticker.seed.block_order ?? Object.keys(ticker.seed.blocks ?? {});
    expect(seededBlockIds.length).toBeGreaterThan(0);
    for (const blockId of seededBlockIds) {
      expect(description).toContain(`block id "${blockId}"`);
    }
  });
});

// Regression guard for the dedup done in describeFixedSections: repeated section/block TYPES
// must be described exactly once each, no matter how many instances/ids on the page share that
// type — while every instance's own id, order, and fixed-block list stays intact.

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

const imageWithText: SectionSchema = {
  id: "image-with-text",
  label: "Image with text",
  settings: { heading: "inline_richtext" },
  allowed_blocks: ["heading"],
};
const headingBlock: BlockSchema = { id: "heading", settings: { text: "inline_richtext" } };
const emptySeed: ShopifySection = { type: "image-with-text", settings: {}, blocks: {}, block_order: [] };

describe("describeFixedSections", () => {
  it("describes a section type's full schema exactly once even with two instances of that type", () => {
    const fixed: FixedSection[] = [
      { id: "promo-1", type: "image-with-text", schema: imageWithText, seed: emptySeed },
      { id: "promo-2", type: "image-with-text", schema: imageWithText, seed: emptySeed },
    ];
    const description = describeFixedSections(fixed, [headingBlock]);
    expect(occurrences(description, "Section schema: image-with-text")).toBe(1);
    expect(description).toContain('id "promo-1"');
    expect(description).toContain('id "promo-2"');
  });

  it("describes a block type's full schema exactly once even with four seeded blocks of that type", () => {
    const collapsibleRow: BlockSchema = { id: "collapsible-row", settings: { heading: "text" } };
    const seed: ShopifySection = {
      type: "main-product",
      settings: {},
      blocks: {
        row1: { type: "collapsible-row", settings: {} },
        row2: { type: "collapsible-row", settings: {} },
        row3: { type: "collapsible-row", settings: {} },
        row4: { type: "collapsible-row", settings: {} },
      },
      block_order: ["row1", "row2", "row3", "row4"],
    };
    const fixed: FixedSection[] = [
      {
        id: "main",
        type: "main-product",
        schema: { id: "main-product", label: "Main Product", fixed_blocks: true, settings: {} },
        seed,
      },
    ];
    const description = describeFixedSections(fixed, [collapsibleRow]);
    expect(occurrences(description, "Block schema: collapsible-row")).toBe(1);
    for (const id of ["row1", "row2", "row3", "row4"]) {
      expect(description).toContain(`block id "${id}"`);
    }
    expect(description).toContain("blocks (fixed");
  });

  it("gives different section types separate schema entries", () => {
    const mainProduct: FixedSection = {
      id: "main",
      type: "main-product",
      schema: { id: "main-product", label: "Main Product", fixed_blocks: true, settings: {} },
      seed: { type: "main-product", settings: {}, blocks: {}, block_order: [] },
    };
    const fixed: FixedSection[] = [
      { id: "promo-1", type: "image-with-text", schema: imageWithText, seed: emptySeed },
      mainProduct,
    ];
    const description = describeFixedSections(fixed, [headingBlock]);
    expect(occurrences(description, "Section schema: image-with-text")).toBe(1);
    expect(occurrences(description, "Section schema: main-product")).toBe(1);
  });

  it("preserves every instance's id, type and order across multiple distinct sections", () => {
    const fixed: FixedSection[] = [
      { id: "promo-1", type: "image-with-text", schema: imageWithText, seed: emptySeed },
      { id: "promo-2", type: "image-with-text", schema: imageWithText, seed: emptySeed },
      {
        id: "usp",
        type: "custom-columns-new",
        schema: { id: "custom-columns-new", label: "USP columns", settings: {}, allowed_blocks: ["column"] },
        seed: { type: "custom-columns-new", settings: {}, blocks: {}, block_order: [] },
      },
    ];
    const description = describeFixedSections(fixed, [headingBlock]);
    const iPromo1 = description.indexOf('id "promo-1"');
    const iPromo2 = description.indexOf('id "promo-2"');
    const iUsp = description.indexOf('id "usp"');
    expect(iPromo1).toBeGreaterThanOrEqual(0);
    expect(iPromo1).toBeLessThan(iPromo2);
    expect(iPromo2).toBeLessThan(iUsp);
  });
});
