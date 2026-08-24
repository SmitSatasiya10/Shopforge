import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { normalizeShopDomain } from "@/lib/shopify/shop-domain";

// POST /api/shopify/disconnect — { shop } — purges the stored connection rather than marking it
// inactive (docs/product-spec/21-security-and-multi-tenancy.md §5: "Disconnecting a store from
// Settings revokes the token... and purges it from storage rather than marking it inactive").
// Any Project linked to this store has its shopifyStoreId set to null (ON DELETE SET NULL) — its
// Store Configuration and Product data are untouched, only the connection itself goes away.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const shop = normalizeShopDomain(body?.shop ?? "");
  if (!shop) {
    return NextResponse.json({ error: "Invalid shop domain." }, { status: 400 });
  }

  await prisma.shopifyStore.deleteMany({ where: { shopDomain: shop } });
  return NextResponse.json({ disconnected: true });
}
