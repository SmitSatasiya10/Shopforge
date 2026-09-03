import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { loadShopifyConfig, requireShopifyCredentials, ShopifyConfigError } from "@/lib/shopify/config";
import { normalizeShopDomain } from "@/lib/shopify/shop-domain";
import { requireUserId } from "@/lib/auth/session";

const STATE_COOKIE = "shopify_oauth_state";
const PROJECT_ID_COOKIE = "shopify_oauth_project_id";
const STATE_MAX_AGE_SECONDS = 600; // 10 minutes — long enough for the OAuth consent redirect round trip

// GET /api/shopify/install?shop=<store>.myshopify.com[&projectId=...] — starts the Authorization
// Code flow: generates a per-attempt state (CSRF protection, verified on the callback), then
// redirects the merchant to Shopify's own OAuth consent screen for the requested store. An
// optional projectId (set when connecting from the editor's Publish flow rather than the import
// wizard) rides along in its own short-lived cookie so the callback can link the two.
export async function GET(req: NextRequest) {
  const userId = await requireUserId(req);
  if (userId instanceof NextResponse) return userId;

  const shop = normalizeShopDomain(req.nextUrl.searchParams.get("shop") ?? "");
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!shop) {
    return NextResponse.json(
      { error: "Enter a valid Shopify store domain, e.g. your-store.myshopify.com" },
      { status: 400 },
    );
  }

  let apiKey: string, appUrl: string, scopes: string;
  try {
    ({ apiKey, appUrl, scopes } = requireShopifyCredentials(loadShopifyConfig()));
  } catch (err) {
    const message = err instanceof ShopifyConfigError ? err.message : "Shopify app is not configured.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const state = randomBytes(16).toString("hex");
  const authorizeUrl = new URL(`https://${shop}/admin/oauth/authorize`);
  authorizeUrl.searchParams.set("client_id", apiKey);
  authorizeUrl.searchParams.set("scope", scopes);
  authorizeUrl.searchParams.set("redirect_uri", `${appUrl}/api/shopify/callback`);
  authorizeUrl.searchParams.set("state", state);

  const res = NextResponse.redirect(authorizeUrl);
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: STATE_MAX_AGE_SECONDS,
    path: "/",
  });
  if (projectId) {
    res.cookies.set(PROJECT_ID_COOKIE, projectId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: STATE_MAX_AGE_SECONDS,
      path: "/",
    });
  }
  return res;
}
