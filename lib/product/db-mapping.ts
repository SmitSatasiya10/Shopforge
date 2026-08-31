import type { Product as ProductRow } from "@/app/generated/prisma/client";
import { NormalizedProduct, ImportStatus } from "./types";
import { parseSelectedImages } from "@/lib/store-config/product-images";
import { parseGeneratedImages, type GeneratedImage } from "./generated-images";

export type ProductDTO = NormalizedProduct & {
  id: string;
  importStatus: ImportStatus;
  importError: string | null;
  importedFieldsMissing: string[];
  /** Which Start-screen entry point this came in through: "shopify" | "supplier" | "competitor" | "sample". */
  importSource: string;
  supplierPlatform: string | null;
  /** The editor's "Edit with AI" results (lib/product/generated-images.ts) — reusable across every theme belonging to this product's store. */
  generatedImages: GeneratedImage[];
};

/** Converts a Prisma Product row (Decimal fields, JSON columns) into the wire/preview-ready shape. */
export function toProductDTO(row: ProductRow): ProductDTO {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    price: row.price === null ? null : Number(row.price),
    compareAtPrice: row.compareAtPrice === null ? null : Number(row.compareAtPrice),
    currency: row.currency,
    images: (row.images as NormalizedProduct["images"]) ?? [],
    variants: (row.variants as NormalizedProduct["variants"]) ?? [],
    options: (row.options as NormalizedProduct["options"]) ?? [],
    vendor: row.vendor,
    productUrl: row.sourceUrl,
    source: row.sourcePlatform as NormalizedProduct["source"],
    importStatus: row.importStatus as ImportStatus,
    importError: row.importError,
    importedFieldsMissing: row.importedFieldsMissing,
    importSource: row.importSource,
    supplierPlatform: row.supplierPlatform,
    generatedImages: parseGeneratedImages(row.generatedImagesJson),
  };
}

/**
 * `toProductDTO` plus the wizard's Product Images override: when `selectedImagesJson` holds a
 * curated selection, it replaces `images` here — this is the one place that override becomes
 * what the editor/theme preview (and the public storefront preview) renders, while
 * `Product.images` in the database stays the untouched original import.
 */
export function toProductDTOWithOverrides(row: ProductRow, selectedImagesJson: unknown): ProductDTO {
  const dto = toProductDTO(row);
  const selected = parseSelectedImages(selectedImagesJson);
  if (selected) {
    dto.images = selected.images.map((img) => ({ url: img.url, altText: img.altText }));
  }
  return dto;
}

export function toNormalizedProduct(dto: ProductDTO): NormalizedProduct {
  const { id, importStatus, importError, importedFieldsMissing, importSource, supplierPlatform, generatedImages, ...normalized } = dto;
  void id;
  void importStatus;
  void importError;
  void importedFieldsMissing;
  void importSource;
  void supplierPlatform;
  void generatedImages;
  return normalized;
}
