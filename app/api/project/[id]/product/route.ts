import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { toProductDTO } from "@/lib/product/db-mapping";

// PATCH /api/project/:id/product — { title } -> renames the imported product. The product
// page's <h1> renders `{{ product.title }}` (product data, not a template setting), so the
// editor's inline title edits land here instead of in configurationJson.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  if (!title) {
    return NextResponse.json({ error: "Provide { title: string }" }, { status: 400 });
  }

  const project = await prisma.project.findUnique({ where: { id }, select: { productId: true } });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const product = await prisma.product.update({
    where: { id: project.productId },
    data: { title },
  });
  return NextResponse.json({ product: toProductDTO(product) });
}
