import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { toProductDTOWithOverrides } from "@/lib/product/db-mapping";
import { requireUserId } from "@/lib/auth/session";
import { assertProjectOwnership } from "@/lib/auth/authorize";

// GET /api/project/:id — Project + nested Product, the reload/restore path
// (prototype-phase-plan.md §17/§20 persistence test).
//
// When the wizard's Product Images step (shopforge-personalization-image-selection-plan.md
// §9-18) produced a selection, the returned product's `images` are overridden with it — this
// is the one place the curated selection becomes what the editor/theme preview renders
// (lib/shopify-compat/drops.ts builds the gallery straight from `images`), while
// Product.images in the database stays the untouched original import.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId(req);
  if (userId instanceof NextResponse) return userId;
  const { id } = await params;
  const authError = await assertProjectOwnership(id, userId);
  if (authError) return authError;

  const project = await prisma.project.findUnique({
    where: { id },
    include: { store: { include: { product: true, shopifyStore: true } } },
  });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const product = toProductDTOWithOverrides(project.store.product, project.selectedImagesJson);

  return NextResponse.json({
    project: {
      id: project.id,
      name: project.name,
      productId: project.store.productId,
      storeId: project.storeId,
      storeName: project.store.name,
      storeActiveThemeId: project.store.activeThemeId,
      configurationJson: project.configurationJson,
      shopifyShopDomain: project.store.shopifyStore?.shopDomain ?? null,
      installedThemeShopifyId: project.installedThemeShopifyId,
      publicPreviewEnabled: project.publicPreviewEnabled,
      publicPreviewToken: project.publicPreviewToken,
      publicPreviewExpiresAt: project.publicPreviewExpiresAt,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    },
    product,
  });
}

// PATCH /api/project/:id — { name } — renames this theme (Project.name; not the store name,
// which is PATCH /api/store/:id).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId(req);
  if (userId instanceof NextResponse) return userId;
  const { id } = await params;
  const authError = await assertProjectOwnership(id, userId);
  if (authError) return authError;

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "Provide { name: string }" }, { status: 400 });

  try {
    const project = await prisma.project.update({ where: { id }, data: { name } });
    return NextResponse.json({ project });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
