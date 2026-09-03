import { SignJWT, jwtVerify } from "jose";
import { NextRequest, NextResponse } from "next/server";

// No prisma import in this file — it is imported by proxy.ts, which runs on the Edge
// runtime and cannot load the pg-based Prisma adapter. Only `jose` (edge-compatible) belongs
// here; password hashing (lib/auth/password.ts) and DB-backed ownership checks
// (lib/auth/authorize.ts) are separate, Node-only files for exactly this reason.

export const SESSION_COOKIE_NAME = "sf_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

export class SessionConfigError extends Error {}

function getSessionSecretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new SessionConfigError(
      "SESSION_SECRET not set. Add it to .env — generate with `openssl rand -hex 32`.",
    );
  }
  return new TextEncoder().encode(secret);
}

export async function signSessionToken(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(getSessionSecretKey());
}

export async function verifySessionToken(token: string): Promise<{ userId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getSessionSecretKey());
    return typeof payload.sub === "string" ? { userId: payload.sub } : null;
  } catch {
    return null;
  }
}

/** Reads and verifies the session cookie; never throws, returns null for any missing/invalid case. */
export async function getOptionalUserId(req: NextRequest): Promise<string | null> {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  const session = await verifySessionToken(token);
  return session?.userId ?? null;
}

/** Same as getOptionalUserId, but returns a 401 NextResponse instead of null on failure —
 * route handlers return this directly when it isn't a string. */
export async function requireUserId(req: NextRequest): Promise<string | NextResponse> {
  const userId = await getOptionalUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return userId;
}
