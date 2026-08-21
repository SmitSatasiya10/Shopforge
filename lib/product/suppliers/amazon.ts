import * as cheerio from "cheerio";

// Amazon exposes neither JSON-LD nor Open Graph product data on its product pages, but the
// server-rendered HTML still contains a plain #landingImage <img src> and a screen-reader
// price string (.a-price .a-offscreen) — stable, well-known static markup, not something
// requiring JS execution or bypassing any protection. This only fills gaps the generic
// JSON-LD/Open Graph extraction left empty; it never overrides what was already found.
export interface AmazonHtmlFallback {
  image: string | null;
  price: number | null;
  currency: string | null;
}

const CURRENCY_SYMBOLS: Record<string, string> = { "₹": "INR", "$": "USD", "£": "GBP", "€": "EUR", "¥": "JPY" };

export function extractAmazonHtmlFallback(html: string): AmazonHtmlFallback {
  const $ = cheerio.load(html);

  const landingImage = $("#landingImage");
  const image = landingImage.attr("src") ?? landingImage.attr("data-old-hires") ?? null;

  const priceText = $(".a-price .a-offscreen").first().text().trim();
  let price: number | null = null;
  let currency: string | null = null;
  if (priceText) {
    const symbol = priceText.match(/^\D+/)?.[0]?.trim();
    if (symbol) currency = CURRENCY_SYMBOLS[symbol] ?? null;
    const numeric = Number.parseFloat(priceText.replace(/[^0-9.]/g, ""));
    price = Number.isFinite(numeric) ? numeric : null;
  }

  return { image, price, currency };
}
