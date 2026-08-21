import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { toProductDTO } from "@/lib/product/db-mapping";
import { generateInitialConfiguration } from "@/lib/store-config/generate";

// POST /api/project — { productId, name } -> creates the Project and generates the
// initial Store Configuration deterministically from the imported Product (no AI,
// prototype-phase-plan.md §11/§18).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.productId !== "string") {
    return NextResponse.json({ error: "Provide { productId: string, name?: string }" }, { status: 400 });
  }

  const product = await prisma.product.findUnique({ where: { id: body.productId } });
  if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });

  const existing = await prisma.project.findUnique({ where: { productId: product.id } });
  if (existing) return NextResponse.json({ project: existing }, { status: 200 });

  const normalized = toProductDTO(product);
  const configuration = generateInitialConfiguration(normalized);

  const project = await prisma.project.create({
    data: {
      name: typeof body.name === "string" && body.name.trim() ? body.name : (product.title ?? "Untitled store"),
      productId: product.id,
      // Prisma's Json input type wants an index signature StoreConfiguration doesn't
      // structurally have; round-tripping through JSON keeps this a plain-object write.
      configurationJson: JSON.parse(JSON.stringify(configuration)),
    },
  });

  return NextResponse.json({ project }, { status: 201 });
}
