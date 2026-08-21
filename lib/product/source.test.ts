import { describe, it, expect } from "vitest";
import { detectSupplierPlatform, unsupportedSupplierMessage, SUPPORTED_SUPPLIER_PLATFORMS } from "./source";

describe("detectSupplierPlatform", () => {
  const cases: [string, string][] = [
    ["https://www.aliexpress.com/item/123.html", "aliexpress"],
    ["https://aliexpress.us/item/123.html", "aliexpress"],
    ["https://www.amazon.com/dp/B08N5WRWNW", "amazon"],
    ["https://www.amazon.co.uk/dp/B08N5WRWNW", "amazon"],
    ["https://zendrop.com/products/example", "zendrop"],
    ["https://app.zendrop.com/products/example", "zendrop"],
    ["https://teemdrop.com/products/example", "teemdrop"],
    ["https://www.etsy.com/listing/1502712698", "etsy"],
  ];

  it.each(cases)("detects %s as %s", (url, expected) => {
    expect(detectSupplierPlatform(new URL(url))).toBe(expected);
  });

  it("returns null for an unsupported platform", () => {
    expect(detectSupplierPlatform(new URL("https://example-supplier.com/product/1"))).toBeNull();
  });

  it("does not match a lookalike hostname (prefix/suffix confusion)", () => {
    expect(detectSupplierPlatform(new URL("https://notaliexpress.com/item/1"))).toBeNull();
    expect(detectSupplierPlatform(new URL("https://amazon.evil.com/dp/1"))).toBeNull();
  });

  it("covers every documented supported platform", () => {
    expect(SUPPORTED_SUPPLIER_PLATFORMS.sort()).toEqual(
      ["aliexpress", "amazon", "zendrop", "teemdrop", "etsy"].sort(),
    );
  });
});

describe("unsupportedSupplierMessage", () => {
  it("names every supported platform", () => {
    const message = unsupportedSupplierMessage();
    expect(message).toContain("AliExpress");
    expect(message).toContain("Amazon");
    expect(message).toContain("Zendrop");
    expect(message).toContain("Teemdrop");
    expect(message).toContain("Etsy");
  });
});
