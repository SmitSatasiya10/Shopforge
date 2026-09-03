import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, SESSION_COOKIE_OPTIONS } from "@/lib/auth/session";

// POST /api/auth/logout — clears the session cookie. Logging out while already logged out is a
// no-op success, so no auth check is required here.
export async function POST() {
  const res = NextResponse.json({ loggedOut: true });
  res.cookies.set(SESSION_COOKIE_NAME, "", { ...SESSION_COOKIE_OPTIONS, maxAge: 0 });
  return res;
}
