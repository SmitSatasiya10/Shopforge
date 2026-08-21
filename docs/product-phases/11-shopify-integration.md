# Phase 11 — Shopify Integration

## Objective

Connect a real merchant Shopify store to a Project, establishing the authentication and theme-install
foundation that Phase 12 (Publishing) writes through. This is the first phase in the roadmap that requires
Shopify API access — nothing before it does (see [`README.md`](README.md)).

## Scope

- Shopify OAuth connection (Authorization Code flow), established only at first Publish action, not at Project
  creation — per [`docs/product-spec/DECISIONS.md`](../product-spec/DECISIONS.md) #14 and
  [`docs/product-spec/14-shopify-publishing.md`](../product-spec/14-shopify-publishing.md).
- Required scopes: `read_themes` + `write_themes`, persisted on a `ShopifyInstallation` scoped to a
  `ShopifyStore`.
- Per-attempt `state` parameter (CSRF protection) and HMAC verification of every inbound Shopify request/
  webhook, per [`docs/product-spec/21-security-and-multi-tenancy.md`](../product-spec/21-security-and-multi-tenancy.md) §5.
- Webhook registration: `app/uninstalled` (cleanup) and `themes/publish` (sync).
- Token handling: encrypted at rest via KMS envelope encryption, never exposed to client code, invalidated on
  reinstall/uninstall webhooks.
- Theme-slot detection: list existing themes (`read_themes`) to determine first-publish vs. update, and warn
  when approaching Shopify's 20-theme cap.
- Base Theme install (first publish only): `themeCreate(source:, name:)` from Shopforge's own hosted Base Theme
  bundle, defaulting to `role: UNPUBLISHED` — recorded as `shopifyThemeId` on a `Theme` record. (The actual
  content push and `themePublish` call that makes it live is Phase 12.)

## Out of Scope

- Writing any Store Configuration content to the theme — that's Phase 12. This phase only establishes the
  connection and installs an unpublished Base Theme shell.
- Base Theme auto-update policy for already-live stores — an open item tracked in
  [`docs/product-spec/02-base-theme-and-section-library.md`](../product-spec/02-base-theme-and-section-library.md),
  not resolved by this phase.
- Arbitrary existing merchant theme parsing/import/editing — permanently out of scope
  ([`docs/product-spec/DECISIONS.md`](../product-spec/DECISIONS.md) #2, #15), not a later phase at all.

## Architecture

```text
Merchant clicks "Connect Shopify" (or first Publish action)
  |
OAuth Authorization Code flow (state param, HMAC-verified callback)
  |
ShopifyInstallation persisted (token encrypted, scoped to ShopifyStore)
  |
Webhooks registered (app/uninstalled, themes/publish)
  |
Theme-slot check (read_themes)
  |
themeCreate (first publish only) -> Theme record (role: UNPUBLISHED, shopifyThemeId)
```

## Inputs

A `Project` (Phase 10) whose owner initiates a Shopify connection.

## Outputs

A `ShopifyStore` + `ShopifyInstallation` linked to the `Project`, and — on first publish attempt — an installed
but unpublished `Theme` on that store.

## Dependencies

Phase 10 (`Project` must already exist and be durably persisted before it can be linked to a `ShopifyStore`).

## Implementation Areas

- OAuth flow implementation (Authorization Code grant, `state` CSRF protection, HMAC verification of callbacks
  and webhooks).
- Token encryption at rest (KMS envelope encryption) and strict server-only access (never serialized to any
  client-reachable response).
- `ShopifyStore`/`ShopifyInstallation` persistence, linked to `Project` without conflating the two entities —
  field names must disambiguate `shopifyStoreId` from `storeId`/`projectId`, per
  [`docs/product-spec/19-data-model.md`](../product-spec/19-data-model.md)'s explicit terminology rule.
- Webhook handlers for `app/uninstalled` (token invalidation, cleanup) and `themes/publish` (state sync).
- Theme-slot listing and the 20-theme-cap warning.
- `themeCreate` call and `Theme` record creation.
- **Fallback path if the `write_themes` App Store distribution exemption isn't granted yet** (an open item per
  [`docs/product-spec/25-implementation-roadmap.md`](../product-spec/25-implementation-roadmap.md) Phase 0):
  distribute to design-partner merchants via a custom/unlisted app install, or use a Theme Access password.
  Either path validates the same integration code — this phase's implementation should not hard-depend on
  public App Store distribution being resolved.

## Data Contracts

```text
ShopifyStore { id, myshopifyDomain, ... }
ShopifyInstallation { id, shopifyStoreId, accessToken (encrypted), scopes, installedAt }
Theme { id, shopifyStoreId, shopifyThemeId, role: "UNPUBLISHED" | "MAIN", baseThemeVersion }
```

Full authoritative shapes: [`docs/product-spec/19-data-model.md`](../product-spec/19-data-model.md) and
[`docs/product-spec/14-shopify-publishing.md`](../product-spec/14-shopify-publishing.md).

## User Flow

```text
Merchant initiates Shopify connection (from Project, at first Publish attempt)
  |
Redirected to Shopify OAuth consent screen
  |
Redirected back, state + HMAC verified
  |
ShopifyInstallation persisted
  |
Theme-slot checked; if first publish, Base Theme installed unpublished
  |
Project now linked to a real Shopify store, ready for Phase 12's publish
```

## Error Handling

- An OAuth callback with an invalid/missing `state` or failed HMAC verification is rejected outright — never
  silently accepted.
- Approaching or at Shopify's 20-theme cap surfaces a clear, actionable warning before attempting `themeCreate`,
  not a raw API error.
- A webhook received without valid HMAC verification is rejected, logged, and never processed.
- `app/uninstalled` must reliably invalidate the stored token and mark the `ShopifyInstallation` inactive — a
  missed uninstall webhook must not leave a live, usable token for a store the merchant disconnected.
- Shopify Admin API errors (rate limits, `userErrors`) during theme-slot checks or `themeCreate` surface a
  clear, typed error — never a raw API error passed through to the user.

## Testing

- OAuth flow integration tests against Shopify's documented flow (using a dedicated Shopify Partner dev store,
  per [`docs/product-spec/23-testing-strategy.md`](../product-spec/23-testing-strategy.md)).
- HMAC verification unit tests: valid signature accepted, tampered payload rejected.
- Webhook handler tests for both `app/uninstalled` and `themes/publish`, including malformed/unverified payload
  rejection.
- Theme-slot detection tests, including the near-cap warning path.
- Token encryption tests: a token is never observable in plaintext outside the encryption boundary, including
  in logs.

## Completion Criteria

- A real merchant Shopify store (a Partner dev store for testing) can complete the OAuth flow and have its
  `ShopifyInstallation` correctly persisted.
- First-publish theme-slot detection and `themeCreate` correctly install an unpublished Base Theme.
- `app/uninstalled` reliably invalidates the connection.
- All Phase 11 security tests (HMAC, CSRF, token encryption) pass.

## Next Phase

[12 — Publishing](12-publishing.md) uses this phase's connected `ShopifyStore` and installed `Theme` to push a
real Store Configuration live.
