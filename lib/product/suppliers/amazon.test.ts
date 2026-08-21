import { describe, it, expect } from "vitest";
import { extractAmazonHtmlFallback } from "./amazon";

// Amazon product pages expose no JSON-LD/Open Graph data, but do statically render a
// #landingImage <img src> and a .a-price .a-offscreen price string — this is what the
// generic extractor misses and the supplier import path backfills from.
describe("extractAmazonHtmlFallback", () => {
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

  it("returns nulls when neither element is present", () => {
    const result = extractAmazonHtmlFallback("<html><body>no product here</body></html>");
    expect(result).toEqual({ title: null, brand: null, image: null, price: null, currency: null });
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
