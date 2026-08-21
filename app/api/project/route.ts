import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { createFsTemplateReader } from "@/lib/preview/fs-template-reader";
import { defaultConfiguration } from "@/lib/store-config/store";

// POST /api/project — { productId, name } -> creates the Project seeded with the Base
// Theme's own templates, so the store is previewable the moment it exists. AI content
// generation is a separate call (POST /api/project/:id/generate) rather than something
// project creation blocks on: a full two-template generation takes over a minute.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.productId !== "string") {
    return NextResponse.json({ error: "Provide { productId: string, name?: string }" }, { status: 400 });
  }

  const product = await prisma.product.findUnique({ where: { id: body.productId } });
  if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });

  const existing = await prisma.project.findUnique({ where: { productId: product.id } });
  if (existing) return NextResponse.json({ project: existing }, { status: 200 });

  const configuration = await defaultConfiguration(createFsTemplateReader());

  const project = await prisma.project.create({
    data: {
      name:
        typeof body.name === "string" && body.name.trim() ? body.name : (product.title ?? "Untitled store"),
      productId: product.id,
      // Prisma's Json input type wants an index signature the configuration type does not
      // structurally have; round-tripping through JSON keeps this a plain-object write.
      configurationJson: JSON.parse(JSON.stringify(configuration)),
    },
  });

  return NextResponse.json({ project }, { status: 201 });
}
