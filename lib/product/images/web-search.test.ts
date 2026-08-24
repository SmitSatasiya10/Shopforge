import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NormalizedProductSchema } from "../types";

// "Other images we found for your product" (shopforge-personalization-image-selection-plan.md
// §9-12): real web photos of the same product, filtered for relevance (never a category-level
// false match) and reachability before ever reaching the wizard.

const callOpenRouterChat = vi.fn();
const validateImageUrl = vi.fn();

beforeEach(() => {
  callOpenRouterChat.mockClear();
  validateImageUrl.mockClear();
  validateImageUrl.mockResolvedValue(true);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

vi.mock("../search-fallback/openrouter-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../search-fallback/openrouter-client")>();
  return { ...actual, callOpenRouterChat: (...args: unknown[]) => callOpenRouterChat(...args) };
});
vi.mock("../fetcher", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../fetcher")>();
  return { ...actual, validateImageUrl: (...args: unknown[]) => validateImageUrl(...args) };
});

const { findWebProductImages } = await import("./web-search");

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

describe("findWebProductImages", () => {
  it("returns nothing without calling the search when the product has no title", async () => {
    const untitled = { ...product, title: null };
    const result = await findWebProductImages(untitled);
    expect(result).toEqual([]);
    expect(callOpenRouterChat).not.toHaveBeenCalled();
  });

  it("returns relevant, reachable candidates", async () => {
    callOpenRouterChat.mockResolvedValueOnce({
      ok: true,
      text: JSON.stringify({
        images: [
          { title: "Beige Leather Bucket Bag", imageUrl: "https://shop.example.com/a.jpg", pageUrl: "https://shop.example.com/p/a" },
        ],
      }),
    });
    const result = await findWebProductImages(product);
    expect(result).toEqual([{ url: "https://shop.example.com/a.jpg", altText: "Beige Leather Bucket Bag" }]);
  });

  it("rejects a candidate whose title is a different product (relevance guard)", async () => {
    callOpenRouterChat.mockResolvedValueOnce({
      ok: true,
      text: JSON.stringify({
        images: [{ title: "Leather Wallet", imageUrl: "https://shop.example.com/wallet.jpg", pageUrl: null }],
      }),
    });
    const result = await findWebProductImages(product);
    expect(result).toEqual([]);
  });

  it("drops a candidate that fails the reachability check", async () => {
    callOpenRouterChat.mockResolvedValueOnce({
      ok: true,
      text: JSON.stringify({
        images: [{ title: "Beige Leather Bucket Bag", imageUrl: "https://shop.example.com/broken.jpg", pageUrl: null }],
      }),
    });
    validateImageUrl.mockResolvedValueOnce(false);
    const result = await findWebProductImages(product);
    expect(result).toEqual([]);
  });

  it("drops a non-https image URL", async () => {
    callOpenRouterChat.mockResolvedValueOnce({
      ok: true,
      text: JSON.stringify({
        images: [{ title: "Beige Leather Bucket Bag", imageUrl: "http://shop.example.com/a.jpg", pageUrl: null }],
      }),
    });
    const result = await findWebProductImages(product);
    expect(result).toEqual([]);
    expect(validateImageUrl).not.toHaveBeenCalled();
  });

  it("returns an empty list when the search call fails", async () => {
    callOpenRouterChat.mockResolvedValueOnce({ ok: false, error: "no key" });
    const result = await findWebProductImages(product);
    expect(result).toEqual([]);
  });

  it("returns an empty list when the response is unreadable", async () => {
    callOpenRouterChat.mockResolvedValueOnce({ ok: true, text: "not json" });
    const result = await findWebProductImages(product);
    expect(result).toEqual([]);
  });
});
