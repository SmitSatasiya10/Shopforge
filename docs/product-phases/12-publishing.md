# Phase 12 — Publishing

## Objective

Push a Store Configuration to the connected Shopify store's installed theme, making it the merchant's live
storefront — the final phase before a real store exists in the world running Shopforge's output.

## Scope

- The publish pipeline: Final Store Configuration → validate → convert to Shopify Theme Configuration (JSON
  templates/settings only, never Liquid) → write via `themeFilesUpsert` → `themePublish` (sets `role: MAIN`) →
  `PublishRecord`, per
  [`docs/product-spec/14-shopify-publishing.md`](../product-spec/14-shopify-publishing.md).
- The Store Configuration → Shopify mapping: `pages.<page>.sections[]` (array) → `templates/<page>.json`
  `sections:{}` (keyed object) + `order:[]`; `SectionInstance.type` resolves the same `sections/<type>.liquid`
  the preview already uses; `settings` pass through per the Shared Settings Contract with assets resolved to
  Shopify-hosted URLs; `blocks[]` → keyed object + `block_order` — per
  [`docs/product-spec/15-shopify-theme-structure.md`](../product-spec/15-shopify-theme-structure.md).
- Rollback: republishing a prior `PublishRecord`'s configuration version through the identical convert/write/
  publish path (not a special-cased code path), always creating a *new* forward-only `PublishRecord`.
- Publish preview/dry run before the live `themePublish` call.
- Subsequent-publish handling: targets the existing `shopifyThemeId`; if the Base Theme version changed since
  last publish, computes and pushes the diff via `themeFilesUpsert`/`themeFilesDelete` (batched, per Shopify's
  API limits).
- Explicit-action-only semantics: `themePublish` (the only call that sets `role: MAIN`) fires only on an
  explicit user action, never automatically.

## Out of Scope

- Any Liquid/HTML/CSS/JS generation at publish time — the Base Theme's Liquid is written once at install
  (Phase 11), never regenerated per publish; only JSON templates/settings are written per publish.
- Base Theme auto-update policy for already-published stores — remains an open item, not resolved here.
- Exact partial-failure recovery/resume semantics beyond "never leave the theme half-applied against MAIN" — a
  documented open item in
  [`docs/product-spec/14-shopify-publishing.md`](../product-spec/14-shopify-publishing.md), to be resolved with
  a specific retry/resume design before this phase's Completion Criteria are considered fully met for
  production traffic (see Phase 14).

## Architecture

```text
Store Configuration (Phase 10's active/pre-publish version)
  |
Validate (Phase 04/13's pipeline, including the publish-time layers 7-8)
  |
Convert to Shopify Theme Configuration (JSON only)
  |
themeFilesUpsert (batched, JSON templates/settings)
  |
Poll processing
  |
themePublish (role: MAIN) -- only on explicit user action
  |
Poll again
  |
PublishRecord created
```

**Never written to Shopify at publish time**: provenance tags, `contract.json`, `editor.meta.json`,
`data-sf-*` (emitted by the Liquid itself, not a conversion concern), `StoreConfigVersion`/`Diff` history,
`GenerationJob`/session state. The conversion is one-directional — Store Configuration → Shopify, never read
back.

## Inputs

The Project's active `StoreConfigVersion` (Phase 10), the connected `ShopifyStore` + installed `Theme` (Phase
11).

## Outputs

A live Shopify storefront reflecting the published Store Configuration, plus a `PublishRecord` capturing what
was published, when, and to which `Theme`.

## Dependencies

Phase 10 (a versioned configuration to publish) and Phase 11 (a connected store + installed theme to publish
to).

## Implementation Areas

- Store Configuration → Shopify JSON converter (the mapping table above), including asset URL resolution to
  Shopify-hosted URLs where product-bound (per
  [`docs/product-spec/13-assets.md`](../product-spec/13-assets.md)'s publish-time asset resolution rule — all
  other assets keep their Shopforge-hosted URL verbatim).
- Publish-time validation layers 7 ("Shopify will accept the write") and 8 ("publish actually completed") from
  [`docs/product-spec/17-validation-and-error-handling.md`](../product-spec/17-validation-and-error-handling.md)
  — these consume no AI retry budget; recovery is a direct action in the Publish UI (retry/reconnect/trim), not
  a regeneration loop.
- `themeFilesUpsert`/`themeFilesDelete` batching (respecting Shopify's per-request file-count limits) and
  processing-status polling.
- `themePublish` call, gated strictly behind explicit user confirmation.
- `PublishRecord` creation on every successful publish, forming the append-only history rollback replays
  through.
- Rollback UI/flow: select a prior `PublishRecord`, republish its configuration version through the same path.
- Publish preview/dry-run: run the conversion and validation without the final `themePublish` call, surfacing
  what would change.

## Data Contracts

```text
PublishRecord { id, projectId, shopifyThemeId, storeConfigVersionId, publishedAt, status }
```

Full authoritative shape and the complete call sequence:
[`docs/product-spec/14-shopify-publishing.md`](../product-spec/14-shopify-publishing.md).

## User Flow

```text
User reviews the current preview, satisfied with the result
  |
Clicks Publish
  |
Dry-run / preview of what will change (optional but recommended)
  |
Explicit confirmation
  |
Configuration converted and written to the theme
  |
themePublish makes it live
  |
PublishRecord created, shown in publish history
  |
[Later] User can select a prior PublishRecord and roll back
```

## Error Handling

- A failed or partial `themeFilesUpsert` must never leave the live (`MAIN`) theme half-applied — the
  `UNPUBLISHED` staging theme absorbs partial failures; `themePublish` (the only call that flips to `MAIN`) only
  fires after every prior write step has confirmed success.
- Shopify Admin API `userErrors` and async job failures are checked before proceeding to the next step in the
  sequence, never assumed successful.
- A publish-time validation failure (layers 7-8) surfaces a direct, actionable recovery path in the Publish UI —
  never routed back through the AI clarification/retry loop (that loop is for content-judgment failures,
  layers 3-6, not operational Shopify-API failures).
- Rollback failures (the republish attempt itself fails) must not corrupt or truncate the `PublishRecord`
  history — the log stays forward-only and honest regardless of whether a given rollback attempt succeeded.

## Testing

- Converter unit tests: Store Configuration → Shopify JSON mapping, covering nested sections, blocks, asset
  references, and ordering, against fixture configurations (per
  [`docs/product-spec/23-testing-strategy.md`](../product-spec/23-testing-strategy.md)'s Minimal/Full-Catalog/
  Edge-Case/Multi-Page/Large fixtures).
- Integration tests against a dedicated Shopify Partner dev store: full install → publish → verify live →
  rollback → verify reverted, run nightly/pre-release.
- Partial-failure simulation tests: a write step fails mid-sequence, confirming `MAIN` is never left in a
  half-applied state.
- Publish-time validation tests (layers 7-8) against simulated Shopify API error responses.
- End-to-end test: the complete flow from
  [`docs/product-spec/01-product-architecture-overview.md`](../product-spec/01-product-architecture-overview.md)
  — Start Store → Import → Generate → Preview → Edit → Save → Publish → real Shopify store — run against the
  dedicated dev store.

## Completion Criteria

- A real Store Configuration publishes successfully to a Shopify Partner dev store and is visibly live.
- Rollback to a prior `PublishRecord` correctly restores that earlier state.
- No partial-failure scenario leaves the live theme half-applied, verified under test.
- The full end-to-end flow (Start Store through live Shopify store) passes.

## Next Phase

With the full product loop proven end-to-end, [13 — Testing and Hardening](13-testing-and-hardening.md)
consolidates every phase's own testing requirements into the release-gate harness, and
[14 — Production Readiness](14-production-readiness.md) is the final checklist before real merchants use this.
