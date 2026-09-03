import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { toProductDTO } from "@/lib/product/db-mapping";
import { requireUserId } from "@/lib/auth/session";
import { assertProductOwnership } from "@/lib/auth/authorize";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId(req);
  if (userId instanceof NextResponse) return userId;
  const { id } = await params;
  const authError = await assertProductOwnership(id, userId);
  if (authError) return authError;

  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ product: toProductDTO(product) });
}
