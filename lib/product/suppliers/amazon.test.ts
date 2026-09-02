import { describe, it, expect } from "vitest";
import {
  canonicalAmazonProductUrl,
  extractAmazonHtmlFallback,
  parseAmazonAsin,
  parseAmazonTitleHint,
} from "./amazon";

describe("Amazon URL parsing", () => {
  it("parses the ASIN from /dp/, /gp/product/, and /gp/aw/d/ URLs", () => {
    expect(parseAmazonAsin("https://www.amazon.in/Some-Product/dp/B0ABCDE123?ref=x")).toBe("B0ABCDE123");
    expect(parseAmazonAsin("https://www.amazon.com/gp/product/B0ABCDE123")).toBe("B0ABCDE123");
    expect(parseAmazonAsin("https://www.amazon.co.uk/gp/aw/d/B0ABCDE123/")).toBe("B0ABCDE123");
    expect(parseAmazonAsin("https://www.amazon.in/dp/b0abcde123")).toBe("B0ABCDE123"); // case-normalized
  });

  it("returns null when the URL names no ASIN (search/category/homepage)", () => {
    expect(parseAmazonAsin("https://www.amazon.in/s?k=tree+lamp")).toBeNull();
    expect(parseAmazonAsin("https://www.amazon.in/")).toBeNull();
    expect(parseAmazonAsin("https://www.amazon.in/dp/TOOSHORT")).toBeNull();
    expect(parseAmazonAsin("not a url")).toBeNull();
  });

  it("turns the pre-/dp/ slug into a title hint, preserving product-specific words", () => {
    expect(parseAmazonTitleHint("https://www.amazon.in/Cherry-Blossom-Tree-Lamp-Pink/dp/B0ABCDE123")).toBe(
      "Cherry Blossom Tree Lamp Pink",
    );
    expect(parseAmazonTitleHint("https://www.amazon.in/dp/B0ABCDE123")).toBeNull();
    expect(parseAmazonTitleHint("https://www.amazon.com/gp/product/B0ABCDE123")).toBeNull();
  });

  it("canonicalizes to https://<host>/dp/<ASIN>, stripping slug and tracking parameters", () => {
    expect(
      canonicalAmazonProductUrl("https://www.amazon.in/Cherry-Blossom-Lamp/dp/B0ABCDE123?ref=sr_1_1&keywords=lamp"),
    ).toBe("https://www.amazon.in/dp/B0ABCDE123");
    expect(canonicalAmazonProductUrl("https://www.amazon.in/s?k=lamp")).toBeNull();
  });
});

// Amazon product pages expose no JSON-LD/Open Graph data, but do statically render a
// #landingImage <img src> and a .a-price .a-offscreen price string — this is what the
// generic extractor misses and the supplier import path backfills from.
describe("extractAmazonHtmlFallback", () => {
  /** Encodes a {url: [w, h]} map the way it appears in the HTML attribute. */
  const dynamicAttr = (map: Record<string, [number, number]>) =>
    JSON.stringify(map).replace(/"/g, "&quot;");

  /** The ImageBlockATF inline script that carries Amazon's real gallery. */
  const galleryScript = (entries: { hiRes: string | null; large: string | null; variant: string }[]) =>
    `<script>var data = { 'colorImages': { 'initial': A.$.parseJSON('${JSON.stringify(entries)}') } };</script>`;

  it("reads the landing image src and the offscreen price/currency", () => {
    const html = `
      <html><body>
        <img id="landingImage" src="https://m.media-amazon.com/images/I/61OB0B7FA-L._SL1200_.jpg" data-old-hires="https://m.media-amazon.com/images/I/hires.jpg" />
        <span class="a-price"><span class="a-offscreen">₹76,999.00</span></span>
      </body></html>
    `;
    const result = extractAmazonHtmlFallback(html);
    expect(result.image).toBe("https://m.media-amazon.com/images/I/61OB0B7FA-L._SL1200_.jpg");
    expect(result.price).toBe(76999);
    expect(result.currency).toBe("INR");
  });

  it("falls back to data-old-hires when src is absent", () => {
    const html = `<img id="landingImage" data-old-hires="https://m.media-amazon.com/images/I/hires.jpg" />`;
    expect(extractAmazonHtmlFallback(html).image).toBe("https://m.media-amazon.com/images/I/hires.jpg");
  });

  it("falls back to data-a-dynamic-image when the page has no colorImages payload", () => {
    const dynamicImage = JSON.stringify({
      "https://m.media-amazon.com/images/I/61OB0B7FA-L._SL1200_.jpg": [1200, 1200],
      "https://m.media-amazon.com/images/I/71ABCDEF-L._SL1200_.jpg": [1200, 1200],
      "https://m.media-amazon.com/images/I/81GHIJKL-L._SL1200_.jpg": [1200, 1200],
    }).replace(/"/g, "&quot;");
    const html = `<img id="landingImage" src="https://m.media-amazon.com/images/I/61OB0B7FA-L._SL1200_.jpg" data-a-dynamic-image="${dynamicImage}" />`;
    const result = extractAmazonHtmlFallback(html);
    expect(result.image).toBe("https://m.media-amazon.com/images/I/61OB0B7FA-L._SL1200_.jpg");
    expect(result.images).toEqual([
      "https://m.media-amazon.com/images/I/61OB0B7FA-L._SL1200_.jpg",
      "https://m.media-amazon.com/images/I/71ABCDEF-L._SL1200_.jpg",
      "https://m.media-amazon.com/images/I/81GHIJKL-L._SL1200_.jpg",
    ]);
  });

  it("degrades to the single landing image when data-a-dynamic-image is malformed", () => {
    const html = `<img id="landingImage" src="https://m.media-amazon.com/images/I/61OB0B7FA-L._SL1200_.jpg" data-a-dynamic-image="{&quot;truncated" />`;
    const result = extractAmazonHtmlFallback(html);
    expect(result.image).toBe("https://m.media-amazon.com/images/I/61OB0B7FA-L._SL1200_.jpg");
    expect(result.images).toEqual(["https://m.media-amazon.com/images/I/61OB0B7FA-L._SL1200_.jpg"]);
  });

  it("images matches the single landing image when data-a-dynamic-image is absent", () => {
    const html = `<img id="landingImage" src="https://m.media-amazon.com/images/I/61OB0B7FA-L._SL1200_.jpg" />`;
    const result = extractAmazonHtmlFallback(html);
    expect(result.images).toEqual(["https://m.media-amazon.com/images/I/61OB0B7FA-L._SL1200_.jpg"]);
  });

  // The bug this guards against: data-a-dynamic-image is the responsive srcset for whichever
  // photo is on screen, so a real product page's map is one photo at seven widths. Harvesting
  // it made the wizard's image picker offer the same picture eight times.
  it("prefers the colorImages gallery over the srcset map", () => {
    const html = `
      <img id="landingImage" src="https://m.media-amazon.com/images/I/51THUMB-L._SY300_QL70_.jpg"
           data-a-dynamic-image="${dynamicAttr({
             "https://m.media-amazon.com/images/I/61AAA-L._SX466_.jpg": [466, 466],
             "https://m.media-amazon.com/images/I/61AAA-L._SX679_.jpg": [679, 679],
           })}" />
      ${galleryScript([
        { hiRes: "https://m.media-amazon.com/images/I/61AAA-L._SL1024_.jpg", large: null, variant: "MAIN" },
        { hiRes: "https://m.media-amazon.com/images/I/71BBB-L._SL1024_.jpg", large: null, variant: "PT01" },
      ])}
    `;
    const result = extractAmazonHtmlFallback(html);
    expect(result.images).toEqual([
      "https://m.media-amazon.com/images/I/61AAA-L._SL1024_.jpg",
      "https://m.media-amazon.com/images/I/71BBB-L._SL1024_.jpg",
    ]);
    // The full-size main photo also replaces the low-res landing thumbnail as `image`.
    expect(result.image).toBe("https://m.media-amazon.com/images/I/61AAA-L._SL1024_.jpg");
  });

  it("uses `large` when a gallery entry has no hiRes, and drops colour swatches", () => {
    const html = galleryScript([
      { hiRes: null, large: "https://m.media-amazon.com/images/I/51AAA-L.jpg", variant: "MAIN" },
      { hiRes: "https://m.media-amazon.com/images/I/71CHIP-L._SL1024_.jpg", large: null, variant: "SWATCH" },
    ]);
    expect(extractAmazonHtmlFallback(html).images).toEqual([
      "https://m.media-amazon.com/images/I/51AAA-L.jpg",
    ]);
  });

  it("keeps only the widest URL per photo when it falls back to the srcset map", () => {
    const html = `<img id="landingImage" src="https://m.media-amazon.com/images/I/61AAA-L._SY355_.jpg"
      data-a-dynamic-image="${dynamicAttr({
        "https://m.media-amazon.com/images/I/61AAA-L._SX466_.jpg": [466, 466],
        "https://m.media-amazon.com/images/I/61AAA-L._SX679_.jpg": [679, 679],
        "https://m.media-amazon.com/images/I/61AAA-L._SY355_.jpg": [355, 355],
      })}" />`;
    expect(extractAmazonHtmlFallback(html).images).toEqual([
      "https://m.media-amazon.com/images/I/61AAA-L._SX679_.jpg",
    ]);
  });

  it("falls back to the srcset map when the colorImages payload is truncated", () => {
    const html = `
      <img id="landingImage" src="https://m.media-amazon.com/images/I/61AAA-L._SX679_.jpg" />
      <script>var data = { 'colorImages': { 'initial': A.$.parseJSON('[{"hiRes":"https://m.med</script>
    `;
    expect(extractAmazonHtmlFallback(html).images).toEqual([
      "https://m.media-amazon.com/images/I/61AAA-L._SX679_.jpg",
    ]);
  });

  it("returns nulls when neither element is present", () => {
    const result = extractAmazonHtmlFallback("<html><body>no product here</body></html>");
    expect(result).toEqual({ title: null, brand: null, image: null, images: [], price: null, currency: null });
  });

  it("reads #productTitle rather than the marketplace <title>", () => {
    const html = `
      <html><head><title>Gurubhai Equipments Round Catering Burner 10x10 Inch : Amazon.in: Home &amp; Kitchen</title></head>
      <body><span id="productTitle">  Gurubhai Equipments Round Catering Burner 10x10 Inch  </span></body></html>
    `;
    expect(extractAmazonHtmlFallback(html).title).toBe("Gurubhai Equipments Round Catering Burner 10x10 Inch");
  });

  it("strips the marketplace suffix when #productTitle is absent", () => {
    const html = `<html><head><title>Round Catering Burner : Amazon.in: Home &amp; Kitchen</title></head><body></body></html>`;
    expect(extractAmazonHtmlFallback(html).title).toBe("Round Catering Burner");
  });

  it("reads the brand from the byline, in either of its two phrasings", () => {
    const visit = `<a id="bylineInfo">Visit the Gurubhai Equipments Store</a>`;
    expect(extractAmazonHtmlFallback(visit).brand).toBe("Gurubhai Equipments");
    const branded = `<a id="bylineInfo">Brand: Gurubhai Equipments</a>`;
    expect(extractAmazonHtmlFallback(branded).brand).toBe("Gurubhai Equipments");
  });

  it("handles USD pricing", () => {
    const html = `<span class="a-price"><span class="a-offscreen">$19.99</span></span>`;
    const result = extractAmazonHtmlFallback(html);
    expect(result.price).toBe(19.99);
    expect(result.currency).toBe("USD");
  });
});
