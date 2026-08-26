import { describe, it, expect } from "vitest";
import { loadFixedSections, describeFixedSections } from "./fixed-sections";
import { loadCatalog } from "./catalog";
import { createFsTemplateReader } from "@/lib/preview/fs-template-reader";

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
