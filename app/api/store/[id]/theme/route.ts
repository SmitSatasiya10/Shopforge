import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { seedThemeConfiguration } from "@/lib/store-config/seed-theme";
import { requireUserId } from "@/lib/auth/session";
import { assertStoreOwnership } from "@/lib/auth/authorize";

// POST /api/store/:id/theme — { name?, duplicateFrom? } — adds a new theme (draft, never
// auto-active) to an existing store.
//
// No "duplicateFrom": creates a blank theme, seeded the same way a store's first theme is
// (Base Theme defaults, no AI generation — that stays a separate editor-triggered step).
//
// "duplicateFrom": an existing theme id belonging to this store. configurationJson, language,
// personaJson, marketingAngleJson, and selectedImagesJson are copied verbatim; the duplicate's
// installedThemeShopifyId starts null (it has never been pushed to Shopify — copying the
// source's theme id would make the duplicate's first publish silently overwrite the source's
// live theme) and it starts its own edit history / publish records.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId(req);
  if (userId instanceof NextResponse) return userId;
  const { id: storeId } = await params;
  const authError = await assertStoreOwnership(storeId, userId);
  if (authError) return authError;

  const body = await req.json().catch(() => ({}));

  const store = await prisma.store.findUnique({ where: { id: storeId }, include: { product: true } });
  if (!store) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const name = typeof body?.name === "string" && body.name.trim() ? (body.name as string).trim() : undefined;

  if (typeof body?.duplicateFrom === "string" && body.duplicateFrom) {
    const source = await prisma.project.findFirst({ where: { id: body.duplicateFrom, storeId } });
    if (!source) {
      return NextResponse.json({ error: "duplicateFrom must be a theme belonging to this store" }, { status: 400 });
    }

    const project = await prisma.project.create({
      data: {
        storeId,
        name: name ?? `Copy of ${source.name}`,
        configurationJson: source.configurationJson as Prisma.InputJsonValue,
        language: source.language,
        personaJson: source.personaJson === null ? Prisma.JsonNull : (source.personaJson as Prisma.InputJsonValue),
        marketingAngleJson:
          source.marketingAngleJson === null ? Prisma.JsonNull : (source.marketingAngleJson as Prisma.InputJsonValue),
        selectedImagesJson:
          source.selectedImagesJson === null ? Prisma.JsonNull : (source.selectedImagesJson as Prisma.InputJsonValue),
      },
    });
    return NextResponse.json({ project }, { status: 201 });
  }

  // A blank theme has no wizard-selected image set — every image slot seeds from the store
  // product's own imported photos, same as a store's very first theme when Product Images
  // wasn't run.
  const configuration = await seedThemeConfiguration(store.product, null);
  const themeCount = await prisma.project.count({ where: { storeId } });
  const project = await prisma.project.create({
    data: {
      storeId,
      name: name ?? `Theme ${themeCount + 1}`,
      configurationJson: JSON.parse(JSON.stringify(configuration)),
    },
  });
  return NextResponse.json({ project }, { status: 201 });
}
