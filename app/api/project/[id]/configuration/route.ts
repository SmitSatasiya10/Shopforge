import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

// PATCH /api/project/:id/configuration — { configuration } -> replaces configurationJson.
// Last-write-wins for this phase; no lockVersion/CAS (deferred, see plan's Setup Dependency
// section / DECISIONS.md's optimistic-concurrency requirement for the full spec).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body.configuration !== "object" || body.configuration === null) {
    return NextResponse.json({ error: "Provide { configuration: StoreConfiguration }" }, { status: 400 });
  }

  try {
    const project = await prisma.project.update({
      where: { id },
      data: { configurationJson: body.configuration },
    });
    return NextResponse.json({ project });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
