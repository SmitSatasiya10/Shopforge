import {
  NormalizedProduct,
  NormalizedProductSchema,
} from "./types";
import { JsonLdExtraction, OpenGraphExtraction } from "./extractor";

// ProductNormalizer — every source-specific shape funnels through here into the
// one Normalized Product Contract (prototype-phase-plan.md §9). Never let a
// malformed upstream field crash normalization — coerce or drop it instead.

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number.parseFloat(value.replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

interface ShopifyJsonProduct {
  title?: string;
  body_html?: string;
  vendor?: string;
  images?: { src?: string; alt?: string | null }[];
  variants?: { title?: string; price?: string; sku?: string; compare_at_price?: string }[];
  options?: { name?: string; values?: string[] }[];
}

export function normalizeFromShopifyJson(
  raw: ShopifyJsonProduct,
  productUrl: string,
): NormalizedProduct {
  const variants = (raw.variants ?? []).map((v) => ({
    title: v.title ?? "Default",
    price: toNumber(v.price),
    sku: v.sku ?? null,
  }));
  const price = variants.length > 0 ? variants[0].price : null;
  const compareAtPrice = toNumber(raw.variants?.[0]?.compare_at_price);

  return NormalizedProductSchema.parse({
    title: toStringOrNull(raw.title),
    description: toStringOrNull(raw.body_html)?.replace(/<[^>]+>/g, "") ?? null,
    price,
    compareAtPrice,
    currency: null, // not present on Shopify's public product.json
    images: (raw.images ?? [])
      .filter((img) => img.src)
      .map((img) => ({ url: img.src as string, altText: img.alt ?? null })),
    variants,
    options: (raw.options ?? []).map((o) => ({ name: o.name ?? "", values: o.values ?? [] })),
    vendor: toStringOrNull(raw.vendor),
    productUrl,
    source: "shopify",
  });
}

interface JsonLdOffer {
  price?: string | number;
  priceCurrency?: string;
}

interface JsonLdProductRaw {
  name?: string;
  description?: string;
  image?: string | string[];
  brand?: string | { name?: string };
  offers?: JsonLdOffer | JsonLdOffer[];
}

export function normalizeFromJsonLd(
  extraction: JsonLdExtraction,
  productUrl: string,
): NormalizedProduct {
  const raw = extraction.data as JsonLdProductRaw;
  const offers = Array.isArray(raw.offers) ? raw.offers[0] : raw.offers;
  const images = Array.isArray(raw.image) ? raw.image : raw.image ? [raw.image] : [];
  const brand = typeof raw.brand === "string" ? raw.brand : raw.brand?.name;

  return NormalizedProductSchema.parse({
    title: toStringOrNull(raw.name),
    description: toStringOrNull(raw.description),
    price: toNumber(offers?.price),
    compareAtPrice: null,
    currency: toStringOrNull(offers?.priceCurrency),
    images: images.filter(Boolean).map((url) => ({ url, altText: null })),
    variants: [],
    options: [],
    vendor: toStringOrNull(brand ?? null),
    productUrl,
    source: "generic_html",
  });
}

export function normalizeFromOpenGraph(
  extraction: OpenGraphExtraction,
  productUrl: string,
): NormalizedProduct {
  const { data } = extraction;
  return NormalizedProductSchema.parse({
    title: toStringOrNull(data.title),
    description: toStringOrNull(data.description),
    price: toNumber(data.priceAmount),
    compareAtPrice: null,
    currency: toStringOrNull(data.priceCurrency),
    images: data.image ? [{ url: data.image, altText: null }] : [],
    variants: [],
    options: [],
    vendor: null,
    productUrl,
    source: "generic_html",
  });
}
