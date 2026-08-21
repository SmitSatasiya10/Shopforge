import { describe, it, expect } from "vitest";
import { extractOpenGraph } from "./extractor";

describe("extractOpenGraph", () => {
  it("accepts og:title alone, even with nothing else", () => {
    const html = `<html><head><meta property="og:title" content="Real Product" /></head></html>`;
    expect(extractOpenGraph(html)?.data.title).toBe("Real Product");
  });

  it("accepts og:image alone", () => {
    const html = `<html><head><meta property="og:image" content="https://example.com/a.jpg" /></head></html>`;
    expect(extractOpenGraph(html)?.data.image).toBe("https://example.com/a.jpg");
  });

  it("accepts a multi-word bare <title> with no OG tags, when the page has a real <img> (e.g. Amazon: no OG/JSON-LD at all, but a real per-page <title> plus a static #landingImage)", () => {
    const html = `
      <html><head>
        <title>iQOO 15 (Legend, 12GB RAM) : Amazon.in: Electronics</title>
        <meta name="description" content="iQOO 15 (Legend, 12GB RAM) : Amazon.in: Electronics" />
      </head><body><img id="landingImage" src="https://m.media-amazon.com/images/I/x.jpg" /></body></html>
    `;
    const result = extractOpenGraph(html);
    expect(result?.data.title).toContain("iQOO 15");
    expect(result?.data.description).toContain("iQOO 15");
  });

  it("rejects a single-word bare <title> (client-rendered app shell, e.g. Zendrop's SPA, whose <title> is just the site name on every route)", () => {
    const html = `
      <html><head>
        <title>Zendrop</title>
        <meta name="description" content="Zendrop is an e-Commerce fulfillment solution for dropshippers." />
      </head><body><div id="app"></div></body></html>
    `;
    expect(extractOpenGraph(html)).toBeNull();
  });

  it("rejects a multi-word bare <title> with no <img> anywhere (e.g. TeemDrop's seller-dashboard SPA: the same generic 'TeemDrop Seller Dashboard | Dropshipping Fulfillment Home' title/description on every product-detail URL, zero <img> tags in the static shell)", () => {
    const html = `
      <html><head>
        <title>TeemDrop Seller Dashboard | Dropshipping Fulfillment Home</title>
        <meta name="description" content="Access your TeemDrop seller dashboard for dropshipping fulfillment. Fast login for store owners." />
      </head><body><div id="app"></div></body></html>
    `;
    expect(extractOpenGraph(html)).toBeNull();
  });

  it("rejects a page with no title and no image at all", () => {
    expect(extractOpenGraph("<html><head></head><body></body></html>")).toBeNull();
  });
});
