import * as cheerio from "cheerio";

// RawProductExtractor — pulls unstructured raw data out of an HTML page,
// preferring structured data over fragile DOM selectors (prototype-phase-plan.md §8).

export interface JsonLdExtraction {
  source: "jsonld";
  data: Record<string, unknown>;
}

export interface OpenGraphExtraction {
  source: "opengraph";
  data: {
    title: string | null;
    description: string | null;
    image: string | null;
    priceAmount: string | null;
    priceCurrency: string | null;
  };
}

export type RawExtraction = JsonLdExtraction | OpenGraphExtraction;

function findProductInJsonLd(node: unknown): Record<string, unknown> | null {
  if (Array.isArray(node)) {
    for (const entry of node) {
      const found = findProductInJsonLd(entry);
      if (found) return found;
    }
    return null;
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    const type = obj["@type"];
    const isProduct = type === "Product" || (Array.isArray(type) && type.includes("Product"));
    if (isProduct) return obj;
    if (obj["@graph"]) return findProductInJsonLd(obj["@graph"]);
  }
  return null;
}

export function extractJsonLd(html: string): JsonLdExtraction | null {
  const $ = cheerio.load(html);
  const scripts = $('script[type="application/ld+json"]');
  for (const el of scripts.toArray()) {
    const text = $(el).text();
    if (!text?.trim()) continue;
    try {
      const parsed = JSON.parse(text);
      const product = findProductInJsonLd(parsed);
      if (product) return { source: "jsonld", data: product };
    } catch {
      // malformed JSON-LD block — skip, try the next script tag
    }
  }
  return null;
}

export function extractOpenGraph(html: string): OpenGraphExtraction | null {
  const $ = cheerio.load(html);
  const meta = (property: string) => $(`meta[property="${property}"]`).attr("content") ?? null;
  const metaName = (name: string) => $(`meta[name="${name}"]`).attr("content") ?? null;

  const ogTitle = meta("og:title");
  const bareTitle = $("title").first().text().trim() || null;
  const title = ogTitle ?? bareTitle;
  const description = meta("og:description") ?? metaName("description");
  const image = meta("og:image");
  const priceAmount = meta("product:price:amount") ?? meta("og:price:amount");
  const priceCurrency = meta("product:price:currency") ?? meta("og:price:currency");

  // og:title, og:image, and a price tag are deliberate, page-specific signals — any one of
  // them alone is enough. A bare <title> is not: it's present even on a client-rendered app
  // shell with zero real content (e.g. a Vue/Nuxt seller dashboard whose static HTML says
  // just "<title>Zendrop</title>", or "<title>TeemDrop Seller Dashboard | Dropshipping
  // Fulfillment Home</title>" on EVERY route regardless of which product ID is in the URL —
  // multi-word, so a word-count check alone doesn't catch it, and its <meta
  // name="description"> is equally generic site-wide boilerplate, so that doesn't
  // corroborate it either). What reliably does: a real product page — even a plain custom
  // site with no formal JSON-LD/OG markup at all — almost always renders at least one real
  // <img> somewhere in its static HTML, because showing the product IS the page (confirmed
  // against a real Amazon product page: 27 <img> tags with no OG/JSON-LD). An auth-gated
  // app shell that only renders content after login/JS hydration has none at all. So a bare
  // <title> is trusted only when it's multi-word AND the page has at least one <img> tag —
  // neither alone is enough to tell a real product page apart from a bare app shell.
  const hasDeliberateSignal = !!ogTitle || !!image || !!priceAmount;
  const bareTitleLooksSpecific =
    !!bareTitle && bareTitle.trim().split(/\s+/).length >= 2 && $("img").length > 0;
  if (!hasDeliberateSignal && !bareTitleLooksSpecific) return null;

  return {
    source: "opengraph",
    data: { title, description, image, priceAmount, priceCurrency },
  };
}

/** Tries JSON-LD first, falls back to Open Graph tags. Returns null for an unsupported page. */
export function extractFromHtml(html: string): RawExtraction | null {
  return extractJsonLd(html) ?? extractOpenGraph(html);
}
