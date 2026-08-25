import { z } from "zod";

// Normalized Product Contract — docs/product-spec §9 / prototype-phase-plan.md §9.
// All content fields are nullable: extraction from a real page is unreliable and
// downstream code (store-config generation, preview) must tolerate gaps rather
// than crash (prototype-phase-plan.md §7/§20 missing-data test).
export const ProductImageSchema = z.object({
  url: z.string(),
  altText: z.string().nullable().default(null),
});

export const ProductVariantSchema = z.object({
  title: z.string(),
  price: z.number().nullable().default(null),
  sku: z.string().nullable().default(null),
});

export const NormalizedProductSchema = z.object({
  title: z.string().nullable(),
  description: z.string().nullable(),
  price: z.number().nullable(),
  compareAtPrice: z.number().nullable(),
  currency: z.string().nullable(),
  images: z.array(ProductImageSchema).default([]),
  variants: z.array(ProductVariantSchema).default([]),
  options: z.array(z.object({ name: z.string(), values: z.array(z.string()) })).default([]),
  vendor: z.string().nullable(),
  productUrl: z.string(),
  source: z.enum(["shopify", "generic_html", "sample", "search_exact", "search_related"]),
});

export type NormalizedProduct = z.infer<typeof NormalizedProductSchema>;

export type ImportStatus = "pending" | "importing" | "succeeded" | "partial" | "failed";

export type ImportErrorReason =
  | "invalid_url"
  | "unreachable"
  | "http_error"
  | "blocked_host"
  | "too_large"
  | null;

export interface ImportResult {
  status: ImportStatus;
  error: string | null;
  errorReason?: ImportErrorReason;
  missingFields: string[];
  raw: unknown;
  normalized: NormalizedProduct | null;
}

/** Fields required to consider an import usable at all (plan §7: title + image minimum). */
export function requiredFieldsMissing(product: NormalizedProduct): string[] {
  const missing: string[] = [];
  if (!product.title) missing.push("title");
  if (product.images.length === 0) missing.push("images");
  if (product.price === null) missing.push("price");
  if (product.variants.length === 0) missing.push("variants");
  return missing;
}

/** A missing title means there's nothing usable to show at all; anything else is partial. */
export function deriveImportStatus(missing: string[]): ImportStatus {
  if (missing.length === 0) return "succeeded";
  return missing.includes("title") ? "failed" : "partial";
}
