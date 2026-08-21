import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { toProductDTO } from "@/lib/product/db-mapping";

// GET /api/project/:id — Project + nested Product, the reload/restore path
// (prototype-phase-plan.md §17/§20 persistence test).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await prisma.project.findUnique({ where: { id }, include: { product: true } });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({
    project: {
      id: project.id,
      name: project.name,
      productId: project.productId,
      configurationJson: project.configurationJson,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    },
    product: toProductDTO(project.product),
  });
}
