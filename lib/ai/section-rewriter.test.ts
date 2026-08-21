import { describe, it, expect } from "vitest";
import { applyScopedRewrite, sanitizeRewrittenSection } from "./section-rewriter";
import type { SectionSchema, BlockSchema } from "./catalog";
import type { ShopifySection } from "@/lib/preview/shopify-template";
import { NormalizedProductSchema } from "@/lib/product/types";

// The guard between the model and the template: whatever a rewrite returns, the section
// keeps its type, its images, and only catalog-allowed blocks — same contract as full
// generation's pruneToCatalog, scoped to one section.

const schema: SectionSchema = {
  id: "image-with-text",
  label: "Image with text",
  settings: { heading: "inline_richtext", text: "richtext", image: "image_picker" },
  allowed_blocks: ["heading", "paragraph"],
  max_blocks: 2,
};

const blocks: BlockSchema[] = [
  { id: "heading", settings: { text: "inline_richtext" } },
  { id: "paragraph", settings: { text: "richtext", background: "image_picker" } },
];

const product = NormalizedProductSchema.parse({
  title: "Round Catering Burner",
  description: null,
  price: 999,
  compareAtPrice: null,
  currency: "INR",
  images: [{ url: "https://img.example/1.jpg" }, { url: "https://img.example/2.jpg" }],
  variants: [],
  options: [],
  vendor: "Gurubhai Equipments",
  productUrl: "https://example.com/p",
  source: "generic_html",
});

const original: ShopifySection = {
  type: "image-with-text",
  settings: { heading: "Old heading", image: "https://img.example/original.jpg" },
  blocks: { b1: { type: "paragraph", settings: { text: "Old body", background: "https://img.example/bg.jpg" } } },
  block_order: ["b1"],
};

describe("sanitizeRewrittenSection", () => {
  it("forces the original section type back", () => {
    const { section } = sanitizeRewrittenSection(
      original,
      { type: "slideshow", settings: { heading: "New" } },
      schema,
      blocks,
      product,
    );
    expect(section.type).toBe("image-with-text");
  });

  it("keeps the original image settings even when the model changed them", () => {
    const { section } = sanitizeRewrittenSection(
      original,
      {
        type: "image-with-text",
        settings: { heading: "New heading", image: "https://evil.example/swapped.jpg" },
        blocks: { b1: { type: "paragraph", settings: { text: "New body", background: "" } } },
        block_order: ["b1"],
      },
      schema,
      blocks,
      product,
    );
    expect(section.settings.image).toBe("https://img.example/original.jpg");
    expect(section.blocks!.b1.settings.background).toBe("https://img.example/bg.jpg");
    expect(section.settings.heading).toBe("New heading");
  });

  it("drops blocks outside the allowlist and enforces max_blocks", () => {
    const { section, dropped } = sanitizeRewrittenSection(
      original,
      {
        type: "image-with-text",
        settings: {},
        blocks: {
          b1: { type: "paragraph", settings: { text: "1" } },
          b2: { type: "video", settings: {} },
          b3: { type: "heading", settings: { text: "2" } },
          b4: { type: "heading", settings: { text: "3" } },
        },
        block_order: ["b1", "b2", "b3", "b4"],
      },
      schema,
      blocks,
      product,
    );
    expect(section.block_order).toEqual(["b1", "b3"]);
    expect(Object.keys(section.blocks!)).toEqual(["b1", "b3"]);
    expect(dropped).toContain("image-with-text/video");
    expect(dropped.some((d) => d.includes("over max_blocks"))).toBe(true);
  });

  it("fills a brand-new block's empty image slot from the product's own photos", () => {
    const { section } = sanitizeRewrittenSection(
      { type: "image-with-text", settings: {}, blocks: {}, block_order: [] },
      {
        type: "image-with-text",
        settings: { image: "" },
        blocks: { fresh: { type: "paragraph", settings: { text: "hi", background: "" } } },
        block_order: ["fresh"],
      },
      schema,
      blocks,
      product,
    );
    expect(section.settings.image).toBe("https://img.example/1.jpg");
    expect(section.blocks!.fresh.settings.background).toBe("https://img.example/2.jpg");
  });
});

describe("settings outside the catalog vocabulary", () => {
  // The model sees the section's current JSON, which for theme-seeded sections carries
  // dozens of presentation settings the catalog never exposes. Echoing them back with
  // drift once flipped a heading's enable_custom_color during a "fix spelling" rewrite —
  // the clamp keeps every non-catalog setting at its original value.
  it("keeps original values for settings the catalog does not expose", () => {
    const schemaWithVocab: SectionSchema = {
      ...schema,
      settings: { heading: "inline_richtext" },
    };
    const blocksWithVocab: BlockSchema[] = [
      ...blocks.filter((b) => b.id !== "heading"),
      { id: "heading", settings: { title: "inline_richtext", heading_size: ["h0", "h1"] } },
    ];
    const originalDense: ShopifySection = {
      type: "image-with-text",
      settings: { heading: "Old", color_scheme: "background-1" },
      blocks: {
        h1: {
          type: "heading",
          settings: { title: "Hurry! Sale Ends Soon", heading_size: "h1", enable_custom_color: true, custom_color: "#415695", blur_type: "words" },
        },
      },
      block_order: ["h1"],
    };
    const { section } = sanitizeRewrittenSection(
      originalDense,
      {
        type: "image-with-text",
        settings: { heading: "New", color_scheme: "inverse" },
        blocks: {
          h1: {
            type: "heading",
            settings: { title: "Hurry! Sale ends soon", heading_size: "h0", enable_custom_color: false, custom_color: "#000000", blur_type: "chars" },
          },
        },
        block_order: ["h1"],
      },
      { ...schemaWithVocab, allowed_blocks: ["heading"] },
      blocksWithVocab,
      product,
    );
    // Catalog-exposed settings take the model's values…
    expect(section.settings.heading).toBe("New");
    expect(section.blocks!.h1.settings.title).toBe("Hurry! Sale ends soon");
    expect(section.blocks!.h1.settings.heading_size).toBe("h0");
    // …everything else keeps the original, no matter what the model echoed.
    expect(section.settings.color_scheme).toBe("background-1");
    expect(section.blocks!.h1.settings.enable_custom_color).toBe(true);
    expect(section.blocks!.h1.settings.custom_color).toBe("#415695");
    expect(section.blocks!.h1.settings.blur_type).toBe("words");
  });
});

describe("applyScopedRewrite", () => {
  it("takes ONLY the scoped setting from the rewrite, everything else stays original", () => {
    const rewritten: typeof original = {
      type: "image-with-text",
      settings: { heading: "Rewritten heading", image: "swapped.jpg" },
      blocks: { b1: { type: "paragraph", settings: { text: "Rewritten body", background: "x.jpg" } } },
      block_order: ["b1"],
    };
    const scoped = applyScopedRewrite(original, rewritten, { blockPath: ["b1"], settingId: "text" });
    expect(scoped.blocks!.b1.settings.text).toBe("Rewritten body");
    expect(scoped.settings.heading).toBe("Old heading");
    expect(scoped.settings.image).toBe("https://img.example/original.jpg");
    expect(scoped.blocks!.b1.settings.background).toBe("https://img.example/bg.jpg");
  });

  it("returns the original untouched when the model dropped the scoped setting", () => {
    const rewritten: typeof original = { type: "image-with-text", settings: {} };
    expect(applyScopedRewrite(original, rewritten, { blockPath: [], settingId: "heading" })).toBe(original);
  });
});

