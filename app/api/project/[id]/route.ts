import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { toProductDTO } from "@/lib/product/db-mapping";
import { parseSelectedImages } from "@/lib/store-config/product-images";

// GET /api/project/:id — Project + nested Product, the reload/restore path
// (prototype-phase-plan.md §17/§20 persistence test).
//
// When the wizard's Product Images step (shopforge-personalization-image-selection-plan.md
// §9-18) produced a selection, the returned product's `images` are overridden with it — this
// is the one place the curated selection becomes what the editor/theme preview renders
// (lib/shopify-compat/drops.ts builds the gallery straight from `images`), while
// Product.images in the database stays the untouched original import.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: { id },
    include: { product: true, shopifyStore: true },
  });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const product = toProductDTO(project.product);
  const selected = parseSelectedImages(project.selectedImagesJson);
  if (selected) {
    product.images = selected.images.map((img) => ({ url: img.url, altText: img.altText }));
  }

  return NextResponse.json({
    project: {
      id: project.id,
      name: project.name,
      productId: project.productId,
      configurationJson: project.configurationJson,
      shopifyShopDomain: project.shopifyStore?.shopDomain ?? null,
      installedThemeShopifyId: project.installedThemeShopifyId,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    },
    product,
  });
}
