// Etsy's product pages return a DataDome bot-detection challenge (HTTP 403) on every
// server-side fetch, so the generic JSON-LD/Open Graph pipeline used for the rest of the
// supplier-import flow can never reliably retrieve Etsy product data. Etsy import instead
// relies on the generic web-search fallback (lib/product/search-fallback/): this module holds
// the Etsy-specific pieces of that flow — URL parsing (listing ID / slug title hint /
// canonical URL) plus post-search enrichment from Etsy's public per-shop RSS feed, the one
// Etsy endpoint that is NOT behind bot detection and that carries listing images, prices, and
// descriptions the search fallback's text-only tools can never see.

import { fetchTextWithLimits } from "../fetcher";
import { coreSearchQuery, scoreTitleRelevance } from "../search-fallback/relevance";
import type { NormalizedProduct } from "../types";

export function parseEtsyListingId(url: string): string | null {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  return pathname.match(/\/listing\/(\d+)/)?.[1] ?? null;
}

/**
 * The listing URL's slug turned back into words ("cherry-blossom-tree-lamp" -> "cherry blossom
 * tree lamp"). Direct Etsy retrieval essentially always 403s, so this is usually the only
 * title-like signal available to hand the web-search fallback — searching by bare listing ID
 * alone mostly matches unrelated numeric identifiers on other sites.
 */
export function parseEtsyListingTitleHint(url: string): string | null {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  const slug = pathname.match(/\/listing\/\d+\/([^/]+)/)?.[1];
  if (!slug) return null;
  const words = decodeURIComponent(slug).replace(/-+/g, " ").trim();
  return words.length > 0 ? words : null;
}

/**
 * Strips the locale prefix (/in-en/, /ca/, ...) and every query/tracking parameter, leaving
 * just https://www.etsy.com/listing/<id>[/<slug>]. Share links off Etsy's homepage carry long
 * ref/logging parameters (some double-URL-encoded) that only pollute the search prompt.
 * Returns null when the URL isn't a listing URL at all.
 */
export function canonicalEtsyListingUrl(url: string): string | null {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  const match = pathname.match(/\/listing\/(\d+)(?:\/([^/]+))?/);
  if (!match) return null;
  const slug = match[2] ? `/${match[2]}` : "";
  return `https://www.etsy.com/listing/${match[1]}${slug}`;
}

// ---------------------------------------------------------------------------
// Shop-RSS enrichment
//
// The web-search fallback's search/fetch tools only ever see cleaned page text — no image
// URLs — so its candidates come back with images: [] and often a missing price/description.
// https://www.etsy.com/shop/<name>/rss is a public RSS feed of a shop's recent listings whose
// items DO carry the main listing image (i.etsystatic.com), a "<price> <CUR>" line, the
// description, and the canonical listing link. Matching candidates against that feed (by
// listing ID when the candidate URL has one, else by title) fills those gaps legitimately.

export interface EtsyRssListing {
  listingId: string | null;
  title: string | null;
  imageUrl: string | null;
  price: number | null;
  currency: string | null;
  description: string | null;
  listingUrl: string | null;
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function tagText(item: string, tag: string): string | null {
  const raw = item.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1]?.trim();
  return raw ? decodeXmlEntities(raw) : null;
}

export function parseEtsyShopRss(xml: string): EtsyRssListing[] {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  return items.map((item) => {
    const link = tagText(item, "link");
    // The <description> is XML-escaped HTML: an <img>, a <p class="price">, a <p class="description">.
    const descHtml = tagText(item, "description") ?? "";
    const priceMatch = descHtml.match(/<p class="price">([\d.,]+)\s+([A-Z]{3})<\/p>/);
    const descBody = descHtml.match(/<p class="description">([\s\S]*?)<\/p>/)?.[1] ?? null;
    return {
      listingId: link ? parseEtsyListingId(link) : null,
      // RSS titles end in " by <ShopName>" — strip it so they compare cleanly against candidate titles.
      title: tagText(item, "title")?.replace(/ by \S+$/, "") ?? null,
      imageUrl: descHtml.match(/<img src="(https:\/\/i\.etsystatic\.com\/[^"]+)"/)?.[1] ?? null,
      price: priceMatch ? Number(priceMatch[1].replace(/,/g, "")) : null,
      currency: priceMatch?.[2] ?? null,
      listingUrl: link ? canonicalEtsyListingUrl(link) : null,
      description: descBody
        ? decodeXmlEntities(descBody.replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, "")).trim() || null
        : null,
    };
  });
}

/** Shop names are single alphanumeric tokens; anything else is not safe to splice into a URL. */
const SHOP_NAME_RE = /^[A-Za-z0-9]{3,}$/;

function shopNameFor(product: NormalizedProduct): string | null {
  if (product.vendor && SHOP_NAME_RE.test(product.vendor)) return product.vendor;
  try {
    const match = new URL(product.productUrl).pathname.match(/\/shop\/([A-Za-z0-9]{3,})(?:\/|$)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function matchRssListing(product: NormalizedProduct, listings: EtsyRssListing[]): EtsyRssListing | null {
  const listingId = parseEtsyListingId(product.productUrl);
  if (listingId) {
    const byId = listings.find((l) => l.listingId === listingId);
    if (byId) return byId;
    // The candidate URL names a specific listing that isn't in the feed — a title match against
    // some OTHER recent listing would attach the wrong product's image, so don't attempt one.
    return null;
  }
  if (!product.title) return null;
  const wanted = normalizeTitle(product.title);
  if (wanted.length < 10) return null; // too short to trust a containment match
  return (
    listings.find((l) => {
      const got = l.title ? normalizeTitle(l.title) : "";
      return got.length > 0 && (got.includes(wanted) || wanted.includes(got));
    }) ?? null
  );
}

/**
 * Fills each product's missing image/price/currency/description from its shop's public RSS
 * feed, and upgrades a shop-page productUrl to the matched listing's canonical URL. Products
 * that can't be matched (no shop name, feed unreachable, listing not among the shop's recent
 * items) pass through unchanged — enrichment is strictly best-effort and never drops or
 * reorders anything. One feed fetch per distinct shop, cached across the batch.
 */
/** One feed fetch per distinct shop, cached across a whole enrichment pass (incl. the top-up). */
function createShopFeedCache(fetchText: (url: string) => Promise<string | null>) {
  const feedCache = new Map<string, Promise<EtsyRssListing[]>>();
  return (shop: string): Promise<EtsyRssListing[]> => {
    let feed = feedCache.get(shop);
    if (!feed) {
      feed = fetchText(`https://www.etsy.com/shop/${shop}/rss`).then((xml) => (xml ? parseEtsyShopRss(xml) : []));
      feedCache.set(shop, feed);
    }
    return feed;
  };
}

export async function enrichEtsyProductsViaShopRss(
  products: NormalizedProduct[],
  fetchText: (url: string) => Promise<string | null> = fetchTextWithLimits,
  feedFor: (shop: string) => Promise<EtsyRssListing[]> = createShopFeedCache(fetchText),
): Promise<NormalizedProduct[]> {
  return Promise.all(
    products.map(async (product) => {
      const complete = product.images.length > 0 && product.price !== null && product.description !== null;
      const shop = complete ? null : shopNameFor(product);
      if (!shop) return product;

      const listings = await feedFor(shop);

      const match = matchRssListing(product, listings);
      if (!match) return product;

      return {
        ...product,
        images: product.images.length === 0 && match.imageUrl ? [{ url: match.imageUrl, altText: product.title }] : product.images,
        price: product.price ?? match.price,
        currency: product.currency ?? match.currency,
        description: product.description ?? match.description,
        productUrl: parseEtsyListingId(product.productUrl) ? product.productUrl : match.listingUrl ?? product.productUrl,
      };
    }),
  );
}

// ---------------------------------------------------------------------------
// Full search-candidate enrichment pipeline
//
// Diagnosed live: related candidates come back from the search layer with vendor:null across
// the board, and without a shop name the RSS feed — the only bot-open Etsy endpoint carrying
// listing images — can never be consulted, which is exactly why every related card showed
// "No image". This pipeline closes that gap in four best-effort stages:
//   1. resolve missing shop names via one bounded search-model call (vendor-resolution.ts),
//   2. run the existing per-shop RSS enrichment (fills image/price/description by listing ID),
//   3. discover shops selling this kind of product (shop-discovery.ts) and scan their feeds
//      for the REQUESTED listing ID — a brand-new (hence un-indexed) listing is by definition
//      recent, i.e. inside its shop's RSS window, so this recovers the exact product with its
//      real image/price/description (verified live for an organza phone strap),
//   4. related mode only: top up the candidate list with *relevant* listings from all known
//      shops' feeds — RSS items carry a guaranteed real image/price/description, and a shop
//      that sells one matching product usually sells siblings of it (verified live: the shop
//      behind a beige bucket-bag listing had two more leather bucket bags in its feed).

const MAX_RELATED_CANDIDATES = 5;
/** Top-ups are our own picks (not search results), so they must clear a higher relevance bar. */
const TOPUP_MIN_SCORE = 0.5;

type CompleteRssListing = EtsyRssListing & { title: string; imageUrl: string; listingUrl: string };

function isCompleteRssListing(item: EtsyRssListing): item is CompleteRssListing {
  return !!item.title && !!item.imageUrl && !!item.listingUrl;
}

function rssListingToProduct(
  item: CompleteRssListing,
  shop: string,
  source: "search_exact" | "search_related",
): NormalizedProduct {
  return {
    title: item.title,
    description: item.description,
    price: item.price,
    compareAtPrice: null,
    currency: item.currency,
    images: [{ url: item.imageUrl, altText: item.title }],
    variants: [],
    options: [],
    vendor: shop,
    productUrl: item.listingUrl,
    source,
  };
}

export interface EtsySearchEnrichmentArgs {
  requestedTitle: string | null;
  requestedListingId: string | null;
  products: NormalizedProduct[];
  mode: "exact" | "related";
  fetchText?: (url: string) => Promise<string | null>;
  /** Resolves listings -> shop names + cited shops (wired to vendor-resolution.ts by the import pipeline). */
  resolveShops?: (
    listings: { url: string; title: string | null }[],
  ) => Promise<{ byUrl: Map<string, string>; citedShops: string[] }>;
  /** Finds shops selling this kind of product (wired to shop-discovery.ts by the import pipeline). */
  discoverShops?: (productQuery: string) => Promise<string[]>;
}

/** Bounds how many distinct shop feeds one enrichment pass may fetch across all stages. */
const MAX_SHOP_FEEDS = 6;

export async function enrichEtsySearchCandidates({
  requestedTitle,
  requestedListingId,
  products,
  mode,
  fetchText = fetchTextWithLimits,
  resolveShops = async () => ({ byUrl: new Map(), citedShops: [] }),
  discoverShops = async () => [],
}: EtsySearchEnrichmentArgs): Promise<NormalizedProduct[]> {
  const canonical = products.map((p) => ({
    ...p,
    productUrl: canonicalEtsyListingUrl(p.productUrl) ?? p.productUrl,
  }));

  // Stage 1 — resolve shop names for incomplete candidates that don't carry one; without a
  // shop name the RSS stages below can't run for that candidate at all.
  const needsShop = canonical.filter(
    (p) =>
      !shopNameFor(p) &&
      parseEtsyListingId(p.productUrl) !== null &&
      !(p.images.length > 0 && p.price !== null && p.description !== null),
  );
  const resolved =
    needsShop.length > 0
      ? await resolveShops(needsShop.map((p) => ({ url: p.productUrl, title: p.title })))
      : { byUrl: new Map<string, string>(), citedShops: [] };
  const withVendors = canonical.map((p) => {
    const shop = p.vendor ? null : resolved.byUrl.get(p.productUrl);
    return shop ? { ...p, vendor: shop } : p;
  });

  // Stage 2 — the existing per-shop RSS enrichment, sharing one feed cache with later stages.
  const feedFor = createShopFeedCache(fetchText);
  const enriched = await enrichEtsyProductsViaShopRss(withVendors, fetchText, feedFor);

  const candidateShops = [...new Set(enriched.map(shopNameFor).filter((s): s is string => !!s))];

  // Stage 3 — shop discovery + exact-listing recovery. Runs when the requested listing is
  // still missing (related mode) or still imageless (exact mode): one bounded call finds
  // shops selling this kind of product, and their feeds — plus shops the vendor-resolution
  // call's citations surfaced — are scanned for the requested listing ID. An ID hit is
  // airtight: it's the requested product straight from Etsy.
  const needsDiscovery =
    !!requestedTitle &&
    !!requestedListingId &&
    (mode === "related" || enriched.some((p) => p.images.length === 0));
  const discoveredShops = [
    ...resolved.citedShops,
    ...(needsDiscovery ? await discoverShops(coreSearchQuery(requestedTitle!, 8) ?? requestedTitle!) : []),
  ]
    .filter((shop, i, all) => !candidateShops.includes(shop) && all.indexOf(shop) === i)
    .slice(0, Math.max(0, MAX_SHOP_FEEDS - candidateShops.length));

  if (requestedListingId) {
    for (const shop of [...candidateShops, ...discoveredShops]) {
      const hit = (await feedFor(shop)).find((item) => item.listingId === requestedListingId);
      if (hit && isCompleteRssListing(hit)) {
        // The requested product itself, recovered with real image/price/description. Returned
        // alone and marked search_exact — the import pipeline presents it as the product
        // rather than as a "related" list. Anything the feed item lacks keeps whatever the
        // search verdict already found for the same listing.
        const recovered = rssListingToProduct(hit, shop, "search_exact");
        const prior = enriched.find((p) => parseEtsyListingId(p.productUrl) === requestedListingId);
        return [
          {
            ...recovered,
            description: recovered.description ?? prior?.description ?? null,
            price: recovered.price ?? prior?.price ?? null,
            currency: recovered.currency ?? prior?.currency ?? null,
          },
        ];
      }
    }
  }
  if (mode === "exact") return enriched;

  // Stage 4 — same-shop top-up. Everything added here comes straight from Etsy's own feeds
  // (image, price, description, canonical URL all guaranteed), gated by the strict relevance
  // score so a shop's unrelated items never ride along. Without a requested title there is
  // no way to verify relevance, so nothing is added.
  const seenIds = new Set<string>(
    [requestedListingId, ...enriched.map((p) => parseEtsyListingId(p.productUrl))].filter((id): id is string => !!id),
  );
  const topUps: { product: NormalizedProduct; score: number }[] = [];
  if (requestedTitle) {
    for (const shop of [...candidateShops, ...discoveredShops]) {
      for (const item of await feedFor(shop)) {
        if (!item.listingId || seenIds.has(item.listingId) || !isCompleteRssListing(item)) continue;
        const { relevant, score } = scoreTitleRelevance(requestedTitle, item.title);
        if (!relevant || score < TOPUP_MIN_SCORE) continue;
        seenIds.add(item.listingId);
        topUps.push({ score, product: rssListingToProduct(item, shop, "search_related") });
      }
    }
  }

  // Final ranking: every candidate (search-found and topped-up alike) ordered by the same
  // relevance score; equally-relevant candidates with a real image beat imageless ones (an
  // image-complete top-up must not be cut by the cap in favor of an imageless tie). Stable
  // sort keeps the original order among full ties.
  const merged = [...enriched, ...topUps.map((t) => t.product)];
  if (requestedTitle) {
    const rankOf = (p: NormalizedProduct): number =>
      (p.title ? scoreTitleRelevance(requestedTitle, p.title).score : 0) + (p.images.length > 0 ? 0.01 : 0);
    merged.sort((a, b) => rankOf(b) - rankOf(a));
  }
  return merged.slice(0, MAX_RELATED_CANDIDATES);
}
