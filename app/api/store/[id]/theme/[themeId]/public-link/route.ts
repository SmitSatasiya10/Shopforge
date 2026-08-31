import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

function generateToken(): string {
  return randomBytes(24).toString("base64url");
}

// PATCH /api/store/:id/theme/:themeId/public-link — { enabled } — turns this theme's public
// storefront preview link (/preview/<token>) on or off. A token is generated once, the first
// time a theme is enabled, and is never cleared on disable, so re-enabling restores the same
// URL instead of forcing the merchant to reshare a new one.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; themeId: string }> },
) {
  const { id: storeId, themeId } = await params;
  const body = await req.json().catch(() => null);
  if (typeof body?.enabled !== "boolean") {
    return NextResponse.json({ error: "Provide { enabled: boolean }" }, { status: 400 });
  }
  const enabled = body.enabled as boolean;

  const theme = await prisma.project.findFirst({
    where: { id: themeId, storeId },
    select: { publicPreviewToken: true },
  });
  if (!theme) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const needsToken = enabled && !theme.publicPreviewToken;

  for (let attempt = 0; ; attempt++) {
    try {
      const updated = await prisma.project.update({
        where: { id: themeId },
        data: {
          publicPreviewEnabled: enabled,
          ...(needsToken ? { publicPreviewToken: generateToken() } : {}),
        },
        select: { publicPreviewEnabled: true, publicPreviewToken: true },
      });
      return NextResponse.json(updated);
    } catch (error) {
      // Defensive only — 192 bits of entropy makes a real collision effectively impossible.
      const isUniqueViolation =
        needsToken && typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
      if (isUniqueViolation && attempt < 2) continue;
      throw error;
    }
  }
}
