import { describe, expect, it } from "vitest";
import { diffConfigurations, humanizeId } from "./config-diff";
import type { StoreConfiguration } from "./store";
import type { ShopifySection } from "@/lib/preview/shopify-template";

function section(overrides: Partial<ShopifySection> = {}): ShopifySection {
  return { type: "hero", settings: { heading: "Hello" }, ...overrides };
}

function config(overrides: {
  indexSections?: Record<string, ShopifySection>;
  indexOrder?: string[];
  themeSettings?: Record<string, unknown>;
} = {}): StoreConfiguration {
  return {
    version: 2,
    templates: {
      index: {
        sections: overrides.indexSections ?? { hero: section() },
        order: overrides.indexOrder ?? Object.keys(overrides.indexSections ?? { hero: section() }),
      },
      product: { sections: {}, order: [] },
    },
    generatedAt: null,
    themeSettings: overrides.themeSettings ?? {},
  };
}

describe("humanizeId", () => {
  it("converts snake_case and kebab-case ids to Title Case", () => {
    expect(humanizeId("product_title")).toBe("Product Title");
    expect(humanizeId("free-shipping-banner")).toBe("Free Shipping Banner");
  });
});

describe("diffConfigurations", () => {
  it("returns no entries for identical configurations", () => {
    const a = config();
    const b = config();
    expect(diffConfigurations(a, b, "Title", "Title")).toEqual([]);
  });

  it("reports a setting change within a section as modified, listing the changed setting id", () => {
    const current = config({ indexSections: { hero: section({ settings: { heading: "New" } }) } });
    const checkpoint = config({ indexSections: { hero: section({ settings: { heading: "Old" } }) } });

    const entries = diffConfigurations(current, checkpoint, null, null);

    expect(entries).toEqual([
      {
        scope: "section",
        kind: "modified",
        page: "index",
        sectionId: "hero",
        label: "Hero",
        changedSettings: ["heading"],
        changedBlocks: [],
      },
    ]);
  });

  it("reports a section present only in the checkpoint as removed (restoring brings it back)", () => {
    const current = config({ indexSections: {}, indexOrder: [] });
    const checkpoint = config({ indexSections: { hero: section() } });

    const entries = diffConfigurations(current, checkpoint, null, null);

    expect(entries).toEqual([
      {
        scope: "section",
        kind: "removed",
        page: "index",
        sectionId: "hero",
        label: "Hero",
        changedSettings: [],
        changedBlocks: [],
      },
    ]);
  });

  it("reports a section present only in the current draft as added (restoring removes it)", () => {
    const current = config({ indexSections: { hero: section() } });
    const checkpoint = config({ indexSections: {}, indexOrder: [] });

    const entries = diffConfigurations(current, checkpoint, null, null);

    expect(entries).toEqual([
      {
        scope: "section",
        kind: "added",
        page: "index",
        sectionId: "hero",
        label: "Hero",
        changedSettings: [],
        changedBlocks: [],
      },
    ]);
  });

  it("uses the section's type when it has no name", () => {
    const current = config({ indexSections: { hero: section({ type: "free-shipping-banner" }) } });
    const checkpoint = config({ indexSections: {}, indexOrder: [] });

    const [entry] = diffConfigurations(current, checkpoint, null, null);
    expect(entry).toMatchObject({ label: "Free Shipping Banner" });
  });

  it("reports a section reorder as a single order entry, not per-section noise", () => {
    const current = config({
      indexSections: { hero: section(), faq: section({ type: "faq" }) },
      indexOrder: ["faq", "hero"],
    });
    const checkpoint = config({
      indexSections: { hero: section(), faq: section({ type: "faq" }) },
      indexOrder: ["hero", "faq"],
    });

    const entries = diffConfigurations(current, checkpoint, null, null);

    expect(entries).toEqual([{ scope: "order", page: "index" }]);
  });

  it("does not report a reorder when the order difference is only due to an added/removed section", () => {
    const current = config({
      indexSections: { hero: section(), faq: section({ type: "faq" }) },
      indexOrder: ["hero", "faq"],
    });
    const checkpoint = config({ indexSections: { hero: section() }, indexOrder: ["hero"] });

    const entries = diffConfigurations(current, checkpoint, null, null);

    expect(entries).toEqual([
      {
        scope: "section",
        kind: "added",
        page: "index",
        sectionId: "faq",
        label: "Faq",
        changedSettings: [],
        changedBlocks: [],
      },
    ]);
  });

  it("reports a top-level block added/removed/modified within an otherwise-unchanged section", () => {
    const current = config({
      indexSections: {
        hero: section({
          blocks: { b1: { type: "text", settings: { text: "new" } } },
          block_order: ["b1"],
        }),
      },
    });
    const checkpoint = config({
      indexSections: {
        hero: section({
          blocks: { b1: { type: "text", settings: { text: "old" } } },
          block_order: ["b1"],
        }),
      },
    });

    const entries = diffConfigurations(current, checkpoint, null, null);

    expect(entries).toEqual([
      {
        scope: "section",
        kind: "modified",
        page: "index",
        sectionId: "hero",
        label: "Hero",
        changedSettings: [],
        changedBlocks: ["b1"],
      },
    ]);
  });

  it("reports a theme setting change", () => {
    const current = config({ themeSettings: { colors_accent_1: "#000" } });
    const checkpoint = config({ themeSettings: { colors_accent_1: "#fff" } });

    const entries = diffConfigurations(current, checkpoint, null, null);

    expect(entries).toEqual([
      { scope: "theme", kind: "modified", settingId: "colors_accent_1", label: "Colors Accent 1" },
    ]);
  });

  it("reports a product title change", () => {
    const entries = diffConfigurations(config(), config(), "New Title", "Old Title");
    expect(entries).toEqual([{ scope: "productTitle", before: "New Title", after: "Old Title" }]);
  });
});
