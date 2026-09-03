import { NextRequest, NextResponse } from "next/server";
import {
  classifyAndImportProduct,
  importCompetitorStore,
  importSampleProduct,
  importSupplierProduct,
} from "@/lib/product/import";
import { persistResult } from "@/lib/product/persist";
import type { ProductImportSource } from "@/lib/product/source";
import { requireUserId } from "@/lib/auth/session";

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
  const userId = await requireUserId(req);
  if (userId instanceof NextResponse) return userId;

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
    const outcome = await importSupplierProduct(body.url);
    if (outcome.platform === null) {
      // Invalid URL or an unsupported supplier — nothing was fetched, so nothing is persisted.
      return NextResponse.json({ error: outcome.result.error }, { status: 422 });
    }

    if (outcome.mode === "related") {
      // The exact product couldn't be confirmed, but the web-search fallback found similar
      // listings — persist them as normal (partial) products so they flow through the existing
      // Products Found -> select -> analysis pipeline, and let the client label them as related
      // rather than as the requested product.
      const products = await Promise.all(
        outcome.results.map((r) =>
          persistResult(r, body.url, { importSource: "supplier", supplierPlatform: outcome.platform }),
        ),
      );
      return NextResponse.json({ mode: "related" as const, products }, { status: 201 });
    }

    const product = await persistResult(outcome.result, body.url, {
      importSource: "supplier",
      supplierPlatform: outcome.platform,
    });
    return NextResponse.json(
      { mode: "product" as const, products: [product] },
      { status: outcome.result.status === "failed" ? 422 : 201 },
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
