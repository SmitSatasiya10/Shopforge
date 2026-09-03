import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getOptionalUserId, SESSION_COOKIE_NAME, SESSION_COOKIE_OPTIONS } from "@/lib/auth/session";

// GET /api/auth/me — the client's way to detect logged-in/out state. Deliberately lenient
// (getOptionalUserId, not requireUserId): a missing/invalid session is a normal `{ user: null }`
// response here, not a 401 error.
export async function GET(req: NextRequest) {
  const userId = await getOptionalUserId(req);
  if (!userId) return NextResponse.json({ user: null });

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true } });
  if (!user) {
    const res = NextResponse.json({ user: null });
    res.cookies.set(SESSION_COOKIE_NAME, "", { ...SESSION_COOKIE_OPTIONS, maxAge: 0 });
    return res;
  }

  return NextResponse.json({ user });
}
