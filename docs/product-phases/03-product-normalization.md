# Phase 03 — Product Normalization

## Objective

Define and implement the canonical product model every downstream system consumes, so nothing past this phase
ever touches source-specific raw scraper output again.

## Scope

- The Normalized Product Contract: `title`, `description`, `price`, `compareAtPrice`, `currency`, `images`,
  `variants`, `vendor`, `productUrl`, `sourcePlatform` — per
  [`docs/product-spec/05-product-import.md`](../product-spec/05-product-import.md) and the `Product` entity in
  [`docs/product-spec/19-data-model.md`](../product-spec/19-data-model.md).
- A normalizer per source adapter from Phase 02 (Shopify first), each producing this identical shape.
- Explicit handling of optional/missing values — every content field is nullable, and normalization must never
  throw on a sparse or malformed raw payload.
- Schema validation of the normalized shape itself (not just the raw input).
- A "required fields missing" check (title + at least one image is the practical minimum to proceed, per
  [`docs/product-spec/05-product-import.md`](../product-spec/05-product-import.md)) that downstream phases can
  use to decide `succeeded` vs. `partial` vs. `failed`.

## Out of Scope

- Any UI beyond exposing the normalized result and its missing-fields list (the Product Data Inspection Screen
  itself is part of Phase 02's UI, reusing this phase's output — this phase owns the shape, not the screen).
- Turning a normalized product into a Store Configuration — that's Phase 04.
- AI-authored content of any kind — normalization only carries forward what was actually scraped/extracted.

## Architecture

```text
Raw extraction (source-shaped, from Phase 02)
  |
ProductNormalizer (one per source)
  |
Normalized Product Contract (schema-validated)
  |
Required-fields check -> import status
```

Every source's normalizer is a pure function: raw payload in, Normalized Product Contract out, never throwing —
a malformed or missing field becomes `null`/empty-array in the output, not an exception.

## Inputs

Raw, source-shaped extraction result from Phase 02.

## Outputs

A Normalized Product Contract instance, schema-validated, plus a computed list of missing required fields and a
resulting import status.

## Dependencies

Phase 02 (raw extraction to normalize).

## Implementation Areas

- `ProductNormalizer` per source platform (`shopify` first, matching Phase 02's adapters one-to-one).
- Shared normalized-schema validator (used identically regardless of which normalizer produced the data).
- Missing-fields computation, feeding the import-status logic Phase 02 introduced.
- Type coercion helpers (price strings to numbers, HTML description to plain text where specified, etc.) kept
  small and source-agnostic wherever possible.

## Data Contracts

```text
NormalizedProduct {
  title: string | null
  description: string | null
  price: number | null
  compareAtPrice: number | null
  currency: string | null
  images: { url: string, altText: string | null }[]
  variants: { title: string, price: number | null, sku: string | null }[]
  options: { name: string, values: string[] }[]
  vendor: string | null
  productUrl: string
  source: "shopify" | ... (one entry per supported adapter, per Phase 02's allowlist)
}
```

This is the one shape every later phase is allowed to depend on. No phase past this one should read
source-specific raw fields directly — see
[`docs/product-spec/05-product-import.md`](../product-spec/05-product-import.md) for the authoritative field
list and why downstream systems must never consume raw scraper output directly (consistency, and insulation
from source-specific quirks).

## User Flow

No new user-facing flow — this phase's output feeds directly into the Product Data Inspection Screen introduced
in Phase 02's UI, now showing genuinely normalized, consistent data regardless of source.

## Error Handling

- A normalizer must never throw — a missing or malformed raw field becomes `null` or an empty array in the
  normalized output, never an exception that aborts the request.
- The required-fields check must correctly classify: all present → succeeded; title present but other fields
  missing → partial; title itself missing → failed. This exact classification is what Phase 02's import-status
  UI states depend on.

## Testing

- Unit tests per normalizer covering: a full/complete raw payload, a mostly-empty raw payload (missing-data
  test — must not throw, must correctly report missing fields), and a malformed/garbage payload.
- A schema-validation test confirming the normalized output always conforms to the Normalized Product Contract
  regardless of which normalizer produced it.
- A snapshot/fixture test locking the exact field mapping per source, so a future raw-format change is caught
  as a diff, not silently ignored.

## Completion Criteria

- Every Phase 02 source adapter has a corresponding normalizer producing the identical Normalized Product
  Contract shape.
- A sparse/malformed raw payload never crashes normalization — it always resolves to a normalized object with
  an accurate missing-fields list.
- The Product Data Inspection Screen (Phase 02) displays genuinely normalized data end-to-end for at least the
  Shopify source and the sample product.

## Next Phase

[04 — Store Configuration](04-store-configuration.md) uses the Normalized Product Contract to seed the initial
Store Configuration's section settings — this is the first point where product data starts shaping what the
storefront preview will show.
