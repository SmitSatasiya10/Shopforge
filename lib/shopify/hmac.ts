import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies the `hmac` query parameter Shopify attaches to every OAuth install/callback
 * redirect, per Shopify's documented scheme: HMAC-SHA256 over the remaining params
 * (excluding hmac/signature), sorted by key and joined as "key=value" pairs with "&", keyed
 * on the app's client secret. A request that fails this check is never trusted — the caller
 * must reject it outright rather than falling back to any other validation.
 */
export function verifyShopifyHmac(searchParams: URLSearchParams, apiSecret: string): boolean {
  const hmac = searchParams.get("hmac");
  if (!hmac) return false;

  const pairs: string[] = [];
  for (const [key, value] of searchParams.entries()) {
    if (key === "hmac" || key === "signature") continue;
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const message = pairs.join("&");

  const digest = createHmac("sha256", apiSecret).update(message).digest("hex");
  const digestBuf = Buffer.from(digest, "utf8");
  const hmacBuf = Buffer.from(hmac, "utf8");
  return digestBuf.length === hmacBuf.length && timingSafeEqual(digestBuf, hmacBuf);
}
