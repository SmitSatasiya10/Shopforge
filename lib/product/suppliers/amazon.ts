import * as cheerio from "cheerio";

// Amazon-specific pieces of the supplier import flow: URL parsing (ASIN / slug title hint /
// canonical URL) used to build the generic web-search fallback's context when direct retrieval
// fails (Amazon commonly returns HTTP 200 containing a captcha page instead of product data),
// plus the static-HTML gap-filler for when direct retrieval succeeds.

/** The ASIN from /dp/<ASIN>, /gp/product/<ASIN>, or /gp/aw/d/<ASIN> — Amazon's product identifier. */
export function parseAmazonAsin(url: string): string | null {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  return pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?=[/?]|$)/i)?.[1]?.toUpperCase() ?? null;
}

/**
 * The product-name slug that precedes /dp/ ("/Some-Product-Name/dp/B0..." -> "Some Product
 * Name"). When Amazon serves a captcha page instead of product data, this is usually the only
 * title-like signal available to hand the web-search fallback.
 */
export function parseAmazonTitleHint(url: string): string | null {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  const slug = pathname.match(/\/([^/]+)\/dp\//i)?.[1];
  if (!slug || /^(gp|dp)$/i.test(slug)) return null;
  const words = decodeURIComponent(slug).replace(/-+/g, " ").trim();
  return words.length > 0 ? words : null;
}

/**
 * Strips the slug, locale oddities, and every query/tracking parameter, leaving just
 * https://<host>/dp/<ASIN>. Returns null when the URL doesn't name an ASIN at all.
 */
export function canonicalAmazonProductUrl(url: string): string | null {
  const asin = parseAmazonAsin(url);
  if (!asin) return null;
  try {
    return `https://${new URL(url).hostname}/dp/${asin}`;
  } catch {
    return null;
  }
}

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
