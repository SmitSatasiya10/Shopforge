import { NextRequest, NextResponse } from "next/server";
import { renderPublicStorefront } from "@/lib/preview/public-storefront";

// GET /preview/:token/product — the theme's public product page. See app/preview/[token]/route.ts
// for why this is a Route Handler and why it's always dynamic/uncached.
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await renderPublicStorefront(token, "product");
  if (!result) return new NextResponse("Not found", { status: 404 });

  return new NextResponse(result.html, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
