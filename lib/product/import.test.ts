import { describe, it, expect, vi, beforeEach } from "vitest";

// These cover the paths that resolve before any network call is made (invalid URL /
// unsupported platform detection), plus the Amazon/Etsy dispatch logic with the fetcher and
// web-search fallback mocked (no live network call), so they're fast and deterministic.
// Live-platform reachability (Amazon and Etsy against real product URLs, and the OpenRouter
// fallback against a real key) was verified manually rather than asserted here, since automated
// tests shouldn't depend on a third party's uptime, bot defenses, or a paid API key.

const tryFetchShopifyProductJson = vi.fn();
const fetchProductHtml = vi.fn();
class MockProductFetchError extends Error {
  reason: string;
  constructor(message: string, reason: string) {
    super(message);
    this.reason = reason;
    this.name = "ProductFetchError";
  }
}
vi.mock("./fetcher", () => ({
  tryFetchShopifyProductJson: (...args: unknown[]) => tryFetchShopifyProductJson(...args),
  fetchProductHtml: (...args: unknown[]) => fetchProductHtml(...args),
  fetchTextWithLimits: vi.fn(),
  ProductFetchError: MockProductFetchError,
}));

const searchProductFallback = vi.fn();
vi.mock("./search-fallback", () => ({
  searchProductFallback: (...args: unknown[]) => searchProductFallback(...args),
}));

// The post-search enrichment stages hit the network (OpenRouter shop-name resolution) — kept
// inert here; their behavior is covered by their own unit tests.
vi.mock("./search-fallback/vendor-resolution", () => ({
  resolveEtsyShopNames: vi.fn(async () => ({ byUrl: new Map(), citedShops: [] })),
}));
vi.mock("./search-fallback/shop-discovery", () => ({
  discoverEtsyShops: vi.fn(async () => []),
}));

const { importSupplierProduct, importCompetitorStore } = await import("./import");

const FULL_SHOPIFY_JSON = {
  title: "Wireless Earbuds",
  images: [{ src: "https://example.com/img.jpg" }],
  variants: [{ title: "Default", price: "29.99" }],
};

describe("importSupplierProduct", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an invalid URL without detecting a platform", async () => {
    const outcome = await importSupplierProduct("not a url");
    if (outcome.mode !== "product") throw new Error("expected mode 'product'");
    expect(outcome.platform).toBeNull();
    expect(outcome.result.status).toBe("failed");
    expect(outcome.result.error).toMatch(/not a valid URL/);
  });

  it("rejects an unsupported supplier host without fetching anything", async () => {
    const outcome = await importSupplierProduct("https://example-supplier.com/product/1");
    if (outcome.mode !== "product") throw new Error("expected mode 'product'");
    expect(outcome.platform).toBeNull();
    expect(outcome.result.status).toBe("failed");
    expect(outcome.result.error).toMatch(/isn't supported yet/);
    expect(outcome.result.error).toContain("Amazon");
    expect(outcome.result.error).toContain("Etsy");
  });

  it("rejects AliExpress/Zendrop/TeemDrop URLs as unsupported (out of scope)", async () => {
    const outcome = await importSupplierProduct("https://www.aliexpress.com/item/123.html");
    if (outcome.mode !== "product") throw new Error("expected mode 'product'");
    expect(outcome.platform).toBeNull();
    expect(outcome.result.error).not.toContain("AliExpress");
  });

  it("never calls the web-search fallback for Amazon when direct retrieval already succeeds", async () => {
    tryFetchShopifyProductJson.mockResolvedValueOnce(FULL_SHOPIFY_JSON);
    const outcome = await importSupplierProduct("https://www.amazon.com/dp/B08N5WRWNW");
    expect(outcome.platform).toBe("amazon");
    expect(outcome.mode).toBe("product");
    expect(outcome.mode === "product" && outcome.result.status).toBe("succeeded");
    expect(searchProductFallback).not.toHaveBeenCalled();
  });

  it("falls back to web search for Amazon when the page is an HTTP-200 captcha shell, with the ASIN and slug title hint", async () => {
    // Observed live: Amazon returns 200 with a robot-check page — no JSON-LD, no Open Graph,
    // no #landingImage — so extraction fails despite the "successful" fetch.
    tryFetchShopifyProductJson.mockResolvedValueOnce(null);
    fetchProductHtml.mockResolvedValueOnce(
      "<html><body>Type the characters you see in this image. api-services-support@amazon.com</body></html>",
    );
    searchProductFallback.mockResolvedValueOnce({ matchType: "none" });

    await importSupplierProduct("https://www.amazon.in/Cherry-Blossom-Tree-Lamp/dp/B0ABCDE123?ref=sr_1_1");

    expect(searchProductFallback).toHaveBeenCalledWith(
      expect.objectContaining({
        sourcePlatform: "amazon",
        sourceUrl: "https://www.amazon.in/dp/B0ABCDE123",
        listingId: "B0ABCDE123",
        title: "Cherry Blossom Tree Lamp",
        vendor: null,
      }),
    );
  });

  it("returns mode 'related' for Amazon when the fallback finds similar products", async () => {
    tryFetchShopifyProductJson.mockResolvedValueOnce(null);
    fetchProductHtml.mockRejectedValueOnce(new MockProductFetchError("Server responded 503 for x", "http_error"));
    searchProductFallback.mockResolvedValueOnce({
      matchType: "related",
      products: [
        {
          title: "Sakura Tree Lamp",
          description: null,
          price: 1299,
          compareAtPrice: null,
          currency: "INR",
          images: [{ url: "https://m.media-amazon.com/images/I/71abc.jpg", altText: null }],
          variants: [],
          options: [],
          vendor: null,
          productUrl: "https://www.amazon.in/dp/B0AAAAAAA1",
          source: "search_related" as const,
        },
      ],
    });

    const outcome = await importSupplierProduct("https://www.amazon.in/Cherry-Blossom-Tree-Lamp/dp/B0ABCDE123");
    expect(outcome.mode).toBe("related");
    expect(outcome.mode === "related" && outcome.results[0].normalized?.title).toBe("Sakura Tree Lamp");
  });

  it("keeps a partial direct result (title but no image) when the fallback finds nothing better", async () => {
    tryFetchShopifyProductJson.mockResolvedValueOnce(null);
    // A page with recognizable product data but no image — partial, insufficient to skip search.
    fetchProductHtml.mockResolvedValueOnce(`
      <html><head>
        <meta property="og:type" content="product" />
        <meta property="og:title" content="Cherry Blossom Tree Lamp" />
      </head><body></body></html>
    `);
    searchProductFallback.mockResolvedValueOnce({ matchType: "none" });

    const outcome = await importSupplierProduct("https://www.amazon.in/Cherry-Blossom-Tree-Lamp/dp/B0ABCDE123");
    expect(outcome.mode).toBe("product");
    if (outcome.mode !== "product") throw new Error("unreachable");
    expect(outcome.result.status).toBe("partial");
    expect(outcome.result.normalized?.title).toBe("Cherry Blossom Tree Lamp");
    expect(outcome.result.normalized?.images).toEqual([]); // honest "No image", never a substitute
  });

  it("falls back to web search for Etsy when direct retrieval fails, with the parsed listing ID and slug title hint", async () => {
    tryFetchShopifyProductJson.mockResolvedValueOnce(null);
    fetchProductHtml.mockRejectedValueOnce(new MockProductFetchError("Server responded 403 for x", "http_error"));
    searchProductFallback.mockResolvedValueOnce({ matchType: "none" });

    await importSupplierProduct("https://www.etsy.com/listing/1502712698/handmade-mug");

    expect(searchProductFallback).toHaveBeenCalledWith(
      expect.objectContaining({
        sourcePlatform: "etsy",
        sourceUrl: "https://www.etsy.com/listing/1502712698/handmade-mug",
        listingId: "1502712698",
        title: "handmade mug",
        vendor: null,
      }),
    );
  });

  it("canonicalizes a locale-prefixed, tracking-parameter-laden Etsy share link before searching", async () => {
    tryFetchShopifyProductJson.mockResolvedValueOnce(null);
    fetchProductHtml.mockRejectedValueOnce(new MockProductFetchError("Server responded 403 for x", "http_error"));
    searchProductFallback.mockResolvedValueOnce({ matchType: "none" });

    await importSupplierProduct(
      "https://www.etsy.com/in-en/listing/4529233980/cherry-blossom-tree-lamp-pink-floral?ls=r&ref=hp_content_grouping-2-2&logging_key=abc%3Adef",
    );

    expect(searchProductFallback).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceUrl: "https://www.etsy.com/listing/4529233980/cherry-blossom-tree-lamp-pink-floral",
        listingId: "4529233980",
        title: "cherry blossom tree lamp pink floral",
      }),
    );
  });

  it("does not fall back to web search when Etsy direct retrieval already has enough (title + image)", async () => {
    tryFetchShopifyProductJson.mockResolvedValueOnce(FULL_SHOPIFY_JSON);
    const outcome = await importSupplierProduct("https://www.etsy.com/listing/1502712698");
    expect(outcome.mode).toBe("product");
    expect(searchProductFallback).not.toHaveBeenCalled();
  });

  it("returns mode 'product' with the exact match when the fallback confirms one", async () => {
    tryFetchShopifyProductJson.mockResolvedValueOnce(null);
    fetchProductHtml.mockRejectedValueOnce(new MockProductFetchError("Server responded 403 for x", "http_error"));
    searchProductFallback.mockResolvedValueOnce({
      matchType: "exact",
      product: {
        title: "Handmade Ceramic Mug",
        description: null,
        price: 24.99,
        compareAtPrice: null,
        currency: "USD",
        images: [{ url: "https://etsy.example/img.jpg", altText: null }],
        variants: [],
        options: [],
        vendor: null,
        productUrl: "https://www.etsy.com/listing/1502712698",
        source: "search_exact",
      },
    });

    const outcome = await importSupplierProduct("https://www.etsy.com/listing/1502712698");
    expect(outcome.mode).toBe("product");
    expect(outcome.mode === "product" && outcome.result.normalized?.title).toBe("Handmade Ceramic Mug");
    expect(outcome.mode === "product" && outcome.result.normalized?.source).toBe("search_exact");
  });

  it("returns mode 'related' with each candidate when no exact match is confirmed", async () => {
    tryFetchShopifyProductJson.mockResolvedValueOnce(null);
    fetchProductHtml.mockRejectedValueOnce(new MockProductFetchError("Server responded 403 for x", "http_error"));
    const relatedProduct = (title: string, url: string) => ({
      title,
      description: null,
      price: null,
      compareAtPrice: null,
      currency: null,
      images: [],
      variants: [],
      options: [],
      vendor: null,
      productUrl: url,
      source: "search_related" as const,
    });
    searchProductFallback.mockResolvedValueOnce({
      matchType: "related",
      products: [
        relatedProduct("Similar Mug A", "https://www.etsy.com/listing/1"),
        relatedProduct("Similar Mug B", "https://www.etsy.com/listing/2"),
      ],
    });

    const outcome = await importSupplierProduct("https://www.etsy.com/listing/1502712698");
    expect(outcome.mode).toBe("related");
    expect(outcome.mode === "related" && outcome.results).toHaveLength(2);
  });

  it("returns an honest failure when nothing exact or related is found", async () => {
    tryFetchShopifyProductJson.mockResolvedValueOnce(null);
    fetchProductHtml.mockRejectedValueOnce(new MockProductFetchError("Server responded 403 for x", "http_error"));
    searchProductFallback.mockResolvedValueOnce({ matchType: "none" });

    const outcome = await importSupplierProduct("https://www.etsy.com/listing/1502712698");
    expect(outcome.mode).toBe("product");
    expect(outcome.mode === "product" && outcome.result.status).toBe("failed");
    expect(outcome.mode === "product" && outcome.result.error).toMatch(/no matching or related products/);
  });

  it("surfaces a web-search configuration error honestly", async () => {
    tryFetchShopifyProductJson.mockResolvedValueOnce(null);
    fetchProductHtml.mockRejectedValueOnce(new MockProductFetchError("Server responded 403 for x", "http_error"));
    searchProductFallback.mockResolvedValueOnce({ matchType: "error", error: "Web search isn't configured — set OPENROUTER_API_KEY." });

    const outcome = await importSupplierProduct("https://www.etsy.com/listing/1502712698");
    expect(outcome.mode === "product" && outcome.result.error).toMatch(/OPENROUTER_API_KEY/);
  });
});

describe("importCompetitorStore", () => {
  it("rejects an invalid URL", async () => {
    const outcome = await importCompetitorStore("not a url");
    expect(outcome.error).toMatch(/not a valid URL/);
    expect(outcome.results).toEqual([]);
    expect(outcome.discovery).toEqual({ source: "none", discovered: 0, fetched: 0, succeeded: 0, failed: 0 });
  });
});
