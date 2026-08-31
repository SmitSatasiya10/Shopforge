import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

// GET /api/store/:id — one store with its full theme list, for the theme-management page.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = await prisma.store.findUnique({
    where: { id },
    include: {
      product: { select: { title: true, images: true } },
      shopifyStore: { select: { shopDomain: true } },
      themes: {
        select: {
          id: true,
          name: true,
          installedThemeShopifyId: true,
          updatedAt: true,
          publicPreviewEnabled: true,
          publicPreviewToken: true,
        },
        orderBy: { updatedAt: "desc" },
      },
    },
  });
  if (!store) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({
    store: {
      id: store.id,
      name: store.name,
      productTitle: store.product.title,
      productImage: (store.product.images as { url: string }[] | null)?.[0]?.url ?? null,
      shopifyShopDomain: store.shopifyStore?.shopDomain ?? null,
      activeThemeId: store.activeThemeId,
      themes: store.themes,
    },
  });
}

// PATCH /api/store/:id — { name?, activeThemeId? } — rename the store, and/or manually flip
// which theme is "the" active one without publishing (mainly for pre-Shopify-connection use;
// once connected, activeThemeId is normally driven by a successful publish instead).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);

  const hasName = typeof body?.name === "string";
  const name = hasName ? (body.name as string).trim() : undefined;
  if (hasName && !name) {
    return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
  }
  const hasActiveThemeId = typeof body?.activeThemeId === "string";
  if (!hasName && !hasActiveThemeId) {
    return NextResponse.json({ error: "Provide { name: string } and/or { activeThemeId: string }" }, { status: 400 });
  }

  if (hasActiveThemeId) {
    const theme = await prisma.project.findFirst({ where: { id: body.activeThemeId, storeId: id } });
    if (!theme) {
      return NextResponse.json({ error: "activeThemeId must be a theme belonging to this store" }, { status: 400 });
    }
  }

  try {
    const store = await prisma.store.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(hasActiveThemeId ? { activeThemeId: body.activeThemeId as string } : {}),
      },
    });
    return NextResponse.json({ store });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}

// DELETE /api/store/:id — deletes the store and all of its themes (configuration, edit
// history, publish records cascade). The shared Product row is left in place, not deleted.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await prisma.store.delete({ where: { id } });
    return NextResponse.json({ deleted: true });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
