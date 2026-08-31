import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

// GET /api/store — lists every store for the dashboard, newest-activity first.
export async function GET() {
  const stores = await prisma.store.findMany({
    include: {
      product: { select: { title: true, images: true } },
      shopifyStore: { select: { shopDomain: true } },
      themes: { select: { id: true, name: true }, orderBy: { updatedAt: "desc" } },
    },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json({
    stores: stores.map((store) => ({
      id: store.id,
      name: store.name,
      productTitle: store.product.title,
      productImage: (store.product.images as { url: string }[] | null)?.[0]?.url ?? null,
      shopifyShopDomain: store.shopifyStore?.shopDomain ?? null,
      activeThemeId: store.activeThemeId,
      themes: store.themes,
      updatedAt: store.updatedAt,
    })),
  });
}
