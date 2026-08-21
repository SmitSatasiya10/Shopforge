import * as cheerio from "cheerio";

// Amazon exposes neither JSON-LD nor Open Graph product data on its product pages, but the
// server-rendered HTML still contains a plain #productTitle, a #landingImage <img src>, a
// #bylineInfo brand link and a screen-reader price string (.a-price .a-offscreen) — stable,
// well-known static markup, not something requiring JS execution or bypassing any
// protection. This fills gaps the generic JSON-LD/Open Graph extraction left empty; the one
// field it deliberately overrides is the title, because with no og:title on the page the
// generic path can only fall back to the <title> tag, which on Amazon is the marketplace
// listing title ("<product> : Amazon.in: Home & Kitchen") rather than the product's name.
export interface AmazonHtmlFallback {
  title: string | null;
  brand: string | null;
  image: string | null;
  price: number | null;
  currency: string | null;
}

const CURRENCY_SYMBOLS: Record<string, string> = { "₹": "INR", "$": "USD", "£": "GBP", "€": "EUR", "¥": "JPY" };

/**
 * Strips the marketplace suffix Amazon appends to the document title — " : Amazon.in: Home
 * & Kitchen", " - Amazon.com", ": Amazon.co.uk: Electronics". Only used when #productTitle
 * itself is missing, so the worst case is a title that is merely no worse than before.
 */
function stripMarketplaceSuffix(title: string): string {
  return title.replace(/\s*[:|\-–]\s*Amazon\.[a-z.]+\b.*$/i, "").trim();
}

/** `<a id="bylineInfo">Visit the Gurubhai Equipments Store</a>` / `Brand: Gurubhai`. */
function cleanByline(byline: string): string | null {
  const brand = byline
    .replace(/^\s*visit\s+the\s+/i, "")
    .replace(/\s+store\s*$/i, "")
    .replace(/^\s*brand:\s*/i, "")
    .trim();
  return brand || null;
}

export function extractAmazonHtmlFallback(html: string): AmazonHtmlFallback {
  const $ = cheerio.load(html);

  const productTitle = $("#productTitle").first().text().trim();
  const documentTitle = $("title").first().text().trim();
  const title =
    productTitle || (documentTitle ? stripMarketplaceSuffix(documentTitle) || null : null) || null;

  const bylineText = $("#bylineInfo").first().text().trim();
  const brand = bylineText ? cleanByline(bylineText) : null;

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

  return { title, brand, image, price, currency };
}
