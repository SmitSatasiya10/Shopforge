import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { hashPassword } from "@/lib/auth/password";
import { signSessionToken, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS, SESSION_COOKIE_OPTIONS } from "@/lib/auth/session";

const RegisterSchema = z
  .object({
    email: z.string().trim().toLowerCase().email(),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });

// POST /api/auth/register — { email, password, confirmPassword } -> creates a User and signs
// the caller in immediately (same cookie login sets).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = RegisterSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { email, password } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "An account with this email already exists." }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({ data: { email, passwordHash } });
  const token = await signSessionToken(user.id);

  const res = NextResponse.json({ user: { id: user.id, email: user.email } }, { status: 201 });
  res.cookies.set(SESSION_COOKIE_NAME, token, { ...SESSION_COOKIE_OPTIONS, maxAge: SESSION_MAX_AGE_SECONDS });
  return res;
}
