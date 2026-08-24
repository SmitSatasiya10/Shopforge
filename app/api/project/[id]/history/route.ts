import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

const HISTORY_LIMIT = 20;

// GET /api/project/:id/history — list recent checkpoints, newest first. No configurationJson
// here (kept light for the dropdown list) — fetch a single entry's full snapshot via
// GET /api/project/:id/history/:versionId when the user clicks a row.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const versions = await prisma.projectVersion.findMany({
    where: { projectId: id },
    orderBy: { updatedAt: "desc" },
    take: HISTORY_LIMIT,
    select: { id: true, editCount: true, createdAt: true, updatedAt: true },
  });

  return NextResponse.json({ versions });
}
