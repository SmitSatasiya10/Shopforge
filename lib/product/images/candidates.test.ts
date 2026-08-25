import { describe, it, expect, vi, beforeEach } from "vitest";
import { NormalizedProductSchema } from "../types";

// Candidate assembly for the Product Images wizard step
// (shopforge-personalization-image-selection-plan.md §9-12): AI-generated photography is the
// primary ("Your free AI-generated images") row when it succeeds, falling back to the
// product's own photos when AI generation is unavailable/fails, so the primary row is never
// filled with something unrelated to the actual product; everything else lands in "other",
// deduplicated by URL.

const generateProductImages = vi.fn();
const findWebProductImages = vi.fn();

beforeEach(() => {
  generateProductImages.mockClear();
  findWebProductImages.mockClear();
});

vi.mock("@/lib/ai/product-image-generator", () => ({
  generateProductImages: (...args: unknown[]) => generateProductImages(...args),
}));
vi.mock("./web-search", () => ({
  findWebProductImages: (...args: unknown[]) => findWebProductImages(...args),
}));

const { buildImageCandidates } = await import("./candidates");

const product = NormalizedProductSchema.parse({
  title: "Beige Leather Bucket Bag",
  description: null,
  price: 148,
  compareAtPrice: null,
  currency: "USD",
  images: [{ url: "https://cdn.example.com/original.jpg", altText: "Bucket bag" }],
  variants: [],
  options: [],
  vendor: null,
  productUrl: "https://example.com/p/bucket-bag",
  source: "shopify",
});

// generateImages defaults to false (SHOPFORGE_GENERATE_IMAGES unset in the test env), which
// would skip findWebProductImages entirely — these tests are specifically about what happens
// once AI (generation + web search) is on, so they opt in explicitly.
const AI_ON = { config: { generateImages: true } };

describe("buildImageCandidates", () => {
  it("uses AI-generated images as primary when generation succeeds, product photos as other", async () => {
    generateProductImages.mockResolvedValueOnce([{ url: "https://ai.example.com/1.jpg" }]);
    findWebProductImages.mockResolvedValueOnce([]);

    const result = await buildImageCandidates(product, AI_ON);

    expect(result.primary).toEqual([{ id: "ai-0", url: "https://ai.example.com/1.jpg", altText: null, source: "ai-generated" }]);
    expect(result.other).toEqual([
      { id: "original-0", url: "https://cdn.example.com/original.jpg", altText: "Bucket bag", source: "original" },
    ]);
  });

  it("falls back to the product's own photos as primary when AI generation fails outright", async () => {
    generateProductImages.mockRejectedValueOnce(new Error("no api key"));
    findWebProductImages.mockResolvedValueOnce([]);

    const result = await buildImageCandidates(product, AI_ON);

    expect(result.primary).toEqual([
      { id: "original-0", url: "https://cdn.example.com/original.jpg", altText: "Bucket bag", source: "original" },
    ]);
    expect(result.other).toEqual([]);
  });

  it("falls back to the product's own photos as primary when AI generation returns nothing", async () => {
    generateProductImages.mockResolvedValueOnce([]);
    findWebProductImages.mockResolvedValueOnce([{ url: "https://web.example.com/1.jpg", altText: "Found bag" }]);

    const result = await buildImageCandidates(product, AI_ON);

    expect(result.primary).toEqual([
      { id: "original-0", url: "https://cdn.example.com/original.jpg", altText: "Bucket bag", source: "original" },
    ]);
    expect(result.other).toEqual([{ id: "web-0", url: "https://web.example.com/1.jpg", altText: "Found bag", source: "web" }]);
  });

  it("never duplicates the same URL across primary and other", async () => {
    generateProductImages.mockResolvedValueOnce([]);
    findWebProductImages.mockResolvedValueOnce([{ url: "https://cdn.example.com/original.jpg", altText: "Dup" }]);

    const result = await buildImageCandidates(product, AI_ON);

    expect(result.other).toEqual([]);
  });

  it("tolerates the web search failing outright, still returning AI + original", async () => {
    generateProductImages.mockResolvedValueOnce([{ url: "https://ai.example.com/1.jpg" }]);
    findWebProductImages.mockRejectedValueOnce(new Error("search unavailable"));

    const result = await buildImageCandidates(product, AI_ON);

    expect(result.primary).toHaveLength(1);
    expect(result.other).toEqual([
      { id: "original-0", url: "https://cdn.example.com/original.jpg", altText: "Bucket bag", source: "original" },
    ]);
  });

  it("returns empty rows for a product with no photos and no successful sources", async () => {
    generateProductImages.mockResolvedValueOnce([]);
    findWebProductImages.mockResolvedValueOnce([]);

    const result = await buildImageCandidates({ ...product, images: [] }, AI_ON);

    expect(result).toEqual({ primary: [], other: [] });
  });

  it("skips the web search entirely when generateImages is off — pure scrape, zero AI calls", async () => {
    generateProductImages.mockResolvedValueOnce([]);

    const result = await buildImageCandidates(product, { config: { generateImages: false } });

    expect(findWebProductImages).not.toHaveBeenCalled();
    expect(result.primary).toEqual([
      { id: "original-0", url: "https://cdn.example.com/original.jpg", altText: "Bucket bag", source: "original" },
    ]);
    expect(result.other).toEqual([]);
  });

  it("defaults to skipping the web search when no config is passed at all", async () => {
    generateProductImages.mockResolvedValueOnce([]);

    await buildImageCandidates(product);

    expect(findWebProductImages).not.toHaveBeenCalled();
  });
});
