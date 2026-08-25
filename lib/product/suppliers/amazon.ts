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
// server-rendered HTML still contains a plain #productTitle, a #landingImage <img src>, a
// #bylineInfo brand link and a screen-reader price string (.a-price .a-offscreen) — stable,
// well-known static markup, not something requiring JS execution or bypassing any
// protection. This fills gaps the generic JSON-LD/Open Graph extraction left empty; the one
// field it deliberately overrides is the title, because with no og:title on the page the
// generic path can only fall back to the <title> tag, which on Amazon is the marketplace
// listing title ("<product> : Amazon.in: Home & Kitchen") rather than the product's name.
//
// The main image element also carries data-a-dynamic-image — a JSON-encoded map of every
// gallery image's full-size URL to its [width, height] — in plain server-rendered HTML, the
// same "stable, no JS needed" category as the rest of this fallback. Parsed defensively: a
// missing or malformed attribute (Amazon changes markup without notice) degrades to the single
// landing image rather than throwing.
export interface AmazonHtmlFallback {
  title: string | null;
  brand: string | null;
  /** The main product image — kept for callers that only need one. */
  image: string | null;
  /** Every gallery image, main image first — from data-a-dynamic-image when present. */
  images: string[];
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

  const dynamicAttr = $("#landingImage, #imgTagWrapperId img").first().attr("data-a-dynamic-image");
  let gallery: string[] = [];
  if (dynamicAttr) {
    try {
      const parsed: unknown = JSON.parse(dynamicAttr);
      if (parsed && typeof parsed === "object") {
        gallery = Object.keys(parsed).filter((url) => !!url);
      }
    } catch {
      // malformed/truncated attribute — fall through to the single landing image below
    }
  }
  const images = gallery.length > 0 ? [...new Set([...(image ? [image] : []), ...gallery])] : image ? [image] : [];

  const priceText = $(".a-price .a-offscreen").first().text().trim();
  let price: number | null = null;
  let currency: string | null = null;
  if (priceText) {
    const symbol = priceText.match(/^\D+/)?.[0]?.trim();
    if (symbol) currency = CURRENCY_SYMBOLS[symbol] ?? null;
    const numeric = Number.parseFloat(priceText.replace(/[^0-9.]/g, ""));
    price = Number.isFinite(numeric) ? numeric : null;
  }

  return { title, brand, image, images, price, currency };
}
