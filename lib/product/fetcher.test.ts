import { describe, it, expect } from "vitest";
import { parseProductUrl, fetchProductHtml, ProductFetchError } from "./fetcher";

describe("parseProductUrl", () => {
  it("accepts http/https URLs", () => {
    expect(parseProductUrl("https://example.com/products/x").hostname).toBe("example.com");
  });

  it("rejects a malformed URL", () => {
    expect(() => parseProductUrl("not a url")).toThrow(ProductFetchError);
  });

  it("rejects a non-http(s) scheme", () => {
    try {
      parseProductUrl("file:///etc/passwd");
      throw new Error("expected parseProductUrl to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ProductFetchError);
      expect((err as ProductFetchError).reason).toBe("invalid_url");
    }
  });
});

// SSRF guard (supplier-competitor-import-prompt.md §15): IP-literal private/loopback/
// link-local targets are rejected before any network call is made, so these assertions are
// fast and deterministic — no real network access required.
describe("fetchProductHtml SSRF guard", () => {
  const blocked = [
    "http://127.0.0.1/",
    "http://localhost/",
    "http://169.254.169.254/latest/meta-data/", // cloud metadata endpoint
    "http://10.0.0.5/",
    "http://192.168.1.1/",
    "http://172.16.0.1/",
    "http://[::1]/",
  ];

  it.each(blocked)("blocks %s", async (url) => {
    await expect(fetchProductHtml(url)).rejects.toMatchObject({ reason: "blocked_host" });
  });
});
