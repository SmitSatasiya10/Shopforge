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
  // A Theme Access password (shptka_...) needs an extra X-Shopify-Shop header alongside the
  // access token — confirmed from Shopify CLI's own theme-auth header builder, which sends
  // both headers together specifically when the token has this prefix. A regular OAuth token
  // doesn't need it, so it's added conditionally rather than unconditionally.
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "X-Shopify-Access-Token": accessToken,
  };
  if (accessToken.startsWith("shptka_")) {
    headers["X-Shopify-Shop"] = shopDomain;
  }

  const res = await fetch(`https://${shopDomain}/admin/api/${ADMIN_API_VERSION}/graphql.json`, {
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
