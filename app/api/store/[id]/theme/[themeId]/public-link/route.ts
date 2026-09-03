import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireUserId } from "@/lib/auth/session";
import { assertStoreOwnership } from "@/lib/auth/authorize";

const PUBLIC_PREVIEW_LINK_TTL_DAYS = 30;

function generateToken(): string {
  return randomBytes(24).toString("base64url");
}

function newExpiry(): Date {
  return new Date(Date.now() + PUBLIC_PREVIEW_LINK_TTL_DAYS * 24 * 60 * 60 * 1000);
}

// PATCH /api/store/:id/theme/:themeId/public-link — { enabled, rotate? } — turns this theme's
// public storefront preview link (/preview/<token>) on or off. A token is generated on first
// enable and is good for PUBLIC_PREVIEW_LINK_TTL_DAYS from that point; re-enabling before expiry
// restores the same URL, so a merchant isn't forced to reshare a new one every time. Once expired
// (or when the caller explicitly passes rotate: true, e.g. "this link got shared too widely"), a
// fresh token and expiry are minted instead, invalidating whatever link was shared before.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; themeId: string }> },
) {
  const userId = await requireUserId(req);
  if (userId instanceof NextResponse) return userId;
  const { id: storeId, themeId } = await params;
  const authError = await assertStoreOwnership(storeId, userId);
  if (authError) return authError;

  const body = await req.json().catch(() => null);
  if (typeof body?.enabled !== "boolean") {
    return NextResponse.json({ error: "Provide { enabled: boolean }" }, { status: 400 });
  }
  const enabled = body.enabled as boolean;
  const rotate = body?.rotate === true;

  const theme = await prisma.project.findFirst({
    where: { id: themeId, storeId },
    select: { publicPreviewToken: true, publicPreviewExpiresAt: true },
  });
  if (!theme) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isExpired = theme.publicPreviewExpiresAt !== null && theme.publicPreviewExpiresAt < new Date();
  const needsToken = enabled && (!theme.publicPreviewToken || isExpired || rotate);

  for (let attempt = 0; ; attempt++) {
    try {
      const updated = await prisma.project.update({
        where: { id: themeId },
        data: {
          publicPreviewEnabled: enabled,
          ...(needsToken ? { publicPreviewToken: generateToken(), publicPreviewExpiresAt: newExpiry() } : {}),
        },
        select: { publicPreviewEnabled: true, publicPreviewToken: true, publicPreviewExpiresAt: true },
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
