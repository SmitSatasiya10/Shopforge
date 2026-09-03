import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireUserId } from "@/lib/auth/session";
import { assertProjectOwnership } from "@/lib/auth/authorize";

// GET /api/project/:id/history/:versionId — full snapshot for one checkpoint, used to restore
// the editor to that point in time.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  const userId = await requireUserId(req);
  if (userId instanceof NextResponse) return userId;
  const { id, versionId } = await params;
  const authError = await assertProjectOwnership(id, userId);
  if (authError) return authError;

  const version = await prisma.projectVersion.findFirst({
    where: { id: versionId, projectId: id },
    select: { id: true, configurationJson: true, productTitle: true, editCount: true, createdAt: true, updatedAt: true },
  });
  if (!version) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ version });
}
