import { describe, it, expect } from "vitest";
import { buildProductImagePrompts } from "./product-image-generator";
import { NormalizedProductSchema } from "@/lib/product/types";

// AI-generated product photography for the wizard's Product Images step
// (shopforge-personalization-image-selection-plan.md §9-11): every prompt must name the
// actual product, never a generic placeholder, and should use the persona/marketing angle
// chosen earlier in the wizard where relevant — not the product's category alone.

const product = NormalizedProductSchema.parse({
  title: "Beige Leather Bucket Bag",
  description: "A hand-stitched leather bucket bag with an adjustable strap.",
  price: 148,
  compareAtPrice: null,
  currency: "USD",
  images: [],
  variants: [],
  options: [],
  vendor: "Northtrail",
  productUrl: "https://example.com/p/bucket-bag",
  source: "shopify",
});

describe("buildProductImagePrompts", () => {
  it("names the actual product in every prompt", () => {
    const prompts = buildProductImagePrompts(product);
    expect(prompts).toHaveLength(4);
    for (const prompt of prompts) {
      expect(prompt).toContain("Beige Leather Bucket Bag");
    }
  });

  it("produces four distinct compositions, not four near-duplicate shots", () => {
    const prompts = buildProductImagePrompts(product);
    expect(prompts[0]).toContain("isolated on a clean plain background");
    expect(prompts[1]).toContain("Lifestyle photograph");
    expect(prompts[2]).toContain("Close-up detail");
    expect(prompts[3]).toContain("using");
  });

  it("includes the target persona in the in-use shot when one was chosen", () => {
    const prompts = buildProductImagePrompts(product, {
      type: "generated",
      id: "weekend-traveler",
      name: "Weekend Traveler",
      description: "Packs light for short trips.",
    });
    expect(prompts[3]).toContain("Weekend Traveler");
    expect(prompts.some((p) => p.includes("Packs light for short trips."))).toBe(true);
  });

  it("includes a custom persona's own text", () => {
    const prompts = buildProductImagePrompts(product, { type: "custom", text: "Eco-conscious urban commuters" });
    expect(prompts.some((p) => p.includes("Eco-conscious urban commuters"))).toBe(true);
  });

  it("includes the marketing angle when one was chosen", () => {
    const prompts = buildProductImagePrompts(product, null, {
      id: "everyday-elegance",
      title: "Everyday Elegance",
      description: "Effortless style for daily use.",
      selectionType: "generated",
    });
    expect(prompts.every((p) => p.includes("Everyday Elegance"))).toBe(true);
  });

  it("never invents other products or adds text/watermark instructions are always present", () => {
    const prompts = buildProductImagePrompts(product);
    for (const prompt of prompts) {
      expect(prompt).toContain("No text, no logos, no watermarks, no other products in frame.");
    }
  });
});
