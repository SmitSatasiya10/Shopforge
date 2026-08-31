import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

// DELETE /api/store/:id/theme/:themeId — deletes a draft theme (edit history and publish
// records cascade). Refuses to delete the store's currently active theme — the FK on
// Store.activeThemeId is the backstop, this is the friendly pre-check.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; themeId: string }> }) {
  const { id: storeId, themeId } = await params;

  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { activeThemeId: true } });
  if (!store) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const theme = await prisma.project.findFirst({ where: { id: themeId, storeId } });
  if (!theme) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (theme.id === store.activeThemeId) {
    return NextResponse.json(
      { error: "Cannot delete the store's active theme — make another theme active first." },
      { status: 409 },
    );
  }

  await prisma.project.delete({ where: { id: themeId } });
  return NextResponse.json({ deleted: true });
}
