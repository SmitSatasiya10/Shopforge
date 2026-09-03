import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { toProductDTO } from "@/lib/product/db-mapping";
import { recordCheckpoint } from "@/lib/history/checkpoint";
import { requireUserId } from "@/lib/auth/session";
import { assertProjectOwnership } from "@/lib/auth/authorize";

// PATCH /api/project/:id/product — { title?, description? } -> updates the imported product.
// The product page's <h1> and description block render `{{ product.title }}`/
// `{{ product.description }}` (product data, not template settings), so the editor's inline
// edits to either land here instead of in configurationJson.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId(req);
  if (userId instanceof NextResponse) return userId;
  const { id } = await params;
  const authError = await assertProjectOwnership(id, userId);
  if (authError) return authError;

  const body = await req.json().catch(() => null);
  const hasTitle = typeof body?.title === "string";
  const hasDescription = typeof body?.description === "string" || body?.description === null;
  const title = hasTitle ? (body.title as string).trim() : undefined;
  if (hasTitle && !title) {
    return NextResponse.json({ error: "title cannot be empty" }, { status: 400 });
  }
  if (!hasTitle && !hasDescription) {
    return NextResponse.json(
      { error: "Provide { title: string } and/or { description: string | null }" },
      { status: 400 },
    );
  }

  const project = await prisma.project.findUnique({
    where: { id },
    select: { configurationJson: true, store: { select: { productId: true } } },
  });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const product = await prisma.product.update({
    where: { id: project.store.productId },
    data: {
      ...(title !== undefined ? { title } : {}),
      ...(hasDescription ? { description: body.description as string | null } : {}),
    },
  });
  await recordCheckpoint(id, {
    configurationJson: project.configurationJson,
    productTitle: product.title,
  });
  return NextResponse.json({ product: toProductDTO(product) });
}
