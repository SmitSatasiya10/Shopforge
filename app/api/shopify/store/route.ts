import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireUserId } from "@/lib/auth/session";

// GET /api/shopify/store — the caller's own most recently connected store, if any. Used by the
// import wizard to recognize an existing connection on a fresh page load rather than only right
// after the OAuth redirect back.
export async function GET(req: NextRequest) {
  const userId = await requireUserId(req);
  if (userId instanceof NextResponse) return userId;

  const store = await prisma.shopifyStore.findFirst({
    where: { stores: { some: { ownerId: userId } } },
    orderBy: { updatedAt: "desc" },
  });
  return NextResponse.json({ shopDomain: store?.shopDomain ?? null });
}
