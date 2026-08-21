import { describe, it, expect, vi } from "vitest";

const fetchJsonWithLimits = vi.fn();
const fetchTextWithLimits = vi.fn();
vi.mock("./fetcher", () => ({
  fetchJsonWithLimits: (...args: unknown[]) => fetchJsonWithLimits(...args),
  fetchTextWithLimits: (...args: unknown[]) => fetchTextWithLimits(...args),
}));

const { discoverProductUrls } = await import("./discovery");

const ORIGIN = "https://competitor-store.com";

describe("discoverProductUrls", () => {
  it("prefers products.json when it returns product handles", async () => {
    fetchJsonWithLimits.mockResolvedValueOnce({ products: [{ handle: "a" }, { handle: "b" }] });
    const { urls, source } = await discoverProductUrls(ORIGIN);
    expect(source).toBe("products_json");
    expect(urls).toEqual([`${ORIGIN}/products/a`, `${ORIGIN}/products/b`]);
  });

  it("falls back to homepage links and accepts /product/ and /p/ patterns, not just /products/", async () => {
    fetchJsonWithLimits.mockResolvedValueOnce(null); // products.json
    fetchTextWithLimits.mockResolvedValueOnce(null); // sitemap.xml
    fetchTextWithLimits.mockResolvedValueOnce(`
      <html><body>
        <a href="/products/shopify-style">A</a>
        <a href="/product/generic-style">B</a>
        <a href="/p/short-style">C</a>
        <a href="/about-us">Not a product</a>
        <a href="https://other-site.com/products/off-site">Off-origin</a>
      </body></html>
    `); // homepage

    const { urls, source } = await discoverProductUrls(ORIGIN);
    expect(source).toBe("homepage_links");
    expect(urls.sort()).toEqual(
      [`${ORIGIN}/products/shopify-style`, `${ORIGIN}/product/generic-style`, `${ORIGIN}/p/short-style`].sort(),
    );
  });

  it("returns source 'none' when nothing is discoverable", async () => {
    fetchJsonWithLimits.mockResolvedValueOnce(null);
    fetchTextWithLimits.mockResolvedValueOnce(null); // sitemap
    fetchTextWithLimits.mockResolvedValueOnce(null); // homepage
    const { urls, source } = await discoverProductUrls(ORIGIN);
    expect(urls).toEqual([]);
    expect(source).toBe("none");
  });
});
