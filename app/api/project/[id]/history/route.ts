import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireUserId } from "@/lib/auth/session";
import { assertProjectOwnership } from "@/lib/auth/authorize";

const HISTORY_LIMIT = 20;

// GET /api/project/:id/history — list recent checkpoints, newest first. No configurationJson
// here (kept light for the dropdown list) — fetch a single entry's full snapshot via
// GET /api/project/:id/history/:versionId when the user clicks a row.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId(req);
  if (userId instanceof NextResponse) return userId;
  const { id } = await params;
  const authError = await assertProjectOwnership(id, userId);
  if (authError) return authError;

  const versions = await prisma.projectVersion.findMany({
    where: { projectId: id },
    orderBy: { updatedAt: "desc" },
    take: HISTORY_LIMIT,
    select: { id: true, editCount: true, createdAt: true, updatedAt: true },
  });

  return NextResponse.json({ versions });
}
