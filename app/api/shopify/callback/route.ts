import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { loadShopifyConfig, requireShopifyCredentials, ShopifyConfigError } from "@/lib/shopify/config";
import { normalizeShopDomain } from "@/lib/shopify/shop-domain";
import { verifyShopifyHmac } from "@/lib/shopify/hmac";
import { encryptToken } from "@/lib/shopify/crypto";

const STATE_COOKIE = "shopify_oauth_state";
const PROJECT_ID_COOKIE = "shopify_oauth_project_id";

interface ShopifyAccessTokenResponse {
  access_token: string;
  scope: string;
  expires_in?: number;
  refresh_token?: string;
}

// GET /api/shopify/callback — Shopify redirects here after the merchant approves (or the
// request is otherwise invalid). Every check below is a hard reject, not a fallback: an
// invalid/missing state or a failed HMAC verification means the request is never trusted,
// per docs/product-phases/11-shopify-integration.md's error-handling contract.
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const shop = normalizeShopDomain(params.get("shop") ?? "");
  const code = params.get("code");
  const state = params.get("state");
  const cookieState = req.cookies.get(STATE_COOKIE)?.value;

  if (!shop || !code || !state || !cookieState || state !== cookieState) {
    return NextResponse.json({ error: "Invalid or expired Shopify connect request. Please try again." }, { status: 400 });
  }

  let apiKey: string, apiSecret: string, tokenEncryptionKey: string;
  try {
    const config = requireShopifyCredentials(loadShopifyConfig());
    if (!config.tokenEncryptionKey) throw new ShopifyConfigError("SHOPIFY_TOKEN_ENCRYPTION_KEY not set.");
    ({ apiKey, apiSecret, tokenEncryptionKey } = config);
  } catch (err) {
    const message = err instanceof ShopifyConfigError ? err.message : "Shopify app is not configured.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  if (!verifyShopifyHmac(params, apiSecret)) {
    return NextResponse.json({ error: "Could not verify this request came from Shopify." }, { status: 400 });
  }

  // expiring: 1 requests an expiring offline token (1hr access token + 90-day refresh token)
  // instead of a legacy non-expiring one — Shopify requires this for apps created after
  // 2026-04-01 and rejects non-expiring tokens outright at Admin API call time otherwise.
  const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: apiKey, client_secret: apiSecret, code, expiring: 1 }),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text().catch(() => "");
    return NextResponse.json(
      { error: "Shopify rejected the authorization code exchange.", status: tokenRes.status, body },
      { status: 502 },
    );
  }

  const {
    access_token: accessToken,
    scope: scopes,
    expires_in: expiresIn,
    refresh_token: refreshToken,
  } = (await tokenRes.json()) as ShopifyAccessTokenResponse;

  const tokenFields = {
    accessTokenCipher: encryptToken(accessToken, tokenEncryptionKey),
    refreshTokenCipher: refreshToken ? encryptToken(refreshToken, tokenEncryptionKey) : null,
    expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
    scopes,
  };

  const store = await prisma.shopifyStore.upsert({
    where: { shopDomain: shop },
    create: { shopDomain: shop, ...tokenFields },
    update: tokenFields,
  });

  // Connecting from the editor's Publish flow carries a projectId cookie so this store gets
  // linked to that project directly, landing back in the editor rather than the import wizard.
  const projectId = req.cookies.get(PROJECT_ID_COOKIE)?.value;
  let redirectUrl = new URL(`/import?source=shopify&connected=${encodeURIComponent(shop)}`, req.url);
  if (projectId) {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (project) {
      await prisma.project.update({ where: { id: projectId }, data: { shopifyStoreId: store.id } });
      redirectUrl = new URL(`/editor/${projectId}?connected=${encodeURIComponent(shop)}`, req.url);
    }
  }

  const res = NextResponse.redirect(redirectUrl);
  res.cookies.delete(STATE_COOKIE);
  res.cookies.delete(PROJECT_ID_COOKIE);
  return res;
}
