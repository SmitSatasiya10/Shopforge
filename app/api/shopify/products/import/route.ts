import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { normalizeShopDomain } from "@/lib/shopify/shop-domain";
import { ShopifyConfigError } from "@/lib/shopify/config";
import { getValidAccessToken } from "@/lib/shopify/token-refresh";
import { fetchShopifyProductForImport } from "@/lib/shopify/products";
import { AdminApiError } from "@/lib/shopify/admin-client";
import { persistResult } from "@/lib/product/persist";
import { requiredFieldsMissing, deriveImportStatus } from "@/lib/product/types";
import { requireUserId } from "@/lib/auth/session";

// POST /api/shopify/products/import — { shop, productId, productUrl } — imports one product
// picked from a connected store's catalog (app/import/page.tsx's ConnectShopify picker) via the
// Admin API rather than scraping the public storefront. This is what makes picking a product
// work even when the store's storefront is password-protected (lib/product/fetcher.ts's
// tryFetchShopifyProductJson can't reach a password-protected store at all).
export async function POST(req: NextRequest) {
  const userId = await requireUserId(req);
  if (userId instanceof NextResponse) return userId;

  const body = await req.json().catch(() => null);
  const shop = normalizeShopDomain(body?.shop ?? "");
  const productId = typeof body?.productId === "string" ? body.productId : null;
  const productUrl = typeof body?.productUrl === "string" ? body.productUrl : null;
  if (!shop || !productId || !productUrl) {
    return NextResponse.json({ error: "Missing shop, productId, or productUrl." }, { status: 400 });
  }

  const store = await prisma.shopifyStore.findUnique({ where: { shopDomain: shop } });
  const ownsConnectedStore =
    store && (await prisma.store.findFirst({ where: { ownerId: userId, shopifyStoreId: store.id } }));
  if (!store || !ownsConnectedStore) {
    return NextResponse.json({ error: "This store isn't connected yet." }, { status: 404 });
  }

  try {
    const accessToken = await getValidAccessToken(store);
    const normalized = await fetchShopifyProductForImport(shop, accessToken, productId, productUrl);
    if (!normalized) {
      return NextResponse.json({ error: "That product could no longer be found on the store." }, { status: 404 });
    }

    const missingFields = requiredFieldsMissing(normalized);
    const status = deriveImportStatus(missingFields);
    const product = await persistResult(
      { status, error: null, missingFields, raw: normalized, normalized },
      productUrl,
      { importSource: "shopify", supplierPlatform: null },
    );

    return NextResponse.json(
      { mode: "product" as const, products: [product] },
      { status: status === "failed" ? 422 : 201 },
    );
  } catch (error) {
    if (error instanceof ShopifyConfigError) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (error instanceof AdminApiError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    const message = error instanceof Error ? error.message : "Could not import this product.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
