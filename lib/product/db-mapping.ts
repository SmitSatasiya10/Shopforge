import type { Product as ProductRow } from "@/app/generated/prisma/client";
import { NormalizedProduct, ImportStatus } from "./types";

export type ProductDTO = NormalizedProduct & {
  id: string;
  importStatus: ImportStatus;
  importError: string | null;
  importedFieldsMissing: string[];
  /** Which Start-screen entry point this came in through: "shopify" | "supplier" | "competitor" | "sample". */
  importSource: string;
  supplierPlatform: string | null;
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
  };
}

export function toNormalizedProduct(dto: ProductDTO): NormalizedProduct {
  const { id, importStatus, importError, importedFieldsMissing, importSource, supplierPlatform, ...normalized } = dto;
  void id;
  void importStatus;
  void importError;
  void importedFieldsMissing;
  void importSource;
  void supplierPlatform;
  return normalized;
}
