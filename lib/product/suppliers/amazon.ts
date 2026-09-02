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
// Product photos come from the ImageBlockATF script's 'colorImages' payload — the one part
// of the server-rendered HTML that lists the gallery's distinct photos, in the same "stable,
// no JS needed" category as the rest of this fallback. #landingImage's data-a-dynamic-image
// is deliberately NOT treated as a gallery: it is the responsive srcset for whichever photo
// is on screen, so harvesting its keys yields one photo repeated at seven widths rather than
// seven photos. It stays as a fallback, narrowed to the widest URL per photo. Both are parsed
// defensively — Amazon changes markup without notice, so a missing or malformed payload
// degrades to the single landing image rather than throwing.
export interface AmazonHtmlFallback {
  title: string | null;
  brand: string | null;
  /** The main product image — kept for callers that only need one. */
  image: string | null;
  /** Every distinct gallery photo, main photo first, deduped across resolution variants. */
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

interface ColorImageEntry {
  hiRes?: string | null;
  large?: string | null;
  variant?: string | null;
}

/**
 * Amazon's actual gallery, from the ImageBlockATF inline script:
 * `'colorImages': { 'initial': A.$.parseJSON('[{"hiRes":...,"large":...,"variant":"MAIN"},...]') }`
 * — one entry per distinct photo, already in the page's server-rendered HTML (no JS
 * execution needed). This is the only place the static markup lists separate photos, so it
 * is tried before the srcset map. `hiRes` is null on some entries (Amazon omits it for
 * smaller source images), in which case `large` is the best available. Swatch entries are
 * colour chips, not product photography, so they're dropped.
 */
function extractColorImagesGallery(html: string): string[] {
  const marker = html.indexOf("'colorImages'");
  if (marker === -1) return [];
  const open = html.indexOf("parseJSON('", marker);
  if (open === -1) return [];
  const from = open + "parseJSON('".length;
  const end = html.indexOf("')", from);
  if (end === -1) return [];

  let entries: unknown;
  try {
    entries = JSON.parse(html.slice(from, end));
  } catch {
    return []; // markup changed or the payload is truncated — fall back to the srcset map
  }
  if (!Array.isArray(entries)) return [];

  return (entries as ColorImageEntry[])
    .filter((entry) => entry && !/swatch/i.test(entry.variant ?? ""))
    .map((entry) => entry.hiRes || entry.large || null)
    .filter((url): url is string => typeof url === "string" && url.startsWith("http"));
}

/**
 * `data-a-dynamic-image` is a responsive-srcset map ({url: [width, height]}) for whichever
 * photo is currently displayed — NOT the gallery it looks like. Every key is usually the
 * same photo at a different width, so the widest one per photo is the only useful entry.
 * Kept as the fallback for pages whose ImageBlockATF payload doesn't parse.
 */
function widestPerPhoto(dynamicAttr: string | undefined): string[] {
  if (!dynamicAttr) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(dynamicAttr);
  } catch {
    return []; // malformed/truncated attribute — caller degrades to the landing image
  }
  if (!parsed || typeof parsed !== "object") return [];

  const widthOf = (value: unknown) => (Array.isArray(value) && typeof value[0] === "number" ? value[0] : 0);
  return Object.entries(parsed as Record<string, unknown>)
    .filter(([url]) => !!url)
    .sort((a, b) => widthOf(b[1]) - widthOf(a[1]))
    .map(([url]) => url);
}

/**
 * The photo's identity in an Amazon image URL is the segment before the first "." —
 * `.../images/I/61NHuGlkAQL._SX679_.jpg` and `.../61NHuGlkAQL._SY355_.jpg` are one photo at
 * two widths. Collapsing on it is what stops the image picker from offering the same
 * picture eight times.
 */
function amazonPhotoId(url: string): string {
  return url.match(/\/images\/I\/([^./]+)/)?.[1] ?? url;
}

function dedupeByPhoto(urls: string[]): string[] {
  const seen = new Set<string>();
  return urls.filter((url) => {
    const id = amazonPhotoId(url);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
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
  const landingSrc = landingImage.attr("src") ?? landingImage.attr("data-old-hires") ?? null;

  const dynamicAttr = $("#landingImage, #imgTagWrapperId img").first().attr("data-a-dynamic-image");
  const gallery = extractColorImagesGallery(html);
  // When the gallery parsed it is already complete, and #landingImage's src is a low-res
  // thumbnail of a photo it contains — served under its own image id, so dedupeByPhoto
  // can't recognise it as a duplicate. Appending it would add a blurry ninth tile.
  const ordered =
    gallery.length > 0
      ? gallery
      : [...widestPerPhoto(dynamicAttr), ...(landingSrc ? [landingSrc] : [])];
  const images = dedupeByPhoto(ordered);
  // The gallery's first entry is the full-size main photo, while #landingImage's src is
  // often a low-res QL70 placeholder — prefer the former whenever the gallery parsed.
  const image = images[0] ?? landingSrc;

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
