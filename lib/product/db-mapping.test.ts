import { describe, expect, it } from "vitest";
import type { Product as ProductRow } from "@/app/generated/prisma/client";
import { toProductDTOWithOverrides } from "./db-mapping";

function row(overrides: Partial<ProductRow> = {}): ProductRow {
  return {
    id: "product-1",
    sourceUrl: "https://example.com/p",
    sourcePlatform: "shopify",
    importSource: "shopify",
    supplierPlatform: null,
    importStatus: "succeeded",
    importError: null,
    importedFieldsMissing: [],
    title: "Aurora Merino Crew",
    description: "A midweight merino crew knit.",
    price: 128 as unknown as ProductRow["price"],
    compareAtPrice: null,
    currency: "USD",
    vendor: "Northwake",
    images: [{ url: "https://example.com/original.jpg", altText: "Original" }],
    variants: [],
    options: [],
    rawData: null,
    personaOptionsJson: null,
    marketingAnglesJson: null,
    imageCandidatesJson: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as ProductRow;
}

describe("toProductDTOWithOverrides", () => {
  it("falls back to the product's own images when there is no selection", () => {
    const dto = toProductDTOWithOverrides(row(), null);
    expect(dto.images).toEqual([{ url: "https://example.com/original.jpg", altText: "Original" }]);
  });

  it("falls back to the product's own images when the selection is invalid", () => {
    const dto = toProductDTOWithOverrides(row(), { images: "not-an-array" });
    expect(dto.images).toEqual([{ url: "https://example.com/original.jpg", altText: "Original" }]);
  });

  it("overrides images with the wizard's curated selection", () => {
    const selection = {
      images: [
        { id: "1", url: "https://example.com/selected.jpg", altText: "Selected", source: "web" },
      ],
    };
    const dto = toProductDTOWithOverrides(row(), selection);
    expect(dto.images).toEqual([{ url: "https://example.com/selected.jpg", altText: "Selected" }]);
  });

  it("never mutates Product.images through the DTO", () => {
    const source = row();
    toProductDTOWithOverrides(source, {
      images: [{ id: "1", url: "https://example.com/selected.jpg", altText: null, source: "web" }],
    });
    expect(source.images).toEqual([{ url: "https://example.com/original.jpg", altText: "Original" }]);
  });
});
