import { fetchProductHtml, fetchTextWithLimits, ProductFetchError, tryFetchShopifyProductJson } from "./fetcher";
import { extractFromHtml } from "./extractor";
import { normalizeFromJsonLd, normalizeFromOpenGraph, normalizeFromShopifyJson } from "./normalizer";
import { ImportResult, NormalizedProduct, deriveImportStatus, requiredFieldsMissing } from "./types";
import { getSampleNormalizedProduct, SAMPLE_PRODUCT_RAW } from "./sample";
import { discoverProductUrls, mapWithConcurrency, DiscoverySource, MAX_FETCHED_PRODUCTS, DISCOVERY_CONCURRENCY } from "./discovery";
import { detectSupplierPlatform, SupplierPlatform, SUPPLIER_PLATFORM_LABELS, unsupportedSupplierMessage } from "./source";
import {
  AmazonHtmlFallback,
  canonicalAmazonProductUrl,
  extractAmazonHtmlFallback,
  parseAmazonAsin,
  parseAmazonTitleHint,
} from "./suppliers/amazon";
import {
  canonicalEtsyListingUrl,
  enrichEtsySearchCandidates,
  parseEtsyListingId,
  parseEtsyListingTitleHint,
} from "./suppliers/etsy";
import { searchProductFallback } from "./search-fallback";
import { enrichCandidatesFromPages } from "./search-fallback/page-enrich";
import { discoverEtsyShops } from "./search-fallback/shop-discovery";
import { resolveEtsyShopNames } from "./search-fallback/vendor-resolution";
import type { ProductSearchInput } from "./search-fallback/types";

/**
 * Full import pipeline: ProductFetcher -> RawProductExtractor -> ProductNormalizer
 * (docs/product-phases/02-product-import.md, 03-product-normalization.md). Never throws —
 * every failure mode (invalid URL, unreachable, extraction failure, unsupported page)
 * resolves to a status + error/missingFields on the returned ImportResult instead of an
 * exception. Also reports which extraction path produced the result, so callers can tell
 * a confident single-product match from a weak one (used by store-URL classification).
 */
type ExtractionPath = "shopify_json" | "jsonld" | "opengraph" | "none";

async function importFromShopifyJsonOrHtml(
  url: string,
): Promise<{ result: ImportResult; extraction: ExtractionPath; htmlFetched: boolean; html: string | null }> {
  const shopifyJson = await tryFetchShopifyProductJson(url);
  if (shopifyJson) {
    const normalized = normalizeFromShopifyJson(shopifyJson as Parameters<typeof normalizeFromShopifyJson>[0], url);
    const missing = requiredFieldsMissing(normalized);
    return {
      extraction: "shopify_json",
      htmlFetched: false,
      html: null,
      result: {
        status: deriveImportStatus(missing),
        error: null,
        missingFields: missing,
        raw: shopifyJson,
        normalized,
      },
    };
  }

  let html: string;
  try {
    html = await fetchProductHtml(url);
  } catch (err) {
    const message =
      err instanceof ProductFetchError ? err.message : err instanceof Error ? err.message : "Unknown fetch error";
    const errorReason = err instanceof ProductFetchError ? err.reason : null;
    return {
      extraction: "none",
      htmlFetched: false,
      html: null,
      result: { status: "failed", error: message, errorReason, missingFields: [], raw: null, normalized: null },
    };
  }

  const extraction = extractFromHtml(html);
  if (!extraction) {
    return {
      extraction: "none",
      htmlFetched: true,
      html,
      result: {
        status: "failed",
        error: "This page doesn't expose recognizable product data (no JSON-LD or Open Graph tags found).",
        missingFields: [],
        raw: html.slice(0, 20_000), // kept for debugging, not the full page
        normalized: null,
      },
    };
  }

  const normalized =
    extraction.source === "jsonld"
      ? normalizeFromJsonLd(extraction, url)
      : normalizeFromOpenGraph(extraction, url);
  const missing = requiredFieldsMissing(normalized);
  return {
    extraction: extraction.source,
    htmlFetched: true,
    html,
    result: {
      status: deriveImportStatus(missing),
      error: null,
      missingFields: missing,
      raw: extraction.data,
      normalized,
    },
  };
}

export async function importProduct(url: string): Promise<ImportResult> {
  return (await importFromShopifyJsonOrHtml(url)).result;
}

/** Sample product path (docs/product-phases §02, Step 14) — same shape, no network call. */
export function importSampleProduct(): ImportResult {
  const normalized = getSampleNormalizedProduct();
  const missing = requiredFieldsMissing(normalized);
  return {
    status: missing.length === 0 ? "succeeded" : "partial",
    error: null,
    missingFields: missing,
    raw: SAMPLE_PRODUCT_RAW,
    normalized,
  };
}

/**
 * Supplier-link import (supplier-competitor-import-prompt.md §3-7). Every supported platform
 * runs the same two-stage flow:
 * 1. Direct retrieval — the same fetch -> extract -> normalize pipeline as a Shopify product
 *    page, plus an optional per-platform static-HTML fallback (SUPPLIER_HTML_FALLBACKS) that
 *    fills gaps the generic JSON-LD/Open Graph extraction left empty (Amazon exposes neither,
 *    but its server-rendered HTML still has a plain #landingImage <img src> and a visible price
 *    string). This never bypasses bot protection — it only reads more of the HTML the site
 *    already sent back for the one legitimate request already made. When this stage produces a
 *    usable result, the web-search fallback never runs.
 * 2. Generic web-search fallback (search-fallback/index.ts) — only when direct retrieval fails
 *    or returns too little to trust (Etsy 403s behind DataDome on essentially every automated
 *    request; Amazon commonly returns an HTTP-200 captcha shell with no product data). It
 *    searches with the platform-specific context in SUPPLIER_SEARCH_CONTEXT and either finds
 *    the exact listing or a small set of clearly-labeled related listings — never silently
 *    substituting one for the other, and never fabricating data. Platform-specific enrichment
 *    (SUPPLIER_SEARCH_ENRICHERS, e.g. Etsy shop RSS) then fills images/prices the text-only
 *    search tools can't see.
 */
export type SupplierImportResult =
  | { platform: null; mode: "product"; result: ImportResult }
  | { platform: SupplierPlatform; mode: "product"; result: ImportResult }
  | { platform: SupplierPlatform; mode: "related"; results: ImportResult[] };

/** Every supplier fallback returns the same shape, whether or not it can fill each field. */
export type SupplierHtmlFallback = (html: string) => AmazonHtmlFallback;

const SUPPLIER_HTML_FALLBACKS: Partial<Record<SupplierPlatform, SupplierHtmlFallback>> = {
  amazon: extractAmazonHtmlFallback,
};

function applyHtmlFallback(result: ImportResult, platform: SupplierPlatform, html: string | null): ImportResult {
  const fallback = SUPPLIER_HTML_FALLBACKS[platform];
  if (!fallback || !html || !result.normalized) return result;

  const extra = fallback(html);
  const normalized = { ...result.normalized };
  let changed = false;
  // Title is the one field a supplier fallback outranks the generic extraction on. These
  // pages carry no og:title, so the generic path can only reach for the <title> tag — which
  // is the marketplace listing title ("<product> : Amazon.in: Home & Kitchen"), not the
  // product name. That title is what the AI gets briefed on and what renders as the store
  // name in the header, so a cleaner supplier-read title replaces it.
  if (extra.title && extra.title !== normalized.title) {
    normalized.title = extra.title;
    changed = true;
  }
  if (!normalized.vendor && extra.brand) {
    normalized.vendor = extra.brand;
    changed = true;
  }
  if (normalized.images.length === 0 && extra.image) {
    normalized.images = [{ url: extra.image, altText: normalized.title }];
    changed = true;
  }
  if (normalized.price === null && extra.price !== null) {
    normalized.price = extra.price;
    normalized.currency = normalized.currency ?? extra.currency;
    changed = true;
  }
  if (!changed) return result;

  const missing = requiredFieldsMissing(normalized);
  return {
    ...result,
    normalized,
    missingFields: missing,
    status: deriveImportStatus(missing),
  };
}

/**
 * A direct-retrieval result is "sufficient" when it has enough to identify and display the
 * product (title + at least one image) — not necessarily complete. A missing title means
 * nothing usable was found at all; a missing image means what was found can't be trusted or
 * shown, so both are worth trying the web-search fallback for. Missing price/variants alone
 * isn't reason enough to run a search we don't need (generic-web-search-fallback.md §4).
 */
function isDirectResultSufficient(result: ImportResult): boolean {
  if (result.status === "succeeded") return true;
  return result.status === "partial" && !result.missingFields.includes("images");
}

function importResultFromNormalized(normalized: NormalizedProduct): ImportResult {
  const missing = requiredFieldsMissing(normalized);
  return { status: deriveImportStatus(missing), error: null, missingFields: missing, raw: null, normalized };
}

/**
 * Per-platform context for the generic web-search fallback: the canonical product URL
 * (locale prefix and tracking parameters stripped), the platform's product identifier, and
 * every reliable signal partial direct extraction produced. The title is the primary search
 * signal — when extraction produced none (the usual case behind a bot wall), the URL slug
 * turned back into words is used instead ("cherry-blossom-tree-lamp" -> "cherry blossom tree
 * lamp"), never a stripped-down generic term.
 */
const SUPPLIER_SEARCH_CONTEXT: Record<SupplierPlatform, (url: string, direct: ImportResult) => ProductSearchInput> = {
  etsy: (url, direct) => ({
    sourcePlatform: "etsy",
    sourceUrl: canonicalEtsyListingUrl(url) ?? url,
    listingId: parseEtsyListingId(url),
    title: direct.normalized?.title ?? parseEtsyListingTitleHint(url),
    vendor: direct.normalized?.vendor ?? null,
    description: direct.normalized?.description ?? null,
    price: direct.normalized?.price ?? null,
    currency: direct.normalized?.currency ?? null,
  }),
  amazon: (url, direct) => ({
    sourcePlatform: "amazon",
    sourceUrl: canonicalAmazonProductUrl(url) ?? url,
    listingId: parseAmazonAsin(url),
    title: direct.normalized?.title ?? parseAmazonTitleHint(url),
    vendor: direct.normalized?.vendor ?? null,
    description: direct.normalized?.description ?? null,
    price: direct.normalized?.price ?? null,
    currency: direct.normalized?.currency ?? null,
  }),
};

/**
 * Post-search top-up from a platform's own public data — search candidates come from text-only
 * tools that never see image URLs, so after the generic candidate-page enrichment each
 * platform fills the remaining gaps from an endpoint it leaves open (Etsy: shop-name
 * resolution + per-shop RSS + relevant same-shop top-ups). Amazon has no bot-open equivalent,
 * so its candidates rely on the page fetch and search layer alone (its image CDN URLs pass
 * the search layer's trusted-image check).
 */
type SupplierSearchEnricher = (args: {
  input: ProductSearchInput;
  products: NormalizedProduct[];
  mode: "exact" | "related";
}) => Promise<NormalizedProduct[]>;

const SUPPLIER_SEARCH_ENRICHERS: Partial<Record<SupplierPlatform, SupplierSearchEnricher>> = {
  etsy: ({ input, products, mode }) =>
    enrichEtsySearchCandidates({
      requestedTitle: input.title,
      requestedListingId: input.listingId,
      products,
      mode,
      resolveShops: resolveEtsyShopNames,
      discoverShops: discoverEtsyShops,
    }),
};

async function runSupplierSearchFallback(
  platform: SupplierPlatform,
  url: string,
  direct: ImportResult,
): Promise<SupplierImportResult> {
  const input = SUPPLIER_SEARCH_CONTEXT[platform](url, direct);
  const searchResult = await searchProductFallback(input);
  const platformEnrich = SUPPLIER_SEARCH_ENRICHERS[platform] ?? (async ({ products }) => products);

  if (searchResult.matchType === "exact") {
    const fetched = await enrichCandidatesFromPages(platform, [searchResult.product]);
    const [enriched] = await platformEnrich({ input, products: fetched, mode: "exact" });
    return { platform, mode: "product", result: importResultFromNormalized(enriched) };
  }
  if (searchResult.matchType === "related" && searchResult.products.length > 0) {
    const fetched = await enrichCandidatesFromPages(platform, searchResult.products);
    const enriched = await platformEnrich({ input, products: fetched, mode: "related" });
    // Platform enrichment can recover the REQUESTED listing itself (Etsy: found by ID in a
    // discovered shop's feed) — that's the exact product, not a "related" suggestion.
    const exactHit = enriched.find((p) => p.source === "search_exact");
    if (exactHit) {
      return { platform, mode: "product", result: importResultFromNormalized(exactHit) };
    }
    return { platform, mode: "related", results: enriched.map(importResultFromNormalized) };
  }

  // No trustworthy candidate found. A partial direct result (has a title, missing image or
  // price) is still more honest than a hard failure — keep it and let the UI show "No image" /
  // "Price unavailable" rather than substituting anything.
  if (direct.status === "partial") {
    return { platform, mode: "product", result: direct };
  }
  const message =
    searchResult.matchType === "error"
      ? searchResult.error
      : `We couldn't retrieve this ${SUPPLIER_PLATFORM_LABELS[platform]} product, and no matching or related products were found.`;
  return {
    platform,
    mode: "product",
    result: { status: "failed", error: message, missingFields: [], raw: null, normalized: null },
  };
}

export async function importSupplierProduct(url: string): Promise<SupplierImportResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("not http(s)");
  } catch {
    return {
      platform: null,
      mode: "product",
      result: { status: "failed", error: `"${url}" is not a valid URL`, missingFields: [], raw: null, normalized: null },
    };
  }

  const platform = detectSupplierPlatform(parsed);
  if (!platform) {
    return {
      platform: null,
      mode: "product",
      result: { status: "failed", error: unsupportedSupplierMessage(), missingFields: [], raw: null, normalized: null },
    };
  }

  const { result: fetched, html } = await importFromShopifyJsonOrHtml(url);
  const result = applyHtmlFallback(fetched, platform, html);
  if (isDirectResultSufficient(result)) {
    return { platform, mode: "product", result };
  }

  // Direct retrieval failed or returned too little to trust — a 403 bot wall (Etsy), an
  // HTTP-200 captcha shell with no product data (Amazon), or a page with no recognizable
  // structured data. Fall back to the generic web-search service instead of failing outright.
  return runSupplierSearchFallback(platform, url, result);
}

export interface StoreDiscoveryMeta {
  source: DiscoverySource;
  discovered: number;
  fetched: number;
  succeeded: number;
  failed: number;
}

export type ClassifiedImportResult =
  | { mode: "product"; results: ImportResult[] }
  | { mode: "store"; results: ImportResult[]; discovery: StoreDiscoveryMeta };

/**
 * Classifies a submitted URL as a direct product page or a store/homepage (or any other
 * page) needing product discovery, then imports accordingly (store-homepage-product-
 * discovery-prompt.md). Classification is server-side and based on the actual fetched
 * page: Shopify's product JSON endpoint or a JSON-LD `Product` match is a confident
 * product-page signal; anything weaker (Open Graph only, or no product data at all) is
 * treated as a store page and run through discovery instead of guessed from the URL path.
 */
export async function classifyAndImportProduct(url: string): Promise<ClassifiedImportResult> {
  const { result, extraction, htmlFetched } = await importFromShopifyJsonOrHtml(url);

  if (extraction === "shopify_json" || extraction === "jsonld") {
    return { mode: "product", results: [result] };
  }

  if (!htmlFetched) {
    // The page itself was unreachable — surface that error rather than attempting
    // discovery against a host that just failed to respond.
    return { mode: "product", results: [result] };
  }

  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return { mode: "product", results: [result] };
  }

  const { urls, source } = await discoverProductUrls(origin);
  if (urls.length === 0) {
    return { mode: "store", results: [], discovery: { source: "none", discovered: 0, fetched: 0, succeeded: 0, failed: 0 } };
  }

  const toFetch = urls.slice(0, MAX_FETCHED_PRODUCTS);
  const fetched = await mapWithConcurrency(toFetch, DISCOVERY_CONCURRENCY, (u) => importProduct(u));
  const usable = fetched.filter((r) => r.status === "succeeded" || r.status === "partial");

  return {
    mode: "store",
    results: usable,
    discovery: {
      source,
      discovered: urls.length,
      fetched: toFetch.length,
      succeeded: usable.length,
      failed: toFetch.length - usable.length,
    },
  };
}

export interface CompetitorImportOutcome {
  /** Set only when the store itself couldn't be reached/parsed at all (distinct from "reachable, but no products found"). */
  error: string | null;
  results: ImportResult[];
  discovery: StoreDiscoveryMeta;
}

const EMPTY_DISCOVERY: StoreDiscoveryMeta = { source: "none", discovered: 0, fetched: 0, succeeded: 0, failed: 0 };

/**
 * Competitor store import (supplier-competitor-import-prompt.md §8-9). Unlike the Shopify
 * flow, a competitor URL is always treated as a store/homepage — it goes straight to the
 * bounded discovery crawler (products.json -> sitemap -> homepage links, same-origin only,
 * capped at MAX_DISCOVERED_URLS discovered / MAX_FETCHED_PRODUCTS fetched) rather than
 * first being checked for a single confident product match. One failed product never fails
 * the whole import; failures are just reflected in `discovery.failed`.
 */
export async function importCompetitorStore(url: string): Promise<CompetitorImportOutcome> {
  let origin: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("not http(s)");
    origin = parsed.origin;
  } catch {
    return { error: `"${url}" is not a valid URL`, results: [], discovery: EMPTY_DISCOVERY };
  }

  const { urls, source } = await discoverProductUrls(origin);
  if (urls.length === 0) {
    // Distinguish "couldn't reach the store at all" from "reached it, found nothing" —
    // discovery already tried products.json/sitemap/homepage without a hit, so a direct
    // homepage probe here tells us which error to surface.
    const reachable = await fetchTextWithLimits(origin);
    if (reachable === null) {
      return {
        error: "We couldn't reach this website. Check the URL and try again.",
        results: [],
        discovery: EMPTY_DISCOVERY,
      };
    }
    return { error: null, results: [], discovery: EMPTY_DISCOVERY };
  }

  const toFetch = urls.slice(0, MAX_FETCHED_PRODUCTS);
  const fetched = await mapWithConcurrency(toFetch, DISCOVERY_CONCURRENCY, (u) => importProduct(u));
  const usable = fetched.filter((r) => r.status === "succeeded" || r.status === "partial");

  return {
    error: null,
    results: usable,
    discovery: {
      source,
      discovered: urls.length,
      fetched: toFetch.length,
      succeeded: usable.length,
      failed: toFetch.length - usable.length,
    },
  };
}
