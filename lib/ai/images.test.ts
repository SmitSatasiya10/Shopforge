import { describe, expect, it } from "vitest";
import { applyProductImages, collectImageTargets, resolveImages } from "./images";
import { SectionSchema, BlockSchema } from "./catalog";
import { ShopifyTemplate } from "@/lib/preview/shopify-template";
import { loadAiConfig } from "./config";
import { NormalizedProduct } from "@/lib/product/types";

const sections: SectionSchema[] = [
  {
    id: "image-with-text",
    label: "Image with Text",
    settings: { image: "image_picker", heading: "text" },
    allowed_blocks: ["image", "heading"],
  },
  { id: "rich-text", label: "Rich Text", settings: { heading: "text" } },
];

const blocks: BlockSchema[] = [
  { id: "image", settings: { image: "image_picker", alt: "text" } },
  { id: "heading", settings: { heading: "text" } },
];

const product: NormalizedProduct = {
  title: "Aurora Merino Crew",
  description: null,
  price: 128,
  compareAtPrice: null,
  currency: "USD",
  images: [
    { url: "https://cdn.example.com/a.jpg", altText: null },
    { url: "https://cdn.example.com/b.jpg", altText: null },
  ],
  variants: [],
  options: [],
  vendor: "Northwake",
  productUrl: "https://example.com/p",
  source: "shopify",
};

function template(): ShopifyTemplate {
  return {
    order: ["hero", "copy"],
    sections: {
      hero: {
        type: "image-with-text",
        settings: { image: "", heading: "Made to last" },
        blocks: {
          "img-1": { type: "image", settings: { image: "", alt: "" } },
          "head-1": { type: "heading", settings: { heading: "Warm" } },
        },
        block_order: ["img-1", "head-1"],
      },
      copy: { type: "rich-text", settings: { heading: "Why merino" } },
    },
  };
}

describe("image targets", () => {
  it("finds image settings on sections and on their blocks, and nothing else", () => {
    const targets = collectImageTargets(template(), sections, blocks);
    expect(targets.map((t) => `${t.sectionType}.${t.settingId}`)).toEqual([
      "image-with-text.image", // the section's own image_picker
      "image-with-text.image", // the image block's image_picker
    ]);
  });
});

describe("the image toggle", () => {
  it("off: fills every image setting from the product's own photos, calling no model", async () => {
    const tpl = template();
    const result = await resolveImages(
      tpl,
      sections,
      blocks,
      product,
      // A deliberately unusable key: if this path called out to a model, it would throw.
      loadAiConfig({ generateImages: false, apiKey: "" }),
    );

    expect(result).toEqual({ targets: 2, generated: 0, fromProduct: 2 });
    expect(tpl.sections.hero.settings.image).toBe("https://cdn.example.com/a.jpg");
    expect(tpl.sections.hero.blocks!["img-1"].settings.image).toBe("https://cdn.example.com/b.jpg");
  });

  it("off: leaves non-image settings untouched", async () => {
    const tpl = template();
    await resolveImages(tpl, sections, blocks, product, loadAiConfig({ generateImages: false }));
    expect(tpl.sections.hero.settings.heading).toBe("Made to last");
    expect(tpl.sections.copy.settings.heading).toBe("Why merino");
  });

  it("cycles the product's photos when there are more image slots than photos", () => {
    const tpl = template();
    const single = { ...product, images: [product.images[0]] };
    applyProductImages(collectImageTargets(tpl, sections, blocks), single);
    expect(tpl.sections.hero.settings.image).toBe("https://cdn.example.com/a.jpg");
    expect(tpl.sections.hero.blocks!["img-1"].settings.image).toBe("https://cdn.example.com/a.jpg");
  });

  it("applies a data: URI at most once, leaving slots that would repeat it empty", () => {
    const tpl = template();
    const dataUrl = "data:image/png;base64,AAAA";
    const filled = applyProductImages(
      collectImageTargets(tpl, sections, blocks),
      { ...product, images: [{ url: dataUrl, altText: null }] },
    );
    expect(filled).toBe(1);
    expect(tpl.sections.hero.settings.image).toBe(dataUrl);
    expect(tpl.sections.hero.blocks!["img-1"].settings.image).toBe("");
  });

  it("leaves image settings empty when the product has no photos at all", () => {
    const tpl = template();
    const filled = applyProductImages(
      collectImageTargets(tpl, sections, blocks),
      { ...product, images: [] },
    );
    expect(filled).toBe(0);
    expect(tpl.sections.hero.settings.image).toBe("");
  });
});

describe("config defaults", () => {
  it("defaults the image toggle to off", () => {
    expect(loadAiConfig({}).generateImages).toBe(false);
  });

  it("reads the toggle from an explicit override ahead of the environment", () => {
    expect(loadAiConfig({ generateImages: true }).generateImages).toBe(true);
  });
});
