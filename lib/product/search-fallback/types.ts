import type { NormalizedProduct } from "../types";
import type { SupplierPlatform } from "../source";

// Generic web-search fallback contract (lib/product/search-fallback/index.ts). Not Etsy-specific
// — any supplier adapter whose direct retrieval is insufficient can call searchProductFallback
// with whatever identifying information it actually has.
export interface ProductSearchInput {
  sourcePlatform: SupplierPlatform;
  sourceUrl: string;
  /** The platform's product identifier when the URL names one (Etsy listing ID, Amazon ASIN, …). */
  listingId: string | null;
  title: string | null;
  vendor: string | null;
  /** Optional extra signals from whatever partial direct extraction produced — never required. */
  description?: string | null;
  price?: number | null;
  currency?: string | null;
}

export type ProductSearchResult =
  | { matchType: "exact"; product: NormalizedProduct }
  | { matchType: "related"; products: NormalizedProduct[] }
  | { matchType: "none" }
  | { matchType: "error"; error: string };
