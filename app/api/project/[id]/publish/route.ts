import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { publishProjectToShopify, PublishError } from "@/lib/shopify/publish";
import { AdminApiError } from "@/lib/shopify/admin-client";
import { ShopifyConfigError } from "@/lib/shopify/config";
import { requireUserId } from "@/lib/auth/session";
import { assertProjectOwnership } from "@/lib/auth/authorize";

// POST /api/project/:id/publish — installs (first publish) or reuses the project's Shopify
// theme, pushes the current Store Configuration onto it, and publishes it live. Requires the
// project to already be linked to a connected ShopifyStore (see PATCH /api/project/:id/product
// -style linking below, wired from the editor's Connect flow).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId(req);
  if (userId instanceof NextResponse) return userId;
  const { id } = await params;
  const authError = await assertProjectOwnership(id, userId);
  if (authError) return authError;

  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const result = await publishProjectToShopify(id);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof ShopifyConfigError) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (error instanceof PublishError || error instanceof AdminApiError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    const message = error instanceof Error ? error.message : "Publish failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
