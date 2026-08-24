import { describe, it, expect } from "vitest";
import {
  detectSupplierPlatform,
  isAmazonShortUrl,
  unsupportedSupplierMessage,
  SUPPORTED_SUPPLIER_PLATFORMS,
} from "./source";

describe("detectSupplierPlatform", () => {
  const cases: [string, string][] = [
    ["https://www.amazon.com/dp/B08N5WRWNW", "amazon"],
    ["https://www.amazon.co.uk/dp/B08N5WRWNW", "amazon"],
    ["https://www.etsy.com/listing/1502712698", "etsy"],
  ];

  it.each(cases)("detects %s as %s", (url, expected) => {
    expect(detectSupplierPlatform(new URL(url))).toBe(expected);
  });

  it("returns null for an unsupported platform", () => {
    expect(detectSupplierPlatform(new URL("https://example-supplier.com/product/1"))).toBeNull();
  });

  // AliExpress, Zendrop, and TeemDrop are intentionally not supported (no legitimate
  // programmatic access exists for TeemDrop; AliExpress/Zendrop are out of scope for now) —
  // these guard against silently re-adding them.
  it("returns null for platforms that are intentionally not supported", () => {
    expect(detectSupplierPlatform(new URL("https://www.aliexpress.com/item/123.html"))).toBeNull();
    expect(detectSupplierPlatform(new URL("https://zendrop.com/products/example"))).toBeNull();
    expect(detectSupplierPlatform(new URL("https://teemdrop.com/products/example"))).toBeNull();
  });

  it("does not match a lookalike hostname (prefix/suffix confusion)", () => {
    expect(detectSupplierPlatform(new URL("https://notaliexpress.com/item/1"))).toBeNull();
    expect(detectSupplierPlatform(new URL("https://amazon.evil.com/dp/1"))).toBeNull();
  });

  it("covers every documented supported platform", () => {
    expect(SUPPORTED_SUPPLIER_PLATFORMS.sort()).toEqual(["amazon", "etsy"].sort());
  });
});

describe("isAmazonShortUrl", () => {
  const shortUrls = [
    "https://amzn.in/d/0cuVjcaE",
    "https://amzn.to/3xyzabc",
    "https://a.co/d/abc123",
    "https://amzn.eu/d/abc123",
  ];

  it.each(shortUrls)("recognizes %s as an Amazon short link", (url) => {
    expect(isAmazonShortUrl(new URL(url))).toBe(true);
  });

  it("does not treat a full amazon.<tld> URL as a short link", () => {
    expect(isAmazonShortUrl(new URL("https://www.amazon.com/dp/B08N5WRWNW"))).toBe(false);
  });

  it("does not treat an unrelated host as an Amazon short link", () => {
    expect(isAmazonShortUrl(new URL("https://example.com/d/abc123"))).toBe(false);
  });
});

describe("unsupportedSupplierMessage", () => {
  it("names every supported platform, and none of the unsupported ones", () => {
    const message = unsupportedSupplierMessage();
    expect(message).toContain("Amazon");
    expect(message).toContain("Etsy");
    expect(message).not.toContain("AliExpress");
    expect(message).not.toContain("Zendrop");
    expect(message).not.toContain("Teemdrop");
  });
});
