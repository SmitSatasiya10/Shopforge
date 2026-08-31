import { NextRequest, NextResponse } from "next/server";
import { renderPublicStorefront } from "@/lib/preview/public-storefront";

// GET /preview/:token — the theme's public homepage. Route Handler, not a page component:
// renderPublicStorefront() already returns a complete <html> document (it renders the base
// theme's own layout/theme.liquid), and app/layout.tsx would otherwise nest that inside its
// own <html>/<body>. Always reads the current saved configuration fresh — no caching, since a
// merchant's autosaved edit must show up on the next refresh.
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await renderPublicStorefront(token, "index");
  if (!result) return new NextResponse("Not found", { status: 404 });

  return new NextResponse(result.html, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
