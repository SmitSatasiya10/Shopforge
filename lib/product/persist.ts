import { prisma } from "@/lib/db/prisma";
import { toProductDTO, ProductDTO } from "@/lib/product/db-mapping";
import type { ImportResult } from "@/lib/product/types";

/** Persists any pipeline's ImportResult identically, whatever produced it (scrape-based
 * classification, supplier/competitor discovery, or an Admin-API-sourced product). */
export async function persistResult(
  result: ImportResult,
  fallbackUrl: string,
  meta: { importSource: string; supplierPlatform: string | null },
): Promise<ProductDTO> {
  const product = await prisma.product.create({
    data: {
      sourceUrl: result.normalized?.productUrl ?? fallbackUrl,
      sourcePlatform: result.normalized?.source ?? "generic_html",
      importSource: meta.importSource,
      supplierPlatform: meta.supplierPlatform,
      importStatus: result.status,
      importError: result.error,
      importedFieldsMissing: result.missingFields,
      title: result.normalized?.title ?? null,
      description: result.normalized?.description ?? null,
      price: result.normalized?.price ?? null,
      compareAtPrice: result.normalized?.compareAtPrice ?? null,
      currency: result.normalized?.currency ?? null,
      vendor: result.normalized?.vendor ?? null,
      images: result.normalized?.images ?? [],
      variants: result.normalized?.variants ?? [],
      options: result.normalized?.options ?? [],
      // result.raw is whatever the source returned (object, or an HTML snippet string for
      // an unsupported page) — kept for debugging only, so a loose cast is fine here.
      rawData: result.raw === null ? undefined : (result.raw as never),
    },
  });
  return toProductDTO(product);
}
