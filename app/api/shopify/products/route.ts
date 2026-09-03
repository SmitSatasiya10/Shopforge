import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { normalizeShopDomain } from "@/lib/shopify/shop-domain";
import { ShopifyConfigError } from "@/lib/shopify/config";
import { getValidAccessToken } from "@/lib/shopify/token-refresh";
import { listShopifyProducts } from "@/lib/shopify/products";
import { AdminApiError } from "@/lib/shopify/admin-client";
import { requireUserId } from "@/lib/auth/session";

// GET /api/shopify/products?shop=<store>.myshopify.com — lists a connected store's products for
// the import wizard's picker. Only needs read_products, so unlike publish this doesn't depend on
// the write_themes exemption.
export async function GET(req: NextRequest) {
  const userId = await requireUserId(req);
  if (userId instanceof NextResponse) return userId;

  const shop = normalizeShopDomain(req.nextUrl.searchParams.get("shop") ?? "");
  if (!shop) {
    return NextResponse.json({ error: "Invalid shop domain." }, { status: 400 });
  }

  const store = await prisma.shopifyStore.findUnique({ where: { shopDomain: shop } });
  const ownsConnectedStore =
    store && (await prisma.store.findFirst({ where: { ownerId: userId, shopifyStoreId: store.id } }));
  if (!store || !ownsConnectedStore) {
    return NextResponse.json({ error: "This store isn't connected yet." }, { status: 404 });
  }

  try {
    const accessToken = await getValidAccessToken(store);
    const products = await listShopifyProducts(shop, accessToken);
    return NextResponse.json({ products });
  } catch (error) {
    if (error instanceof ShopifyConfigError) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (error instanceof AdminApiError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    const message = error instanceof Error ? error.message : "Could not load products from Shopify.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
