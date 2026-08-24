import { describe, it, expect } from "vitest";
import {
  ImageCandidatesCacheSchema,
  SelectedImagesSchema,
  parseSelectedImages,
  allCandidates,
  MAX_SELECTED_IMAGES,
} from "./product-images";

// Product Images wizard step (shopforge-personalization-image-selection-plan.md §9-18): the
// candidate set cached on Product, and the selection persisted on Project. Selections are
// capped at five and Product.images is never touched by this module.

const candidate = (id: string, source: "original" | "web" | "ai-generated" = "original") => ({
  id,
  url: `https://cdn.example.com/${id}.jpg`,
  altText: null,
  source,
});

describe("ImageCandidatesCacheSchema", () => {
  it("accepts a primary and other row of candidates", () => {
    expect(
      ImageCandidatesCacheSchema.safeParse({
        primary: [candidate("ai-0", "ai-generated")],
        other: [candidate("original-0"), candidate("web-0", "web")],
      }).success,
    ).toBe(true);
  });

  it("accepts empty rows (no images found)", () => {
    expect(ImageCandidatesCacheSchema.safeParse({ primary: [], other: [] }).success).toBe(true);
  });

  it("rejects an unknown source", () => {
    expect(
      ImageCandidatesCacheSchema.safeParse({
        primary: [{ ...candidate("x"), source: "stock" }],
        other: [],
      }).success,
    ).toBe(false);
  });
});

describe("SelectedImagesSchema", () => {
  it(`rejects more than ${MAX_SELECTED_IMAGES} images`, () => {
    const images = Array.from({ length: MAX_SELECTED_IMAGES + 1 }, (_, i) => candidate(`img-${i}`));
    expect(SelectedImagesSchema.safeParse({ images }).success).toBe(false);
  });

  it(`accepts exactly ${MAX_SELECTED_IMAGES} images`, () => {
    const images = Array.from({ length: MAX_SELECTED_IMAGES }, (_, i) => candidate(`img-${i}`));
    expect(SelectedImagesSchema.safeParse({ images }).success).toBe(true);
  });

  it("accepts fewer than the maximum — a product with fewer valid images is not padded", () => {
    expect(SelectedImagesSchema.safeParse({ images: [candidate("img-0")] }).success).toBe(true);
  });
});

describe("parseSelectedImages", () => {
  it("reads back a persisted selection", () => {
    const value = { images: [candidate("img-0")] };
    expect(parseSelectedImages(value)).toEqual(value);
  });

  it("returns null for missing, malformed, or empty data", () => {
    expect(parseSelectedImages(null)).toBeNull();
    expect(parseSelectedImages(undefined)).toBeNull();
    expect(parseSelectedImages({ images: [] })).toBeNull();
    expect(parseSelectedImages({ images: [{ id: "x" }] })).toBeNull();
  });
});

describe("allCandidates", () => {
  it("flattens primary and other into one lookup list", () => {
    const cache = { primary: [candidate("a")], other: [candidate("b"), candidate("c")] };
    expect(allCandidates(cache).map((c) => c.id)).toEqual(["a", "b", "c"]);
  });
});
