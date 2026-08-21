import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  classifyAndImportProduct,
  importCompetitorStore,
  importSampleProduct,
  importSupplierProduct,
} from "@/lib/product/import";
import { toProductDTO, ProductDTO } from "@/lib/product/db-mapping";
import type { ImportResult } from "@/lib/product/types";
import type { ProductImportSource } from "@/lib/product/source";

async function persistResult(
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

// POST /api/product/import — { source?: "shopify"|"supplier"|"competitor", url } or { sample: true }.
// `source` defaults to "shopify" for backward compatibility with the original single-source
// contract. Never throws on a bad/unreachable/unsupported page
// (docs/product-phases/02-product-import.md, supplier-competitor-import-prompt.md): the
// import pipeline always resolves to a status, persisted as-is.
//
// - source "shopify" (default): a submitted URL is classified server-side as either a
//   direct product page ("product" mode, one result) or a store/homepage needing discovery
//   ("store" mode, zero or more results) — see store-homepage-product-discovery-prompt.md.
// - source "supplier": always "product" mode (one result). The URL's platform is detected
//   from its hostname before anything is fetched; an unsupported platform never reaches the
//   network and is never persisted.
// - source "competitor": always "store" mode. The URL is always treated as a store/homepage
//   and run through the same bounded discovery crawler as Shopify store URLs. Only
//   successful/partial results are persisted; failed discovery candidates are dropped, never
//   faked, and are reflected in `discovery.failed` instead.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || (typeof body.url !== "string" && body.sample !== true)) {
    return NextResponse.json({ error: "Please enter a valid URL." }, { status: 400 });
  }

  if (body.sample === true) {
    const result = importSampleProduct();
    const product = await persistResult(result, "sample", { importSource: "sample", supplierPlatform: null });
    return NextResponse.json(
      { mode: "product" as const, products: [product] },
      { status: result.status === "failed" ? 422 : 201 },
    );
  }

  if (!body.url.trim()) {
    return NextResponse.json({ error: "Please enter a valid URL." }, { status: 400 });
  }

  const source: ProductImportSource =
    body.source === "supplier" || body.source === "competitor" ? body.source : "shopify";

  if (source === "supplier") {
    const { platform, result } = await importSupplierProduct(body.url);
    if (platform === null) {
      // Invalid URL or an unsupported supplier — nothing was fetched, so nothing is persisted.
      return NextResponse.json({ error: result.error }, { status: 422 });
    }
    const product = await persistResult(result, body.url, { importSource: "supplier", supplierPlatform: platform });
    return NextResponse.json(
      { mode: "product" as const, products: [product] },
      { status: result.status === "failed" ? 422 : 201 },
    );
  }

  if (source === "competitor") {
    const { error, results, discovery } = await importCompetitorStore(body.url);
    if (error) {
      // The store itself was unreachable or the URL was invalid — nothing to persist.
      return NextResponse.json({ error }, { status: 422 });
    }
    const products = await Promise.all(
      results.map((r) => persistResult(r, body.url, { importSource: "competitor", supplierPlatform: null })),
    );
    return NextResponse.json({ mode: "store" as const, products, discovery }, { status: 201 });
  }

  const classified = await classifyAndImportProduct(body.url);

  if (classified.mode === "product") {
    const [result] = classified.results;
    const product = await persistResult(result, body.url, { importSource: "shopify", supplierPlatform: null });
    return NextResponse.json(
      { mode: "product" as const, products: [product] },
      { status: result.status === "failed" ? 422 : 201 },
    );
  }

  const products = await Promise.all(
    classified.results.map((r) => persistResult(r, body.url, { importSource: "shopify", supplierPlatform: null })),
  );
  return NextResponse.json(
    { mode: "store" as const, products, discovery: classified.discovery },
    { status: 201 },
  );
}
