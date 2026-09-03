import { NextRequest, NextResponse } from "next/server";
import { getOptionalUserId } from "@/lib/auth/session";

// Runs on the Edge runtime — only lib/auth/session.ts (no Prisma) may be imported here. Every
// route handler independently re-verifies the session via requireUserId/getOptionalUserId
// reading the cookie directly; this proxy is fast-fail UX and defense in depth, not the
// sole source of truth for authorization (see lib/auth/session.ts's comment).
export const config = {
  matcher: ["/((?!_next/|favicon.ico|preview/).*)"],
};

const PUBLIC_API_PREFIXES = ["/api/auth/", "/api/catalog/sections"];
const PUBLIC_PAGES = ["/login", "/register"];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isPublicApi = PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  const isPublicPage = PUBLIC_PAGES.includes(pathname);
  if (isPublicApi || isPublicPage) return NextResponse.next();

  const userId = await getOptionalUserId(req);
  if (userId) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/login", req.url);
  loginUrl.searchParams.set("from", pathname);
  return NextResponse.redirect(loginUrl);
}
