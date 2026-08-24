// Shopify app runtime configuration. Every value is read through here rather than off
// process.env at the call site, mirroring lib/ai/config.ts.

export interface ShopifyConfig {
  apiKey: string;
  apiSecret: string;
  /** Base HTTPS URL this app is reachable at, no trailing slash — must match an Allowed
   * redirection URL registered on the Shopify app (with /api/shopify/callback appended). */
  appUrl: string;
  /** Space-separated OAuth scopes requested at install. */
  scopes: string;
  /** Secret used to derive the AES-256-GCM key that encrypts stored access tokens at rest. */
  tokenEncryptionKey: string;
}

export function loadShopifyConfig(overrides: Partial<ShopifyConfig> = {}): ShopifyConfig {
  return {
    apiKey: overrides.apiKey ?? process.env.SHOPIFY_API_KEY ?? "",
    apiSecret: overrides.apiSecret ?? process.env.SHOPIFY_API_SECRET ?? "",
    appUrl: (overrides.appUrl ?? process.env.SHOPIFY_APP_URL ?? "").replace(/\/+$/, ""),
    scopes: overrides.scopes ?? process.env.SHOPIFY_SCOPES ?? "read_products",
    tokenEncryptionKey:
      overrides.tokenEncryptionKey ?? process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY ?? "",
  };
}

export class ShopifyConfigError extends Error {}

/** Throws a ShopifyConfigError naming every missing var, rather than failing on the first one. */
export function requireShopifyCredentials(
  config: ShopifyConfig,
): ShopifyConfig & { apiKey: string; apiSecret: string; appUrl: string } {
  const missing: string[] = [];
  if (!config.apiKey) missing.push("SHOPIFY_API_KEY");
  if (!config.apiSecret) missing.push("SHOPIFY_API_SECRET");
  if (!config.appUrl) missing.push("SHOPIFY_APP_URL");
  if (missing.length > 0) {
    throw new ShopifyConfigError(
      `${missing.join(", ")} not set. Add ${missing.length > 1 ? "them" : "it"} to .env to connect a Shopify store.`,
    );
  }
  return config as ShopifyConfig & { apiKey: string; apiSecret: string; appUrl: string };
}
