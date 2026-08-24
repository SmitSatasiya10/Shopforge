import { prisma } from "@/lib/db/prisma";
import type { ShopifyStore } from "@/app/generated/prisma/client";
import { loadShopifyConfig, requireShopifyCredentials, ShopifyConfigError } from "@/lib/shopify/config";
import { decryptToken, encryptToken } from "@/lib/shopify/crypto";

const REFRESH_MARGIN_MS = 5 * 60 * 1000; // refresh a bit before actual expiry, not right at the edge

interface RefreshResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/**
 * Returns a usable access token for this store, transparently refreshing it first if it's
 * expiring-token-flavored and close to expiry. A store connected before expiring tokens were
 * required (expiresAt/refreshTokenCipher both null) has no refresh path — its stored token is a
 * legacy non-expiring one and is returned as-is (Shopify may itself reject it; see
 * app/api/shopify/callback/route.ts's expiring:1 request for how new connections avoid this).
 */
export async function getValidAccessToken(store: ShopifyStore): Promise<string> {
  const { tokenEncryptionKey } = loadShopifyConfig();

  const needsRefresh =
    store.expiresAt !== null &&
    store.refreshTokenCipher !== null &&
    store.expiresAt.getTime() - Date.now() < REFRESH_MARGIN_MS;

  if (!needsRefresh) {
    return decryptToken(store.accessTokenCipher, tokenEncryptionKey);
  }

  const { apiKey, apiSecret } = requireShopifyCredentials(loadShopifyConfig());
  const refreshToken = decryptToken(store.refreshTokenCipher!, tokenEncryptionKey);

  const res = await fetch(`https://${store.shopDomain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: apiKey,
      client_secret: apiSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    throw new ShopifyConfigError(
      `Refreshing the Shopify access token for ${store.shopDomain} failed (${res.status}). Reconnect the store.`,
    );
  }

  const data = (await res.json()) as RefreshResponse;

  await prisma.shopifyStore.update({
    where: { id: store.id },
    data: {
      accessTokenCipher: encryptToken(data.access_token, tokenEncryptionKey),
      refreshTokenCipher: encryptToken(data.refresh_token, tokenEncryptionKey),
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
    },
  });

  return data.access_token;
}
