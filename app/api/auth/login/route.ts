import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { verifyPassword } from "@/lib/auth/password";
import { signSessionToken, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS, SESSION_COOKIE_OPTIONS } from "@/lib/auth/session";

const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

const INVALID_CREDENTIALS = () =>
  NextResponse.json({ error: "Invalid email or password." }, { status: 401 });

// POST /api/auth/login — { email, password }. Unknown email and wrong password return the
// exact same error — never reveal which one was wrong.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = LoginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return INVALID_CREDENTIALS();

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) return INVALID_CREDENTIALS();

  const token = await signSessionToken(user.id);
  const res = NextResponse.json({ user: { id: user.id, email: user.email } });
  res.cookies.set(SESSION_COOKIE_NAME, token, { ...SESSION_COOKIE_OPTIONS, maxAge: SESSION_MAX_AGE_SECONDS });
  return res;
}
