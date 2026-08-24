const MYSHOPIFY_DOMAIN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

/**
 * Accepts what a merchant might type ("my-store", "my-store.myshopify.com", or a pasted
 * "https://my-store.myshopify.com/admin" URL) and returns the canonical
 * "<name>.myshopify.com" domain, or null if it doesn't resolve to a valid one. Rejecting
 * anything outside this shape (rather than passing the raw input through to an OAuth
 * redirect) is what keeps a crafted `shop` query param from being used as an open redirect.
 */
export function normalizeShopDomain(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  const withoutProtocol = trimmed.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const candidate = withoutProtocol.includes(".") ? withoutProtocol : `${withoutProtocol}.myshopify.com`;
  return MYSHOPIFY_DOMAIN.test(candidate) ? candidate : null;
}
