import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { normalizeShopDomain } from "@/lib/shopify/shop-domain";
import { requireUserId } from "@/lib/auth/session";

// POST /api/shopify/disconnect — { shop } — purges the stored connection rather than marking it
// inactive (docs/product-spec/21-security-and-multi-tenancy.md §5: "Disconnecting a store from
// Settings revokes the token... and purges it from storage rather than marking it inactive").
// Any Store linked to this connection has its shopifyStoreId set to null (ON DELETE SET NULL) —
// its themes' Store Configuration and Product data are untouched, only the connection goes away.
export async function POST(req: NextRequest) {
  const userId = await requireUserId(req);
  if (userId instanceof NextResponse) return userId;

  const body = await req.json().catch(() => null);
  const shop = normalizeShopDomain(body?.shop ?? "");
  if (!shop) {
    return NextResponse.json({ error: "Invalid shop domain." }, { status: 400 });
  }

  const shopifyStore = await prisma.shopifyStore.findUnique({ where: { shopDomain: shop } });
  if (!shopifyStore) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Only the owner of every Store linked to this connection may disconnect it — a connection
  // shared with a store this caller doesn't own must never be nuked out from under them.
  const foreignOwnerCount = await prisma.store.count({
    where: { shopifyStoreId: shopifyStore.id, ownerId: { not: userId } },
  });
  if (foreignOwnerCount > 0) {
    return NextResponse.json(
      { error: "This Shopify connection is linked to a store you don't own." },
      { status: 403 },
    );
  }

  await prisma.shopifyStore.delete({ where: { id: shopifyStore.id } });
  return NextResponse.json({ disconnected: true });
}
