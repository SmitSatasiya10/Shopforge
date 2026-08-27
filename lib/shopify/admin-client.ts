// Shopify Admin GraphQL API client. Mirrors the plain-fetch style already used for the OAuth
// token exchange in app/api/shopify/callback/route.ts — no SDK dependency needed for this.

const ADMIN_API_VERSION = "2026-07"; // keep in sync with shopify.app.toml's [webhooks].api_version

export class AdminApiError extends Error {}

interface AdminGraphQLResponse<T> {
  data?: T;
  errors?: { message: string }[];
}

export async function executeAdminGraphQL<T>(
  shopDomain: string,
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  // A Theme Access password (shptka_...) doesn't call the shop's own Admin API directly at all
  // — it goes through Shopify's Theme Kit Access proxy, identifying the target shop via an
  // extra X-Shopify-Shop header. Confirmed straight from Shopify CLI's own request log
  // (`shopify theme list --verbose`): it posts to theme-kit-access.shopifyapps.com/cli/admin/...,
  // never to `${shopDomain}/admin/...`, when authenticating with this token type. Posting a
  // Theme Access token to the shop's own domain instead returns a misleading generic 401
  // ("unrecognized login or wrong password") that looks exactly like an invalid/wrong token.
  const isThemeAccessToken = accessToken.startsWith("shptka_");
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "X-Shopify-Access-Token": accessToken,
  };
  if (isThemeAccessToken) headers["X-Shopify-Shop"] = shopDomain;

  const base = isThemeAccessToken
    ? "https://theme-kit-access.shopifyapps.com/cli/admin/api"
    : `https://${shopDomain}/admin/api`;

  const res = await fetch(`${base}/${ADMIN_API_VERSION}/graphql.json`, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new AdminApiError(`Shopify Admin API request failed: ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as AdminGraphQLResponse<T>;
  if (json.errors?.length) {
    throw new AdminApiError(`Shopify Admin API error: ${json.errors.map((e) => e.message).join("; ")}`);
  }
  if (!json.data) {
    throw new AdminApiError("Shopify Admin API returned no data");
  }
  return json.data;
}

/** Throws if any userErrors are present — the GraphQL-level "did this mutation actually succeed" check. */
export function assertNoUserErrors(
  userErrors: { field?: string[] | null; message: string }[],
  mutationName: string,
): void {
  if (userErrors.length > 0) {
    throw new AdminApiError(
      `Shopify ${mutationName} failed: ${userErrors.map((e) => e.message).join("; ")}`,
    );
  }
}
