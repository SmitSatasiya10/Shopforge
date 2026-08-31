import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { recordCheckpoint } from "@/lib/history/checkpoint";

// PATCH /api/project/:id/configuration — { configuration, expectedUpdatedAt } -> replaces
// configurationJson, guarded by optimistic concurrency on Project.updatedAt: the write only
// applies if the row's updatedAt still matches what the client last saw. A mismatch means
// someone else (another tab/device) saved since the client last read, so we reject with 409
// rather than silently letting a stale save overwrite a newer one.
//
// Also exported as POST — identical body/behavior — solely so `navigator.sendBeacon` (used to
// flush a pending save during page unload) has a method it supports; sendBeacon can only POST.
async function handlePatch(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body.configuration !== "object" || body.configuration === null) {
    return NextResponse.json({ error: "Provide { configuration: StoreConfiguration }" }, { status: 400 });
  }
  if (typeof body.expectedUpdatedAt !== "string") {
    return NextResponse.json({ error: "Provide expectedUpdatedAt: string" }, { status: 400 });
  }
  const expectedUpdatedAt = new Date(body.expectedUpdatedAt);
  if (Number.isNaN(expectedUpdatedAt.getTime())) {
    return NextResponse.json({ error: "expectedUpdatedAt must be a valid date" }, { status: 400 });
  }

  try {
    const project = await prisma.project.update({
      where: { id, updatedAt: expectedUpdatedAt },
      data: { configurationJson: body.configuration },
      include: { store: { select: { productId: true } } },
    });
    const product = await prisma.product.findUnique({
      where: { id: project.store.productId },
      select: { title: true },
    });
    await recordCheckpoint(id, {
      configurationJson: body.configuration,
      productTitle: product?.title ?? null,
    });
    return NextResponse.json({ project });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      const current = await prisma.project.findUnique({ where: { id }, select: { updatedAt: true } });
      if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json(
        { error: "conflict", currentUpdatedAt: current.updatedAt },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}

export const PATCH = handlePatch;
export const POST = handlePatch;
