import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

// GET /api/project/:id/history/:versionId — full snapshot for one checkpoint, used to restore
// the editor to that point in time.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  const { id, versionId } = await params;

  const version = await prisma.projectVersion.findFirst({
    where: { id: versionId, projectId: id },
    select: { id: true, configurationJson: true, productTitle: true, editCount: true, createdAt: true, updatedAt: true },
  });
  if (!version) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ version });
}
