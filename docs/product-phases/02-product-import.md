# Phase 02 — Product Import

## Objective

Prove the first real user workflow: a user submits a product URL and the server returns raw extracted product
data. This phase works completely without LiquidJS, the Base Theme, or a Store Configuration — it only proves
fetch + extract.

## Scope

- Start Store UI entry point that leads to a product-URL submission form.
- Server-side fetch of a submitted URL.
- Source-specific raw extraction (Shopify product pages first, per MVP's narrowed allowlist — see
  [`docs/product-spec/05-product-import.md`](../product-spec/05-product-import.md) and
  [`docs/product-spec/24-mvp-scope.md`](../product-spec/24-mvp-scope.md) §"Product Import").
- A deterministic sample-product mode that exercises the same downstream path without a network fetch, so the
  rest of the pipeline is testable without external dependencies.
- Debug output of the raw extraction result (kept for inspection, per
  [`docs/product-spec/05-product-import.md`](../product-spec/05-product-import.md)).

## Out of Scope

- Turning raw data into the canonical Normalized Product Contract — that's Phase 03. This phase's output is
  intentionally still source-shaped, not normalized.
- Broad source coverage beyond the MVP allowlist (arbitrary marketplaces, competitor-store scraping) — tracked
  as a later, lower-priority expansion, not blocking MVP.
- Any LiquidJS/Base Theme/preview code.
- SSRF hardening depth beyond what's specified in
  [`docs/product-spec/21-security-and-multi-tenancy.md`](../product-spec/21-security-and-multi-tenancy.md) §19
  — that document's protections (scheme allowlist, private/reserved IP rejection, redirect re-validation,
  isolated fetch path, size/time limits, domain throttling) are all in scope for this phase, since the fetch
  path itself is being built here; anything beyond that document's spec is not.

## Architecture

```text
Start Store UI
  |
Enter product URL
  |
Submit -> Next.js API route (server-only)
  |
ProductFetcher (server-side fetch, SSRF-guarded)
  |
Source-specific raw extraction
  |
Raw extraction result + import status
```

The fetch and extraction logic must never be reachable from client code directly — the client only calls the
API route, which owns the fetch (Phase 01's server/client boundary is what makes this enforceable).

## Inputs

A user-submitted URL string (or a "use the sample product" selection instead of a URL).

## Outputs

A raw extraction result plus an import status (e.g., pending/importing/succeeded/partial/failed — exact status
vocabulary from
[`docs/product-spec/19-data-model.md`](../product-spec/19-data-model.md)'s `Product.importStatus`), persisted
or held for Phase 03 to normalize.

## Dependencies

Phase 01 (server/client boundary, validation, error handling, Postgres connection).

## Implementation Areas

- Start Store UI: the four entry points from
  [`docs/product-spec/05-product-import.md`](../product-spec/05-product-import.md) (Shopify product URL fully
  implemented; supplier link and competitor store shown but explicitly marked unsupported, never faked; sample
  product fully implemented).
- `ProductFetcher`: server-side URL fetch with timeout, SSRF guards, and clear failure typing (invalid URL vs.
  unreachable vs. HTTP error vs. unsupported page).
- Source-specific raw extraction adapters, keyed by `sourcePlatform` (`shopify` first).
- Deterministic sample-product fixture that flows through the identical adapter interface as a real fetch.
- Debug/raw-data retention for the inspection screen.

## Data Contracts

No new schema beyond what Phase 01 established generically. The extraction result at this phase is
intentionally source-shaped (e.g., raw Shopify product JSON), not yet the Normalized Product Contract — see
Phase 03 for that shape. If persisted at this phase, use a single field wide enough to hold arbitrary raw
extraction output (the final structured `Product` columns are defined in Phase 03/10).

## User Flow

```text
How do you want to start your store?
  |
[Import your product from Shopify]  <- fully implemented this phase
[Import from a supplier link]        <- shown, marked unsupported
[Import from a competitor store]     <- shown, marked unsupported
     OR
[Try a sample product]              <- fully implemented this phase
  |
Product URL
  |
[Import Product] -> loading state -> success or error state
```

## Error Handling

Every one of these must resolve to a clear UI state, never a crash or an unhandled server exception:

- Loading (fetch in progress).
- Success (raw data extracted).
- Invalid URL (malformed input, rejected before any network call).
- Unreachable URL (network/timeout failure).
- Extraction failure (page reachable, but no recognizable product data found).
- Missing title / price / images / variants at the raw-extraction level (surfaced, not hidden — Phase 03 turns
  this into the Normalized Product Contract's `importedFieldsMissing` list).
- Unsupported page (not a source this phase's adapters handle).

## Testing

- Unit tests for the fetch layer's failure typing (invalid URL, unreachable, HTTP error) using fixtures, no
  real network call required for these cases.
- Unit tests for the Shopify extraction adapter against a frozen sample payload.
- One test that a genuinely invalid URL never throws an unhandled exception, only ever resolves to a typed
  error result (this is the specific regression this phase must guard against, per
  [`docs/product-spec/17-validation-and-error-handling.md`](../product-spec/17-validation-and-error-handling.md)'s
  "hard block, never partial apply" principle applied to import).
- A nightly (not per-commit) live-fetch smoke test against a small number of real product URLs, per
  [`docs/product-spec/23-testing-strategy.md`](../product-spec/23-testing-strategy.md)'s fixture strategy.

## Completion Criteria

- Submitting a real Shopify product URL returns raw extracted data end-to-end through the UI.
- Submitting an invalid or unreachable URL shows a clear error state, with no server crash.
- The sample product path works with no network access at all.
- The raw extraction result is inspectable (debug view), not hidden.

## Next Phase

[03 — Product Normalization](03-product-normalization.md) consumes this phase's raw, source-shaped extraction
result and turns it into the one canonical product shape every later system relies on.
