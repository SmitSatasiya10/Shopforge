# Validation and Error Handling

Every write to the Store Configuration — AI-generated or manually edited — passes through the same validation
pipeline before it is allowed to persist, before it reaches the live preview, and again before it reaches a
real Shopify store. This document defines that pipeline: its stages, its severity model, what happens when a
check fails, and what the user sees.

**Scope note:** the Section Library's Liquid templates (see [Base Theme and Section Library](02-base-theme-and-section-library.md))
are controlled, first-party source code, authored once per section and maintained like any other application
code — they go through ordinary code review, not this pipeline. Nothing in this document validates Liquid
source. It validates **data**: the Store Configuration, the JSON document that says which fixed sections
appear on a page, in what order, with what settings and content. Every check below exists because the Store
Configuration is produced and edited by parties — an AI model, a merchant — that can get *data* wrong in ways a
fixed, reviewed Liquid template is entitled to assume never happens.

## 1. Where validation sits in the pipeline

```
Product Import
      |
AI Output
      |
Store Configuration
      |
Section Settings
      |
Assets
      |
LiquidJS Preview
      |
Shopify Publish
```

This pipeline maps onto eight validation categories, each with its own trigger point. Some run continuously
during editing; some run once, only at publish:

```
   AI operation emitted   ─┐
   Editor field edited    ─┼─▶ 1. Configuration validation   (structural JSON shape)
   Version restored        ┘         │
                                      ▼
                             2. Section validation        (type exists in Section Library)
                                      │
                                      ▼
                             3. Settings validation       (settings match section's contract)
                                      │
                            ┌─────────┼─────────┐
                            ▼                   ▼
                  4. Assets validation   5. Product references validation
                            │                   │
                            └─────────┬─────────┘
                                      ▼
                             6. Preview validation        (LiquidJS renders without error)
                                      │
                            ── continuous during editing ──
                                      │
                                      ▼  (only at Publish)
                             7. Shopify validation         (Admin API will accept the write)
                                      │
                                      ▼
                             8. Publish validation          (the write actually completed)
```

- **Layers 1–3** are the cheap, structural gate. They run on every AI-emitted operation before it is allowed to
  merge into the draft, and on every Visual Editor save, since both write through the identical mutation path
  (see [Versioning and Undo/Redo](18-versioning-and-undo-redo.md)).
- **Layers 4–5** run alongside 1–3 for any operation that touches an asset- or product-bound setting.
- **Layer 6** runs continuously as the merchant edits — it reuses the same LiquidJS render that already powers
  the same-origin preview iframe (see [Preview Architecture](06-preview-architecture.md)) — and again as one
  exhaustive full-page pass immediately before publish.
- **Layers 7–8** are publish-time only; they have no meaning before an actual write to Shopify is attempted (see
  [Shopify Publishing](14-shopify-publishing.md)).

Every layer's outcome is recorded as a `ValidationSummary` attached to the mutation that produced it and
carried into the resulting `Diff` and `AuditLog` entries — validation outcomes are part of the permanent
history, not a transient check discarded once passed.

## 2. Severity model: hard block vs. warning

Two outcomes recur at every layer:

| Outcome | Meaning |
|---|---|
| **Hard block** | The change cannot be applied (or, at publish time, publish cannot proceed). The entire mutation is rolled back — nothing partial is ever applied. The user never sees a broken Store Configuration as a result. |
| **Warning** | The change *can* be applied, but the system flags something worth the user's attention — shown inline in plan-review UI and/or attached to the resulting `Diff`/history entry. |

**Dividing line:** if applying the change would leave the Store Configuration referencing something that
doesn't exist, would fail to render, or would be rejected outright by Shopify, it is a hard block. If it is a
quality/appearance concern a human is better positioned to judge than an automated check, it is a warning.

## 3. The eight validation categories

### 3.1 Configuration validation (schema validation)

**Question:** is the Store Configuration structurally valid — well-formed, matching the schema in
[Store Configuration](03-store-configuration.md), with required fields present and correctly typed?

**Runs:** first, before every other layer — on every AI operation before merge, every Visual Editor save, and
as the first gate immediately before publish (a cheap re-check).

**Checks:**
- Document parses / matches the expected in-memory shape.
- Top-level `pages` key exists, keyed by page identifier (`home`, `product`, etc.).
- Each page has a `sections` array.
- Every section entry has `id` (string, unique within its `sections` array), `type` (string), `settings`
  (object, may be empty but must be present and must be an object).
- If present, `blocks` is an array; each block entry has `id` (unique within its parent section's `blocks`
  array), `type`, and a `settings` object.
- No unrecognized top-level keys outside the defined schema.

**Hard block:** any structural violation — there is no partial or "mostly fine" outcome. On the AI side this
indicates a bug in the generation/operation system, not a user-caused problem, and is logged at elevated
internal severity in addition to being blocked. On the editor side it indicates a client-side bug.

**Warning:** none — a malformed document has no partially-safe interpretation.

**User-visible failure:** for an AI-caused failure, this never reaches the user as a raw structural error — it
surfaces, if at all, as a generic "couldn't build a valid update for that request, please try rephrasing." For
an editor-caused failure (which the editor's own UI should prevent in the first place), it surfaces as
"couldn't save that change," with the save blocked.

### 3.2 Section validation

**Question:** does every `sections[].type` (and `blocks[].type`) referenced actually exist in the fixed Section
Library?

**Runs:** immediately after Configuration validation, on the same triggers, and again pre-publish (the catalog
is fixed, but a section can be deprecated/removed between draft and publish).

**Checks:**
- Every `type` matches an entry in the current Section Library catalog.
- The referenced section is not deprecated/removed in a way that blocks new use (deprecated-but-rendering is a
  warning, not a hard block).
- If the Section Library is versioned, the referenced section version is one the current Base Theme and Preview
  Renderer actually ship. **TBD** — Section Library versioning scheme is not finalized; see
  [Base Theme and Section Library](02-base-theme-and-section-library.md).

**Hard block:** an unknown or nonexistent `type`. This can only come from a bug — AI is only ever supposed to
offer section types that genuinely exist in the catalog it was given, and the editor's section picker only ever
lists real catalog entries — so it is treated as a system bug, not a user mistake, and logged accordingly.

**Warning:** a `type` that exists but is marked deprecated (still renders correctly, but should be nudged
toward a supported replacement before eventual retirement).

**Example:** an operation proposes `type: "hero-banner-v1"`, but the Section Library only currently exposes
`"hero-banner"` (the old id was retired and the client's cached catalog was stale) → hard block, "section type
no longer available," logged as a cache-staleness bug.

### 3.3 Settings validation

**Question:** for every section and block, do the provided `settings` match that section/block type's settings
contract, as declared in the Section Library and formalized in the [Store Configuration](03-store-configuration.md)
schema and the [Shared Section Contract](12-shared-section-contract.md)?

This is the highest-volume layer by far — almost every AI generation operation and almost every editor field
edit changes a value under some `settings` object.

**Runs:** immediately after Section validation, same triggers, plus one aggregate pass across every section on
every page pre-publish.

**Checks:**
- Every key present in `settings` corresponds to a setting declared in that type's contract — no writing values
  for undeclared settings.
- Every setting declared **required** is present with a non-empty value.
- Every value matches its declared type: string, richtext, number, boolean, color, image/asset reference, URL,
  select/enum, range, or a nested object/array shape for compound settings.
- Enum/option-constrained settings receive a value from the declared allowed set only.
- Range-constrained settings (min/max/step) receive an in-range, step-aligned value.
- Fields defined by the Shared Section Contract (spacing/padding tokens, a shared color-role setting, a shared
  layout-variant enum) are validated once against that shared contract, not re-specified per section.
- Block count stays within any `maxBlocks` the section's contract declares.
- No duplicate block `id`s within a section (re-checked here specifically in the context of block-count/type
  limits, in addition to the base check in Configuration validation).

**Hard block:** wrong type for a setting; a required setting missing; a value outside an enum's set; a value
outside a range's min/max or off-step; block count exceeding `maxBlocks`; a block `type` not declared as valid
for that section. All of these describe a configuration the section's Liquid template was never written to
handle — the template is allowed to assume its contract holds, and this layer is what makes that assumption
safe.

**Warning:** a value that is technically valid but marked deprecated-but-still-accepted in the contract
(kept for backward compatibility with older configurations).

**Example — fail:** contract declares `{ id: "heading_size", type: "range", min: 12, max: 48, step: 2 }`,
operation proposes `value: 60` → hard block, "heading_size must be between 12 and 48."

**Example — fail:** a "Testimonials" section's contract declares `maxBlocks: 6`, the section already has 6
blocks, and an `add_block` operation targets it → hard block, "this section already has the maximum number of
testimonials (6) allowed."

This is also the layer behind ordinary inline field-level validation in the Visual Editor (a color picker
refusing an invalid hex value, a range slider clamped to its bounds) — the same contract, enforced both
preventively in the UI and authoritatively here.

### 3.4 Assets validation

**Question:** do assets referenced by the configuration — images, primarily — actually exist and resolve?

**Runs:** alongside Settings validation, for any image/asset-reference setting touched by an operation or save;
and again as a live re-check immediately before publish (an asset that resolved when a draft was built can stop
resolving later — a scraped image URL going stale, an uploaded asset deleted from the store's asset library).

**Checks:**
- Every image/asset-reference value resolves to a real entry — an asset ingested during Product Import or one
  the merchant uploaded directly, per [Assets](13-assets.md) — not a broken link or dangling internal id.
- The resolved asset's file type is one the section's contract and the Preview Renderer/Shopify actually
  support for that setting.
- The resolved asset is retrievable at validation time — a live fetch/HEAD check, not just presence of a
  reference string.

**Hard block:** the reference doesn't resolve — a 404, a deleted asset id, or a non-transient fetch failure. A
broken image reference fails the same "would this actually work" bar as every other hard block in this
pipeline.

**Warning:** the asset resolves but with a soft concern — file size approaching Shopify's per-asset limit
(a hard block at layer 7 if actually exceeded, worth flagging early), or an aspect ratio poorly suited to the
section's image slot.

**Example — fail:** a "Hero" section's `settings.background_image` is a URL scraped from the merchant's
previous storefront during Product Import, and it now 404s → hard block, "this image can no longer be found —
please choose another."

**Final asset storage provider:** **TBD** — not finalized; see [Assets](13-assets.md).

### 3.5 Product references validation

**Question:** where a section or setting is bound to specific Product data — a section pinned to an imported
product, a block pulling a product's title/price/variant/description — does that reference point at real,
current [Product](05-product-import.md) data?

**Runs:** alongside Settings/Assets validation, on any operation touching a product-bound setting; and again
pre-publish, since Product data can be re-imported after a section was originally configured against it.

**Checks:**
- A referenced product id exists in the project's currently-imported Product data set.
- A referenced field on that product (a specific variant, an image index, an option value, a price) actually
  exists on the current Product record — not stale from a previous import.
- Where a setting expects a particular cardinality (e.g. a "Product Grid" section expecting a list of product
  ids, not one), the reference matches what the section's contract declares.

**Hard block:** a referenced product id that doesn't exist in current Product data, or a referenced field that
doesn't exist on the current record — both describe a reference the Preview Renderer has nothing to render.

**Warning:** the reference resolves, but the underlying Product data looks incomplete for what the section
wants to show (a product with no description feeding a section built to display one).

**Example — fail:** a "Featured Product" section references `productId: "prod_881"`, but that product was
removed during a re-import → hard block, "this product is no longer available — please choose another."

### 3.6 Preview validation (Liquid rendering errors)

**Question:** can the LiquidJS Preview Renderer actually render this Store Configuration, end to end, without
throwing?

This layer catches what the structural checks above cannot: a value can be individually well-typed, in range,
and contract-valid, and still interact badly with a specific section template's logic in a way only an actual
render reveals — e.g. a numeric setting at the edge of its declared range that the template's Liquid math
doesn't handle as gracefully as the middle of the range.

**Runs:** continuously during editing — it is the same LiquidJS render that already drives the same-origin
preview iframe, debounced rather than on every keystroke (see [Preview Architecture](06-preview-architecture.md)) —
and once more as a dedicated, exhaustive pass across every page and section immediately before publish, since an
earlier per-edit render might only have covered the section being edited at the time.

**Checks:**
- The LiquidJS render completes without throwing — no runtime error (undefined filter/method applied to an
  unexpected type, template logic hitting an unguarded case for a given settings combination).
- The render produces non-empty output for every section not deliberately hidden/disabled.
- No renderer-reported error markers in the output.

**Hard block:** a render throw, a blank result where content was expected, or a renderer-reported error on any
section. This is the most concrete guarantee in the pipeline that what the merchant is looking at in preview is
what will actually work — a configuration that passes every structural check but fails to render is not
usable.

**Warning:** the render succeeds but the renderer surfaces a non-fatal notice (e.g. a nil value rendering as
empty text rather than the section's intended fallback copy).

**Example — fail:** a section's contract allows `settings.column_count` down to `1`, but its Liquid template
has an unguarded division assuming at least 2 columns for a width calculation, and `1` triggers a divide-by-zero
at render time → hard block, "this configuration fails to render — please try a different value." A recurring
failure at this layer on one section type is also logged as a signal that the section's settings contract needs
tightening, distinct from the immediate per-operation failure.

**Live-editing render placement:** **TBD** — a per-section server-rendered fragment is settled for share-link
and thumbnail rendering only; whether the live-editing preview render (the one that doubles as this validation
layer) executes client-side or server-side is not yet decided. See [Preview Architecture](06-preview-architecture.md).

### 3.7 Shopify validation (pre-write publish errors)

**Question:** independent of everything checked so far, will Shopify's Admin API actually accept the resulting
theme configuration and `settings_data` when the write is attempted?

**Runs:** at publish time only, immediately before the Admin API write — the last check before anything is
committed to the live store.

**Checks:**
- `settings_data.json` and per-template settings payload sizes are within Shopify's platform limits.
- Total section/block counts per page are within limits the shop's plan/theme enforce.
- Every section/block reference in the outgoing write resolves to a real file already deployed in the Base
  Theme's Section Library on the store (from onboarding/installation).
- No reserved file/name collisions in what's being written.
- The connected `ShopifyInstallation`'s OAuth scopes actually permit writing theme settings.

**Hard block:** Shopify would reject the write outright — a size-limit violation, a missing/mismatched theme
file reference, a permission/scope denial.

**Warning:** Shopify would accept the write but flags a soft concern — approaching (not exceeding) a size or
count limit, or a settings field Shopify still accepts but has marked deprecated.

**Example — fail:** the connected installation's access token lost theme-write scope since the draft was built
→ hard block, "we've lost permission to update your theme — please reconnect your store," routed to a
reconnect flow, not to AI regeneration, since no content correction fixes a permissions problem.

### 3.8 Publish validation (post-write publish errors)

**Question:** did the publish operation actually complete successfully, end to end?

**Runs:** immediately after the Admin API write attempt(s) complete — a post-write verification pass, not a
pre-write gate like layer 7.

**Checks:**
- Every Admin API call issued for this publish returned success.
- A read-back of what was just written matches what was intended — catching a write that appears to succeed
  but silently drops or alters something.
- A lightweight post-publish check against the live storefront (fetching the published page, checking for
  expected content markers) confirms the change is actually visible, not stuck behind caching/propagation
  delay.
- A `PublishRecord` is created, marking the corresponding `ConfigurationVersion` as `published`.

**Hard block:** any write call failed, the read-back doesn't match what was sent, or the storefront check fails
outright. The live store is left in its last-known-good state — a failed publish must never leave the
storefront half-written — and the merchant is told clearly what happened, with a retry action.

**Warning:** publish succeeded and verified, but a non-critical signal is worth surfacing (e.g. a detected CDN
propagation delay — write and read-back both succeeded, but the storefront check needed a couple of retries).

**Example — fail:** the Admin API write for the Product page's `settings_data` succeeds, but the write for the
Home page's template times out partway through → hard block on the overall publish; the merchant sees "publish
didn't fully complete — retrying," or an explicit failure with a retry button, never a silent partial-live
state.

## 4. Retries, clarification, and rollback

A hard block is never handled by silently regenerating and retrying without limit — unbounded regeneration
burns AI generation cost with no guaranteed convergence, and repeated silent failure is worse for trust than
surfacing the failure once, clearly.

```
Hard block at layers 3-6 (Settings, Assets, Product references, Preview
— layers describing an actual content problem an AI can meaningfully act on):
  1. The failing operation, and its whole enclosing operation plan, is rolled back —
     nothing partial is ever left applied to the Store Configuration.
  2. ValidationSummary detail (which layer, which field/path, the offending value, the
     allowed alternative where known) is attached to the operation and made available to
     AI generation / clarification logic — not just logged for developers.
  3. AI gets ONE automatic re-generation attempt for the failed step, informed by the
     specific validation detail (e.g. "heading_size must be between 12 and 48, you
     proposed 60" fed back as context, not a bare "try again").
  4. If the retry also fails validation, auto-retry stops. The system surfaces a
     Clarification to the merchant: what was attempted, why it failed in plain language,
     and options (rephrase, pick a specific alternative if one exists, or cancel). This
     is a hard cap, not a soft suggestion.
  5. The retry budget (one automatic attempt) is tracked per failed step, so a multi-step
     plan with two content-generation steps gets one retry budget EACH, not one shared
     across the whole plan.

Hard block at layers 1-2 (Configuration, Section
— layers that only ever fail due to a system bug, never a content judgment call):
  These never enter the regeneration flow. A malformed configuration, or a reference to a
  section type that doesn't exist in the catalog the AI was given, is not something a
  second AI attempt with the same faulty premise is likely to fix. Routed straight to
  internal logging/alerting; the merchant sees a generic "something went wrong building
  that update, please try again."

Hard block at layers 7-8 (Shopify, Publish — operational, publish-time only):
  These never consume AI regeneration budget. They are operational/infrastructure
  failures surfaced directly in the Publish UI with a direct recovery action (retry,
  reconnect, trim content if the failure was genuinely size-driven — the one
  content-correctable exception at layer 7).

Warnings (any layer):
  Never block a mutation and never trigger regeneration. Attached to the ValidationSummary
  and surfaced in plan-review UI / history for the user's awareness; the operation
  proceeds.
```

**Rollback semantics:** at every layer, a hard block rolls back the entire enclosing mutation — never a partial
apply. For publish specifically, a hard block at layer 8 leaves the live storefront in its last recorded
published state; recovery is either a retry of the failed write(s) or a full re-publish, never a half-applied
live store. Rolling back to an earlier configuration entirely (not just aborting a failed write) is a restore
operation — see [Versioning and Undo/Redo](18-versioning-and-undo-redo.md).

## 5. User-visible errors

| Layer | What the user sees |
|---|---|
| 1. Configuration | AI-caused: generic "couldn't build a valid update for that request, please try rephrasing." Editor-caused: "couldn't save that change," save blocked. |
| 2. Section | Generic "something went wrong building that update, please try again" (never a raw catalog error). |
| 3. Settings | Specific, field-level message (e.g. "heading_size must be between 12 and 48") in plan-review UI or inline field validation. |
| 4. Assets | "This image can no longer be found — please choose another," with a replacement option where available. |
| 5. Product references | "This product is no longer available — please choose another." |
| 6. Preview | "This configuration fails to render — please try a different value." |
| 7. Shopify | Direct recovery action in Publish UI: reconnect, wait/retry, trim content, or contact support — never a raw API error. |
| 8. Publish | "Publish didn't fully complete — retrying," or an explicit failure with a retry button; never a silent partial-live state. |

Warnings never interrupt the user's flow — they appear inline in plan-review UI and in operation/version
history, alongside the change they describe, and never block the change from applying.

## 6. Logging and the audit trail

- Every layer's outcome is recorded as a `ValidationSummary`, attached to the operation that produced it and
  carried forward into the resulting `Diff`.
- Layers 1–2 (Configuration, Section) hard blocks are logged at elevated internal severity — they indicate a
  system bug (a stale client catalog, a serialization bug), not a user mistake, and are routed to internal
  alerting rather than only being recorded on the operation.
- A recurring Layer 6 (Preview) failure on a specific section type is logged distinctly for internal review — a
  signal that the section's settings contract needs tightening, not just that one configuration needs
  correcting.
- Layers 7–8 (Shopify, Publish) outcomes are always written to `AuditLog` regardless of outcome — "did this
  publish actually succeed" is a fact the product's safety guarantees depend on being able to answer
  definitively later.
- All warnings, at every layer, are persisted alongside their operation and surfaced to the user at plan-review
  time and in operation/version history — they are never silently dropped once observed, even though they never
  block.

## 7. Summary table

| Layer | Checks | Runs at | Typical hard block | Typical warning |
|---|---|---|---|---|
| 1. Configuration | Store Configuration is well-formed per its schema | Every AI op / editor save / pre-publish | Missing required field, wrong type, duplicate id | none |
| 2. Section | `type` exists in the Section Library | Every AI op / editor save / pre-publish | Unknown/nonexistent section type | Deprecated but still-supported type |
| 3. Settings | Settings match the section's/block's contract | Every AI op / editor save / pre-publish | Wrong type, missing required field, out-of-range/enum value, exceeds `maxBlocks` | Deprecated-but-accepted field value |
| 4. Assets | Referenced images/assets exist and resolve | Alongside settings validation / pre-publish | Broken/dead asset reference | Approaching size limit, poor aspect ratio |
| 5. Product references | Product references point at real, current Product data | Alongside settings validation / pre-publish | Nonexistent product id, stale field reference | Incomplete underlying product data |
| 6. Preview | LiquidJS Preview Renderer renders without error | Continuously during editing / final pre-publish pass | Render throw, blank output, renderer error | Non-fatal render notice |
| 7. Shopify | Admin API / platform limits will accept the write | Publish time, pre-write | Size/count limit exceeded, permission/scope denial | Approaching soft limit, deprecated field |
| 8. Publish | The publish write actually completed end to end | Publish time, post-write | Write failure, read-back mismatch, storefront check failure | Detected propagation delay |

All hard blocks at layers 1–6 route through the bounded, one-automatic-retry AI feedback loop (§4) before
reaching the merchant as a Clarification. Layers 7–8 are operational and surface directly in the Publish UI
with a direct recovery action. All warnings, at every layer, are non-blocking and surfaced to the user for
awareness.

## 8. Open questions / TBD

- **Section Library versioning scheme** — whether/how section versions are tracked so Layer 2 can detect a
  draft referencing a section version the current Base Theme no longer ships. See
  [Base Theme and Section Library](02-base-theme-and-section-library.md).
- **Final asset storage provider** — affects exactly how Layer 4's resolution/fetch check is implemented. See
  [Assets](13-assets.md).
- **Live-editing preview render placement** (client-side vs. server-side execution) — affects where Layer 6
  actually executes during an active editing session; share-link/thumbnail rendering is settled as a
  server-rendered fragment. See [Preview Architecture](06-preview-architecture.md).
