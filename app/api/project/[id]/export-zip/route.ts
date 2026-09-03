import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { parseConfiguration } from "@/lib/store-config/store";
import { buildProjectThemeZip } from "@/lib/shopify/theme-bundle";
import { requireUserId } from "@/lib/auth/session";
import { assertProjectOwnership } from "@/lib/auth/authorize";

// GET /api/project/:id/export-zip — the theme this project would push to Shopify on publish
// (lib/shopify/publish.ts's buildTemplateFiles, merged into the Base Theme bundle), as a
// downloadable zip. Lets a merchant manually upload and check it without a Shopify connection.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId(req);
  if (userId instanceof NextResponse) return userId;
  const { id } = await params;
  const authError = await assertProjectOwnership(id, userId);
  if (authError) return authError;

  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const config = parseConfiguration(project.configurationJson);
  const zip = await buildProjectThemeZip(config);

  const filename = `${project.name.replace(/[^a-z0-9-]+/gi, "-").replace(/^-+|-+$/g, "") || "store"}-theme.zip`;

  return new NextResponse(new Uint8Array(zip), {
    status: 200,
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${filename}"`,
      "content-length": String(zip.length),
    },
  });
}
