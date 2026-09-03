import { signSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";

/** Builds a `cookie` header value for an authenticated test request. Requires SESSION_SECRET to
 * be set (vitest.setup.ts sets a fixed test value). */
export async function signedSessionCookieHeader(userId: string): Promise<string> {
  const token = await signSessionToken(userId);
  return `${SESSION_COOKIE_NAME}=${token}`;
}
