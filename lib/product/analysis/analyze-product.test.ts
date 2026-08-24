import { describe, it, expect } from "vitest";
import { analyzeProduct } from "./analyze-product";
import type { ProductDTO } from "@/lib/product/db-mapping";

function makeProduct(overrides: Partial<ProductDTO> = {}): ProductDTO {
  return {
    id: "test-id",
    title: "Aurora Pet Bed",
    description:
      "A plush, machine-washable pet bed with a memory-foam base and a raised bolster edge for extra comfort and security.",
    price: 59,
    compareAtPrice: 79,
    currency: "USD",
    images: [{ url: "https://example.com/a.jpg", altText: "Aurora Pet Bed" }],
    variants: [
      { title: "Small", price: 59, sku: "APB-SM" },
      { title: "Large", price: 79, sku: "APB-LG" },
    ],
    options: [{ name: "Size", values: ["Small", "Large"] }],
    vendor: "Aurora Home",
    productUrl: "https://example.com/products/aurora-pet-bed",
    source: "shopify",
    importStatus: "succeeded",
    importError: null,
    importedFieldsMissing: [],
    importSource: "shopify",
    supplierPlatform: null,
    ...overrides,
  };
}

describe("analyzeProduct", () => {
  it("complete product data: computes a real score and correctly separates available from unavailable checks", () => {
    const result = analyzeProduct(makeProduct());

    expect(result.failed).toBe(false);
    expect(result.score).not.toBeNull();
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThanOrEqual(100);

    expect(result.outcomes.fetch.status).toBe("completed");
    expect(result.outcomes.margin.status).toBe("completed");
    expect(result.outcomes.perceived_value.status).toBe("completed");

    // Reviews/trends run against a fixed placeholder score by product decision (no real
    // data source is connected) — see checks/reviews.ts and checks/trends.ts.
    expect(result.outcomes.reviews.status).toBe("completed");
    expect(result.outcomes.reviews.score).not.toBeNull();
    expect(result.outcomes.trends.status).toBe("completed");
    expect(result.outcomes.trends.score).not.toBeNull();
  });

  it("missing image: does not fabricate one, and the score is still computed from what's available", () => {
    const result = analyzeProduct(makeProduct({ images: [], importedFieldsMissing: ["images"] }));

    expect(result.failed).toBe(false);
    expect(result.score).not.toBeNull();
    expect(result.outcomes.fetch.detail).toContain("images");
  });

  it("missing price: margin is unavailable rather than fabricated, score still deterministic from the rest", () => {
    const result = analyzeProduct(makeProduct({ price: null, compareAtPrice: null }));

    expect(result.outcomes.margin.status).toBe("unavailable");
    expect(result.outcomes.margin.score).toBeNull();
    expect(result.outcomes.margin.summary).toMatch(/no price data/i);
    // fetch + perceived_value can still contribute even with no price
    expect(result.score).not.toBeNull();
  });

  it("review analysis is a fixed, deterministic placeholder (no real data source), not a random result", () => {
    const result = analyzeProduct(makeProduct());
    expect(result.outcomes.reviews.status).toBe("completed");
    expect(result.outcomes.reviews.score).toBe(analyzeProduct(makeProduct()).outcomes.reviews.score);
    expect(result.outcomes.reviews.summary).toMatch(/not connected|placeholder/i);
  });

  it("trend analysis is a fixed, deterministic placeholder (no real data source), not a random result", () => {
    const result = analyzeProduct(makeProduct());
    expect(result.outcomes.trends.status).toBe("completed");
    expect(result.outcomes.trends.score).toBe(analyzeProduct(makeProduct()).outcomes.trends.score);
    expect(result.outcomes.trends.summary).toMatch(/not connected|placeholder/i);
  });

  it("per-check outcomes are deterministic; the overall score is randomized within [80, 100]", () => {
    const product = makeProduct();
    const first = analyzeProduct(product);
    const second = analyzeProduct(product);
    expect(second.outcomes).toEqual(first.outcomes);
    for (const score of [first.score, second.score]) {
      expect(score).toBeGreaterThanOrEqual(80);
      expect(score).toBeLessThanOrEqual(100);
    }
  });

  it("marks the whole analysis failed (no score) when the underlying import itself failed", () => {
    const result = analyzeProduct(
      makeProduct({ importStatus: "failed", importError: "Could not reach the page", title: null }),
    );
    expect(result.failed).toBe(true);
    expect(result.score).toBeNull();
  });
});
