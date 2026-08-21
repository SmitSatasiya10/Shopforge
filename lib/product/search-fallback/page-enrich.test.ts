import { describe, it, expect, vi } from "vitest";
import { enrichCandidatesFromPages } from "./page-enrich";
import type { NormalizedProduct } from "../types";

const candidate = (overrides: Partial<NormalizedProduct>): NormalizedProduct => ({
  title: "Cherry Blossom Tree Lamp",
  description: null,
  price: null,
  compareAtPrice: null,
  currency: null,
  images: [],
  variants: [],
  options: [],
  vendor: null,
  productUrl: "https://www.etsy.com/listing/42/cherry-blossom-tree-lamp",
  source: "search_related",
  ...overrides,
});

const JSONLD_PAGE = `
  <html><head><script type="application/ld+json">
    {"@type":"Product","name":"Cherry Blossom Tree Lamp","description":"A pink lamp.",
     "image":"https://i.etsystatic.com/1/r/il/aa/il_570xN.111.jpg",
     "offers":{"price":"64.27","priceCurrency":"USD"}}
  </script></head><body></body></html>`;

const OG_PAGE = `
  <html><head>
    <meta property="og:title" content="Cherry Blossom Tree Lamp" />
    <meta property="og:image" content="https://i.etsystatic.com/1/r/il/bb/il_570xN.222.jpg" />
  </head><body></body></html>`;

describe("enrichCandidatesFromPages", () => {
  it("fills image/price/description from the candidate page's JSON-LD", async () => {
    const fetchText = vi.fn().mockResolvedValue(JSONLD_PAGE);
    const [enriched] = await enrichCandidatesFromPages("etsy", [candidate({})], fetchText);
    expect(fetchText).toHaveBeenCalledWith("https://www.etsy.com/listing/42/cherry-blossom-tree-lamp");
    expect(enriched.images).toEqual([
      { url: "https://i.etsystatic.com/1/r/il/aa/il_570xN.111.jpg", altText: "Cherry Blossom Tree Lamp" },
    ]);
    expect(enriched.price).toBe(64.27);
    expect(enriched.currency).toBe("USD");
    expect(enriched.description).toBe("A pink lamp.");
  });

  it("falls back to og:image when the page has no JSON-LD", async () => {
    const fetchText = vi.fn().mockResolvedValue(OG_PAGE);
    const [enriched] = await enrichCandidatesFromPages("etsy", [candidate({})], fetchText);
    expect(enriched.images[0]?.url).toBe("https://i.etsystatic.com/1/r/il/bb/il_570xN.222.jpg");
  });

  it("passes candidates through unchanged when the page fetch is blocked (Etsy 403s live)", async () => {
    const fetchText = vi.fn().mockResolvedValue(null);
    const input = candidate({});
    const [enriched] = await enrichCandidatesFromPages("etsy", [input], fetchText);
    expect(enriched).toEqual(input);
  });

  it("never overwrites fields the candidate already has", async () => {
    const fetchText = vi.fn().mockResolvedValue(JSONLD_PAGE);
    const input = candidate({
      images: [{ url: "https://i.etsystatic.com/existing.jpg", altText: null }],
      price: 10,
      currency: "EUR",
    });
    const [enriched] = await enrichCandidatesFromPages("etsy", [input], fetchText);
    expect(enriched.images).toEqual(input.images);
    expect(enriched.price).toBe(10);
    expect(enriched.currency).toBe("EUR");
    expect(enriched.description).toBe("A pink lamp."); // only the gap fills
  });

  it("skips fetching candidates that are already complete", async () => {
    const fetchText = vi.fn();
    const complete = candidate({
      images: [{ url: "https://i.etsystatic.com/x.jpg", altText: null }],
      price: 10,
      description: "done",
    });
    await enrichCandidatesFromPages("etsy", [complete], fetchText);
    expect(fetchText).not.toHaveBeenCalled();
  });

  it("uses Amazon's #landingImage static-HTML fallback when structured data is absent", async () => {
    const fetchText = vi.fn().mockResolvedValue(`
      <html><head><title>Sakura Tree Lamp Pink Blossom</title></head><body>
        <img id="landingImage" src="https://m.media-amazon.com/images/I/71abc.jpg" />
        <span class="a-price"><span class="a-offscreen">₹1,299.00</span></span>
      </body></html>`);
    const [enriched] = await enrichCandidatesFromPages(
      "amazon",
      [candidate({ productUrl: "https://www.amazon.in/dp/B0ABCDE123" })],
      fetchText,
    );
    expect(enriched.images[0]?.url).toBe("https://m.media-amazon.com/images/I/71abc.jpg");
    expect(enriched.price).toBe(1299);
  });

  it("passes products through untouched for a platform with no search config", async () => {
    const fetchText = vi.fn();
    const input = candidate({});
    const result = await enrichCandidatesFromPages("aliexpress", [input], fetchText);
    expect(result).toEqual([input]);
    expect(fetchText).not.toHaveBeenCalled();
  });
});
