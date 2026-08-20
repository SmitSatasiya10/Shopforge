# Product Import

Turns a merchant-supplied product URL into normalized, structured `Product` data — the ground-truth facts that seed [AI Generation](04-ai-architecture.md). Product Import produces only imported facts; it never writes AI-authored content.

## 1. Pipeline

```
Product URL
    |
Import / Scraper
    |
Normalized Product Data
```

| Stage | What happens |
|---|---|
| Product URL | User supplies a merchant product page URL (or toggles to a free-text description instead, which bypasses this pipeline entirely and seeds `Product` via AI drafting — out of scope for this document). |
| Import / Scraper | The URL is validated, safely fetched, and run through a source-specific extraction adapter. |
| Normalized Product Data | The adapter's raw extraction is mapped into the canonical `Product` field set and persisted. |

`Product` is a distinct entity from anything living in the Store Configuration: `Product` holds imported facts (title, description, price, images, variants); a `StoreConfigVersion`'s section settings hold AI-authored or user-edited presentation *built from* those facts. Product Import never writes to a `StoreConfiguration` directly and never generates copy — that boundary is what lets generation be re-run against the same source facts without re-scraping, and lets an accuracy review always tell "what we imported" apart from "what the AI decided to say about it."

## 2. Entities

### `Product`

The persisted, normalized result of one import (or the active re-import) for a `Project`.

| Field | Type | Notes |
|---|---|---|
| id | uuid (pk) | |
| projectId | uuid (fk Project) | |
| sourceUrl | string | the merchant-provided product page URL |
| sourcePlatform | enum(`shopify`, `woocommerce`, `bigcommerce`, `amazon`, `generic_html`, `unknown`), nullable | detected during scraping; selects which extraction adapter ran |
| importStatus | enum(`pending`, `importing`, `succeeded`, `partial`, `failed`) | |
| importError | text, nullable | failure reason when `failed`; warning summary when `partial` |
| importedFieldsMissing | string[], nullable | e.g. `["variants", "brand"]` — populated when `importStatus = partial` |
| title | string, nullable | null until import completes |
| description | text, nullable | raw scraped description, pre-AI-rewrite |
| price | decimal, nullable | |
| compareAtPrice | decimal, nullable | |
| currency | string, nullable | |
| brand | string, nullable | |
| category | string, nullable | |
| images | json, nullable | `[{ url, altText, position }]` |
| variants | json, nullable | `[{ title, sku, price, options }]` |
| options | json, nullable | `[{ name, values[] }]` |
| availability | enum(`in_stock`, `out_of_stock`, `unknown`), nullable | not all sources expose this |
| rawScrapedHtmlUrl | string, nullable | blob storage pointer to the fetched page, kept for re-processing/debugging without re-hitting the source URL |
| importedAt | timestamp, nullable | |
| createdAt | timestamp | |
| updatedAt | timestamp | |

**Relationships:** `Product` belongs_to `Project`. Indexed on `projectId` and `importStatus`.

Every content field is nullable by design: import is a best-effort scrape against an arbitrary external page, so partial and failed outcomes are first-class states, not exceptions. MVP builds around one primary `Product` per `Project`; the relationship is modeled one-to-many so a future multi-product store doesn't require a schema change.

### `ProductImportJob`

The operational record for one import *attempt* — the async unit the system tracks while a fetch is in flight, distinct from the `Product` record it populates on completion.

- Created when a `Project` is created with a submitted Product URL as its seed (import cannot be queued pre-authentication — see §3).
- Tracks the attempt through its own lifecycle: `queued → fetching → extracting → normalizing → succeeded | partial | failed`, mirroring `Product.importStatus`'s terminal values.
- On completion, writes its result onto the associated `Product` record (`importStatus`, `importError`, `importedFieldsMissing`, and the normalized content fields).
- A manual re-import (user retries after a failure, or explicitly re-syncs from the source URL) creates a new `ProductImportJob` against the same `Product`, rather than mutating history in place.

## 3. Trigger and sequencing

Import is gated behind authentication — nothing that costs Shopforge money (a fetch, a scrape, downstream AI generation) runs for an anonymous visitor:

1. The user pastes a Product URL. It is held client-side, unauthenticated, and only lightly checked (well-formed, resolves) — no `ProductImportJob` exists yet.
2. Sign-up/login creates the `User`/`Organization`/`Project`, attaching the submitted URL to the new `Project` as its seed.
3. Only then is a `ProductImportJob` created and the real fetch/extract pipeline (§4–§6) begins.

Import runs asynchronously; the user may wait on a staged progress screen or navigate away and be notified on completion.

## 4. URL validation

Two validation passes, at two different trust levels:

| Pass | When | Checks |
|---|---|---|
| Pre-check (unauthenticated) | On URL submission, before sign-up | Syntactically valid URL; lightweight reachability check only — no scrape, no content fetch |
| Import-time validation (authenticated) | When the `ProductImportJob` starts | Full SSRF-safe fetch validation (§5); confirms the resolved page looks like a product page, not a search/category/homepage URL, before attempting extraction |

A URL that fails the pre-check is rejected inline without a round trip. A URL that passes the pre-check but fails import-time validation (e.g. a homepage URL, or a page shape no adapter recognizes) produces a full import failure (§8), not a silent skip.

## 5. SSRF-safe fetching

Fetching an arbitrary, merchant-supplied URL from backend infrastructure is inherently an SSRF-shaped risk surface. Every import fetch — the initial page fetch and every subsequent scraped-image fetch — goes through the same controls:

| Mitigation | Design |
|---|---|
| Scheme allowlist | Only `https://` (and `http://` only if explicitly required for a legacy source) is accepted. No `file://`, `ftp://`, `gopher://`, or other schemes. |
| DNS/IP validation before fetch | The target hostname is resolved and the resulting IP checked against private/reserved/link-local ranges (RFC1918 space, loopback, link-local, including the `169.254.169.254` cloud metadata address) and rejected if it resolves internally. |
| Redirect re-validation | Each redirect hop's target is independently re-validated against the same scheme/IP checks before being followed — a public product URL that redirects to an internal address is blocked at the redirect hop. |
| Network isolation | Fetches run from a network-isolated fetch service/egress proxy with no routable access to internal application infrastructure, so a gap in the checks above fails closed rather than reaching an internal service. |
| Size and time limits | Every fetch is bounded by a response-size cap and a timeout. |
| Domain-level throttling | Repeated fetches to the same domain in a short window are rate-limited, both against abuse of Shopforge as a general fetch proxy and to be a non-abusive scraper toward third-party sites. |
| No recursive crawling | A `ProductImportJob` fetches exactly the submitted URL and never follows links discovered on that page — the fetch surface never grows beyond what the merchant explicitly submitted. |

Scraped images are fetched under these same controls, then re-encoded and validated identically to a direct upload before being referenced by a `Product.images` entry — a scraped image is external input twice over (fetched from an arbitrary URL, then stored), so it receives both the fetch-time and the storage-time controls.

Once fetched, page content is treated as untrusted input for AI purposes exactly like any other AI-pipeline input: SSRF controls above govern *what gets fetched*; downstream prompt-injection controls (applied when this data later reaches AI Generation) govern *what the AI pipeline does with the fetched content*. Product Import applies the first set only — content-level sanitization for AI consumption is [AI Architecture](04-ai-architecture.md)'s concern.

## 6. Extraction

A fetched page is routed to a source-specific extraction adapter, keyed off `sourcePlatform`:

```
sourcePlatform: shopify | woocommerce | bigcommerce | amazon | generic_html | unknown
```

The adapter is responsible for locating and pulling raw values for title, description, price/compare-at price, currency, images, variants, options, brand, category, and availability out of that source shape's markup/structured data (e.g. JSON-LD, platform-specific DOM patterns, `og:` meta tags). `generic_html` is the structural fallback for a source that doesn't match a known platform adapter but still exposes enough standard markup (structured data, `og:` tags) to attempt extraction; `unknown` means no adapter — real or generic — was able to extract anything.

**MVP supported-source allowlist — TBD.** MVP narrows Product Import to a small, explicitly allowlisted set of source shapes rather than arbitrary URLs (broad source coverage is post-MVP). The exact list of allowlisted sources and the criteria for expanding it post-MVP are unresolved — not to be treated as decided by this document. A URL whose platform isn't on the allowlist is rejected at import-time validation (§4) with the unsupported-site failure message (§8), even if it would otherwise be fetchable and even if `generic_html` extraction might technically succeed against it.

## 7. Normalization

Extraction output is mapped into the canonical `Product` fields — this mapping is what "normalized" means here: regardless of which adapter ran, downstream consumers (AI Generation, the review/confirm step) see the same field shape.

| Product field | Normalization behavior |
|---|---|
| title | Extracted as-is from the source's primary product title. Not rewritten or trimmed automatically — a merchant reviews and can edit an SEO-stuffed marketplace title before generation. |
| description | Raw scraped description, pre-AI-rewrite. This is source material for AI Generation, not final store copy. |
| price / compareAtPrice / currency | Parsed from the source's price representation; `compareAtPrice` and `currency` are nullable where the source doesn't expose them distinctly. |
| images | Normalized to `[{ url, altText, position }]`, position preserving source order. Scraped under the SSRF/re-encoding controls in §5. |
| variants | Normalized to `[{ title, sku, price, options }]`. A source with no variant structure (a single-SKU product) yields an empty or null array, not an error. |
| options | Normalized to `[{ name, values[] }]` (e.g. `{ name: "Color", values: ["Black", "White"] }`), independent of the variant list so option structure survives even where variant-level pricing isn't available. |
| brand | Extracted where the source exposes it (structured data, a vendor field); null otherwise. |
| category | Extracted or inferred; a light AI classification pass may run here specifically to help section selection downstream — it categorizes, it does not author copy. |
| availability | `in_stock` / `out_of_stock` / `unknown` — many sources don't expose stock status at all, in which case `unknown` is the correct value, not a failure. |
| sourceUrl | Stored verbatim as submitted (post-redirect-resolution per §5). |

Fields the adapter can't populate are left `null` rather than defaulted to a placeholder value — a null `brand` and an empty-string `brand` mean different things downstream, and only the former is accurate.

## 8. Failure handling

Import distinguishes **full failure** (nothing usable extracted) from **partial success** (some fields extracted, others missing) — a partial result is not discarded.

| Outcome | `importStatus` | Behavior |
|---|---|---|
| Full failure | `failed` | No `Product` content fields populated; `importError` holds the failure reason. User is offered: retry with a different URL, switch to the description-based path, or (where relevant) proceed manually. |
| Partial | `partial` | Whatever fields extracted are persisted; `importedFieldsMissing` lists what didn't (e.g. `["variants", "brand"]`). Import proceeds to the confirm/edit step with those fields visibly empty rather than blocking. |
| Success | `succeeded` | All expected fields for that source shape extracted. |

**Common failure causes:**

- Unsupported site — the URL's platform isn't on the MVP allowlist (§6), or resolves to `unknown` with no adapter able to extract anything.
- Page-structure mismatch — the target page's markup doesn't match any known adapter pattern (e.g. a source site redesign).
- Anti-bot blocking/rate-limiting — the source blocks or throttles the fetch.
- Partial JS-rendered content — a field (commonly price) is populated client-side by JavaScript the fetch doesn't execute, so it's absent from the fetched HTML.
- Wrong page type — the URL resolves to a search, category, or homepage rather than a single product page (caught at import-time validation, §4).

**Retries:** A `ProductImportJob` failure is user-initiated retry, not automatic background retry against the same source — the user is shown the failure and chooses to retry, switch input mode, or proceed with partial data. A retry creates a new `ProductImportJob` against the existing `Product` record.

**Missing required fields:** At minimum a title and one image must be present before the `Project` proceeds past the confirm step. If the scrape returned neither, the user is prompted to supply them manually rather than being hard-blocked — Product Import degrades to a manual-entry fallback for the fields it couldn't get, rather than failing the whole `Project`.

`ProductImportJob`/`Product` status, plus the specific failure reason, is logged both for user-facing messaging and to identify which source adapters need attention as failure patterns emerge across imports.

## 9. Output boundary

Product Import's output is exactly the normalized `Product` record described in §2 and §7 — imported facts only. It does not:

- Select or order sections.
- Generate marketing copy, headlines, or any section content.
- Write to a `StoreConfiguration`.

`Product` is the sole input `AI Generation` (see [AI Architecture](04-ai-architecture.md)) reads to seed section selection, ordering, and settings/content authoring. Everything downstream of that boundary is AI-authored or user-edited presentation, tagged and tracked separately from the `Product` facts it was built from — see [AI Architecture](04-ai-architecture.md) for the provenance model.
