import { detectSupplierPlatform } from "../source";
import { canonicalAmazonProductUrl, parseAmazonAsin } from "../suppliers/amazon";
import { canonicalEtsyListingUrl, parseEtsyListingId } from "../suppliers/etsy";

// Per-platform configuration for the web-search fallback pipeline: how to scope the search,
// which URLs count as real product pages, which image hosts are trustworthy, and how to
// canonicalize/deduplicate candidate URLs. Kept separate from index.ts so the candidate
// page-enrichment stage can share it without importing the whole search flow.

export interface PlatformSearchConfig {
  /** Domain used to scope search queries and tool filters; derived per-URL for multi-TLD platforms. */
  searchDomain(sourceUrl: string): string | null;
  /** What the platform calls its product identifier, for the prompt ("listing ID", "ASIN"). */
  idLabel: string;
  /** Where the platform's real product images live, for the prompt. */
  imageCdnHint: string;
  /** The shape of a real product URL, for the prompt ("etsy.com/listing/<id>/..."). */
  productPathHint: string;
  /**
   * The platform's product identifier parsed out of a URL, or null when the URL doesn't name
   * one. Doubles as the dedupe key for candidates (the same listing surfaces under many
   * locale-prefixed URL variants).
   */
  productKey(url: string): string | null;
  /** The canonical product URL (locale prefix and tracking parameters stripped), or null. */
  canonicalUrl(url: string): string | null;
  /**
   * True only for a usable product/listing page on this platform — never a search, category,
   * market, shop, or home page. Requiring the product identifier in the URL is what enforces
   * that (observed live: /market/... category pages returned as "related listings").
   */
  isCandidateUrl(url: string): boolean;
  /** True when an image URL is on the platform's real image CDN — anything else is untrusted. */
  isTrustedImageUrl(url: string): boolean;
}

function candidatePlatform(rawUrl: string): string | null {
  try {
    return detectSupplierPlatform(new URL(rawUrl));
  } catch {
    return null;
  }
}

function hostnameMatches(rawUrl: string, pattern: RegExp): boolean {
  try {
    return pattern.test(new URL(rawUrl).hostname) && new URL(rawUrl).protocol === "https:";
  } catch {
    return false;
  }
}

// Trusted image hosts are each platform's own image CDN — a model-reported image anywhere else
// (or fabricated) must never end up on a product card, so it's dropped and the card shows
// "No image" / gets topped up by the platform's own enrichment instead.
export const PLATFORM_CONFIGS: Partial<Record<string, PlatformSearchConfig>> = {
  etsy: {
    searchDomain: () => "etsy.com",
    idLabel: "listing ID",
    imageCdnHint: "typically an i.etsystatic.com URL",
    productPathHint: "https://www.etsy.com/listing/<id>/<slug>",
    productKey: parseEtsyListingId,
    canonicalUrl: canonicalEtsyListingUrl,
    isCandidateUrl: (url) => candidatePlatform(url) === "etsy" && parseEtsyListingId(url) !== null,
    isTrustedImageUrl: (url) => hostnameMatches(url, /(^|\.)etsystatic\.com$/i),
  },
  amazon: {
    // Amazon spans many TLDs (amazon.com/.in/.co.uk, …) — scope the search to the same
    // marketplace the user pasted, so prices/currency/availability match their region.
    searchDomain: (sourceUrl) => {
      try {
        return new URL(sourceUrl).hostname.replace(/^www\./i, "");
      } catch {
        return null;
      }
    },
    idLabel: "ASIN",
    imageCdnHint: "typically an m.media-amazon.com URL",
    productPathHint: "https://www.amazon.<tld>/dp/<ASIN>",
    productKey: parseAmazonAsin,
    canonicalUrl: canonicalAmazonProductUrl,
    // Require an ASIN in the URL so only real product pages qualify — never search/category pages.
    isCandidateUrl: (url) => candidatePlatform(url) === "amazon" && parseAmazonAsin(url) !== null,
    isTrustedImageUrl: (url) =>
      hostnameMatches(url, /(^|\.)(media-amazon\.com|ssl-images-amazon\.com|images-amazon\.com)$/i),
  },
};
