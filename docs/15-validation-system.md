# 15. Validation System

Status: proposed design
Depends on: doc 07 (Section Library), doc 08 (Store Configuration Schema), doc 09 (Preview Rendering), doc 11 (AI Generation & Editing Operation System), doc 14 (Diff & Versioning), doc 16 (Shopify Integration/Publishing)
Owned by: this doc is the canonical source of truth for the validation pipeline the Store Configuration passes through, from first AI generation to a live Shopify store.

---

## 1. Purpose and position in the pipeline

**A note on scope, up front:** the Liquid templates in our Section Library (doc 07) are controlled source code, written once by us when a section is added to the library, and maintained like any other application code — they go through normal code review, not this pipeline. This document is not about validating Liquid. It is about validating **data**: the Store Configuration (doc 08), the JSON document that says which of our fixed sections appear on a page, in what order, and with what settings and content. Every check below exists because the Store Configuration is produced and edited by parties — an AI model, a merchant clicking around a settings panel — that can get the *data* wrong in ways a fixed, reviewed Liquid template has every right to assume never happens. This is a meaningfully smaller job than validating arbitrary generated code, and the pipeline below is smaller as a direct result.

The Store Configuration is touched at several distinct points in the product flow (see doc 01/04 for the full flow): AI Generation produces it from Product Data (doc 11); the Visual Editor lets a merchant hand-edit it; the Preview Renderer (doc 09) turns it into a live same-origin iframe preview as the merchant works; and Publish (doc 16) writes it, together with our Base Theme and Section Library, onto the merchant's real Shopify store. This pipeline is not one linear gate the configuration passes through once — it's eight checks, each with its own natural trigger point, some of which run continuously during editing and some of which run only once, right before publish:

```
   AI Operation emitted  ─┐
   Editor field edited   ─┼─▶ 1. Configuration validation  (structural JSON shape)
   Restore applied        ┘        │
                                    ▼
                           2. Section validation      (type exists in Section Library)
                                    │
                                    ▼
                           3. Settings validation      (settings match section's contract)
                                    │
                          ┌─────────┼─────────┐
                          ▼                   ▼
                4. Assets validation   5. Product references validation
                          │                   │
                          └─────────┬─────────┘
                                    ▼
                           6. Preview validation       (LiquidJS renders without error)
                                    │
                          ── continuous during editing ──
                                    │
                                    ▼  (only at Publish)
                           7. Shopify validation        (Admin API will accept the write)
                                    │
                                    ▼
                           8. Publish validation         (the write actually completed)
```

Layers 1–3 are the cheap, fast, structural gate — they run on every single AI Operation before it's allowed to merge into the draft (doc 14), and on every Visual Editor save, because both write through the same mutation path (doc 14 §2.3). Layers 4–5 run alongside layers 1–3 for any operation touching an asset- or product-bound setting. Layer 6 runs continuously as the merchant edits (it's the same render the same-origin iframe preview already needs, doc 09), and again as a final full-page pass immediately before publish. Layers 7–8 are publish-time only — they have no meaning before there's an actual attempt to write to Shopify.

Every layer's result is recorded into a `ValidationSummary` and persisted on the `Operation` record (doc 14 §4: `validationResult` field) — validation outcomes are themselves part of the permanent audit trail, not a transient check discarded once it passes.

---

## 2. Hard block vs. warning — the general rule

Two outcome classes recur at every layer:

- **Hard block**: the change cannot be applied (or, at publish time, publish cannot proceed). Per doc 14 §8, the whole Operation Plan transaction is rolled back — no partial application. The user never sees a broken configuration as a result. For AI-caused failures, the failure is routed back into the AI Clarification/Operation-Plan flow (doc 11/13), never silently retried without limit (§11).
- **Warning**: the change *can* be applied, but the system flags something the user should know — shown inline in the plan-review UI before execution, and/or attached to the `Operation`/`Diff` history entry (doc 14) afterward for anything that can only be checked post-apply.

The general dividing line used throughout this doc: **if applying the change would leave the Store Configuration referencing something that doesn't exist, would fail to render, or would be rejected outright by Shopify, it's a hard block. If it's a quality/appearance concern a human is better positioned to judge than an automated check, it's a warning.**

---

## 3. Configuration validation

**Question:** is the Store Configuration itself structurally valid — well-formed JSON, matching the shape doc 08 defines, with required fields present and correctly typed?

**When it runs:** first, before anything else — on every AI Operation before it's allowed to merge into the draft, on every Visual Editor save, and as the very first gate immediately before Publish (a final sanity re-check, since this is the cheapest possible check to repeat).

**Checks:**
- The document parses as JSON (or, where it never leaves memory as a parsed object, that the in-memory object matches the expected shape) — this catches nothing in a well-behaved system, but is the first line of defense against a serialization bug anywhere upstream.
- The top-level `pages` key exists and is an object keyed by page identifier (`home`, `product`, etc., per doc 08).
- Each page value has a `sections` key that is an array.
- Every entry in a `sections` array has the required fields: `id` (string, unique within that page's `sections` array), `type` (string), `settings` (object — may be empty, but must be present and must be an object, not an array or scalar).
- If present, `blocks` on a section entry is an array; every block entry has `id` (string, unique within that section's `blocks` array) and `type` (string), and a `settings` object.
- No duplicate `id` within a `sections` array, and no duplicate `id` within any one section's `blocks` array (uniqueness is only required within the immediate parent array — the same `id` string reused across two different pages, or on a section vs. an unrelated block, is not a conflict, since doc 14's paths are always rooted at the full path, not a bare `id` lookup).
- No unrecognized top-level keys outside what doc 08 defines (guards against a stray field leaking through from an AI generation bug or a client-side editor bug).

**Hard block:** any structural violation above — a document that fails this layer isn't a valid Store Configuration at all, so there is no partial or "mostly fine" outcome. This should be rare in practice; when it happens on the AI Generation side, it indicates a bug in the Operation system (doc 11), not a user-caused problem, and is logged at a higher internal severity in addition to being blocked. When it happens on the editor side, it indicates a client-side bug, similarly logged.

**Warning:** none at this layer — a malformed document has no partially-safe interpretation.

**What failure looks like to the user:** for an AI-caused failure, this never reaches the user as a raw structural error — it's caught before the plan is ever presented, and surfaces (if it must surface at all) as a generic "couldn't build a valid update for that request, please try rephrasing," per the same reasoning as an internal planner bug. For an editor-caused failure (which should be prevented by the editor's own UI constraints in the first place — the settings panel shouldn't let a merchant type structurally invalid JSON), it surfaces as "couldn't save that change" with the save blocked, protecting the draft from ever entering an invalid state.

**Feedback loop:** attached to the `Operation`'s `validationResult` and routed into the bounded-regeneration mechanism described in §11.

---

## 4. Section validation

**Question:** does every `type` referenced by a section entry actually exist in our fixed Section Library (doc 07)?

**When it runs:** immediately after Configuration validation passes, on the same triggers (AI Operation emission, editor save), and again as part of the pre-publish pass — the Section Library is fixed, but re-verification at publish time is cheap and guards against the (rare, operational) case of a section being deprecated/removed from the library between when a draft was built and when it's finally published.

**Checks:**
- Every `sections[].type` value matches a `type` that exists in the doc 07 catalog.
- The referenced section is not marked deprecated/removed in a way that blocks new use (a deprecated-but-still-rendering section is a warning case, not a hard block — see below).
- If the Section Library is versioned (doc 07's concern to define precisely), the referenced section version is one the current Base Theme and Preview Renderer actually ship.

**Hard block:** an unknown or nonexistent `type` — this can only ever come from a bug (the AI Operation system is only ever supposed to offer section types that genuinely exist in the catalog it was given, per doc 11; the editor's section picker only ever lists real catalog entries), so like Configuration validation, this is treated as a planner/client bug, not a user mistake, and is logged accordingly.

**Warning:** a `type` that exists but is marked deprecated in the Section Library (still renders correctly today, but the merchant or AI should be nudged toward a supported replacement before it's eventually retired).

**Example — fail:** an `Operation` proposes adding a section with `type: "hero-banner-v1"`, but the Section Library only has `"hero-banner"` (the older id was retired in a previous library update and the Operation system's local cache of available types was stale) → hard block, "section type no longer available," logged as a cache-staleness bug for the AI Generation system to investigate.

**Example — pass:** an `Operation` adds `type: "featured-collection"`, which exists in the current Section Library → proceeds.

**Feedback loop:** for AI-caused failures, this is one of the two layers (with Configuration validation) treated as a system bug rather than a content problem — see §11 for why that changes how it's handled downstream.

---

## 5. Settings validation

**Question:** for every section (and block) in the configuration, are the settings provided valid against that section's settings contract — the settings schema declared in the Section Library (doc 07) and formalized in the Store Configuration Schema (doc 08)?

This is the layer exercised most often by far: almost every AI Generation operation and almost every Visual Editor field edit ultimately changes a value under some section's or block's `settings`, so this layer runs on essentially every mutation in the system.

**When it runs:** immediately after Section validation, on the same triggers (AI Operation emission, editor save), and once more, in aggregate across every section on every page, as part of the pre-publish pass.

**Checks:**
- Every key present in a section's (or block's) `settings` object corresponds to a setting declared in that section type's (or block type's) settings contract — no writing values for settings the section doesn't declare.
- Every setting declared as **required** by the contract is present with a non-empty value.
- Every setting's value matches its **declared type** — string, richtext, number, boolean, color, image/asset reference, URL, select/enum, range, or a nested object/array shape for compound settings, per doc 08's typing.
- **Enum/option-constrained** settings receive a value from the contract's allowed option set — nothing outside the declared list.
- **Range-constrained** settings (min/max/step) receive an in-range, step-aligned value.
- Where the Section Library defines a **shared settings contract** across sections (doc 07's concept of common fields — e.g. spacing/padding tokens, a shared color-role setting, a shared "layout variant" enum reused by several section types) — those shared fields are validated once, consistently, against the shared contract rather than being re-specified and potentially drifting per section.
- Block count for a section stays within any `maxBlocks` the section's contract declares.
- No duplicate block `id`s beyond what's already caught in Configuration validation, but specifically re-checked here in the context of block-count and block-type limits.

**Hard block:** wrong type for a setting's declared type; a required setting missing; a value outside an enum's allowed set; a value outside a range's min/max or misaligned to its step; a block count exceeding `maxBlocks`; a `blocks[].type` that isn't declared as a valid block type for that section. All of these describe a Store Configuration that the section's Liquid template (doc 07) was never written to handle — the template code is allowed to assume its settings contract holds, and this layer is what makes that assumption safe.

**Warning:** a setting present with a technically valid but unusual value the contract still permits (e.g. a value the section's contract marks deprecated-but-still-accepted, kept for backward compatibility with older configurations) — informational, doesn't block.

**Example — fail:** a section's contract declares `{ id: "heading_size", type: "range", min: 12, max: 48, step: 2 }` and an AI Operation proposes `value: 60` → hard block, "heading_size must be between 12 and 48."

**Example — pass:** the same contract, proposed `value: 28` → valid, in range, step-aligned, proceeds.

**Example — fail:** a "Testimonials" section's contract declares `maxBlocks: 6`, the section currently has 6 blocks, and an `add_block` Operation targets it → hard block, "this section already has the maximum number of testimonials (6) allowed."

**Feedback loop:** this is the layer where the bounded-regeneration mechanism (§11) does the most work — a settings-validation failure almost always describes exactly what's wrong (which field, what was wrong with it, what's allowed instead), which is fed back verbatim to the AI as correction context for its one automatic retry. In the Visual Editor, this is also the layer behind ordinary inline field-level validation (e.g. a color picker refusing to save an invalid hex value, a range slider clamped to its bounds) — the same contract, enforced both preventively in the UI and authoritatively here.

---

## 6. Assets validation

**Question:** do assets referenced by the configuration — images, primarily — actually exist and resolve?

**When it runs:** alongside Settings validation, for any setting typed as an image/asset reference, on every AI Operation and editor save that touches one; and again as a live re-check immediately before Publish, since an asset that resolved when a draft was built can stop resolving later (a scraped image URL from the merchant's prior site going stale, an uploaded asset being deleted from the store's asset library).

**Checks:**
- Every image/asset-reference setting value resolves to a real entry — either an asset pulled in during Product Import/Scraper (doc 11's ingestion path) or one the merchant uploaded directly — not a broken link or a dangling internal id.
- The resolved asset's file type is one the section's contract and the Preview Renderer/Shopify actually support for that setting (e.g. an image slot doesn't silently accept a PDF).
- The resolved asset is retrievable at validation time (a live fetch/HEAD check, not just presence of a reference string) — this is what catches a URL that was valid when scraped but has since gone offline.

**Hard block:** the reference doesn't resolve at all — a 404, a deleted asset id, or a fetch failure that isn't transient. A section with a broken image reference is a section that will render with a visibly broken image, which fails the same "would this actually work" bar as every other hard block in this pipeline.

**Warning:** the asset resolves, but with a soft concern — file size approaching Shopify's per-asset limit (a hard block at layer 7 if actually over, but worth flagging early as a warning here so the merchant or AI has a chance to swap it before publish forces the issue), or an aspect ratio poorly suited to the section's image slot (a quality judgment, not a functional failure).

**Example — fail:** a "Hero" section's `settings.background_image` is set to a URL scraped from the merchant's previous storefront during Product Import, and that URL now 404s → hard block, "this image can no longer be found — please choose another."

**Example — pass:** `settings.background_image` resolves to an image the Product Import pipeline successfully mirrored into our own asset store → proceeds.

**Feedback loop:** for AI-caused failures (most commonly, an image chosen during initial generation that later goes stale before the merchant gets to it), this routes to the AI proposing a replacement — either another image already available in the store's Product Data/asset set, or a Clarification asking the merchant to upload one, per §11.

---

## 7. Product references validation

**Question:** where a section or setting is bound to specific product data (a section pinned to a particular imported product, a block pulling a product's title/price/variant/description), does that reference actually point at real, current Product Data (doc 11's Product Import/Scraper output)?

**When it runs:** alongside Settings/Assets validation, on any AI Operation or editor save touching a product-bound setting; and again pre-publish, since Product Data can be re-imported or refreshed after a section was originally configured against it, potentially invalidating references that were valid at generation time.

**Checks:**
- A referenced product id exists in the store's currently-imported Product Data set — it wasn't removed or never actually imported.
- A referenced field on that product (a specific variant, an image index, an option value, a price) actually exists on the current Product Data for that product — not stale from a previous import.
- Where a setting expects product data of a particular shape (e.g. a "Product Grid" section expecting a list of product ids, not a single id), the reference's cardinality matches what the section's contract declares.

**Hard block:** a referenced product id that doesn't exist in the store's Product Data at all, or a referenced field that doesn't exist on the current product record — both describe a reference the Preview Renderer has nothing to render.

**Warning:** the reference resolves, but the underlying Product Data looks incomplete for what the section wants to show (e.g. a product with no description, feeding a section built to display one, which will fall back to a shorter placeholder) — a content-quality concern, not a functional failure.

**Example — fail:** a "Featured Product" section references `productId: "prod_881"`, but that product was removed during a re-import (the merchant re-scraped their catalog and that product no longer exists in the current Product Data) → hard block, "this product is no longer available — please choose another."

**Example — pass:** the same section references a product id present in the current Product Data, with all fields the section needs populated → proceeds.

**Feedback loop:** routes to the AI proposing a different product reference from the current Product Data set, or a Clarification asking the merchant which product should fill that slot, per §11.

---

## 8. Preview validation

**Question:** can the LiquidJS Preview Renderer (doc 09) actually render this Store Configuration, end to end, without throwing?

This is the layer that catches what the structural checks above cannot: a settings value can be individually well-typed, in range, and contract-valid (layer 3) and still interact badly with a specific section template's logic in a way only an actual render reveals — e.g. a numeric setting at the very edge of its declared range that a template's Liquid math doesn't handle as gracefully as the middle of the range.

**When it runs:** this layer is inherently render-triggered. In practice it runs continuously during editing — it's the same LiquidJS render that already powers the same-origin iframe preview (doc 09), so every time the Visual Editor re-renders the preview after an edit (debounced, not on every keystroke), that render doubles as this validation layer. It also runs as a dedicated, exhaustive pass immediately before Publish — every page in the configuration, every section, rendered once, as a final gate no earlier per-edit render could fully guarantee (an earlier render might only have covered the one section being edited at the time).

**Checks:**
- The LiquidJS render completes without throwing — no Liquid runtime error (undefined filter/method applied to an unexpected type, a template's internal logic hitting a case its author didn't guard for given this specific settings combination).
- The render produces non-empty output for every section that isn't deliberately configured as hidden/disabled.
- No renderer-reported error markers in the output.

**Hard block:** a render throw, a blank result where content was expected, or a renderer-reported error on any section. This is the most concrete guarantee in the whole pipeline that "what the merchant is looking at in preview is what will actually work" — a configuration that passes every structural check but fails to render is not, in any practical sense, a usable configuration.

**Warning:** the render succeeds but the renderer surfaces a non-fatal notice (e.g. a value coerced in a way that's visually slightly off but not broken — a nil value rendering as empty text rather than the section's intended fallback copy).

**Example — fail:** a section's contract allows `settings.column_count` down to `1`, but the section's Liquid template has an unguarded division assuming at least 2 columns for a width calculation, and a value of `1` triggers a divide-by-zero at render time → hard block, "this configuration fails to render — please try a different value," and the specific render error is captured for the feedback loop below (and, separately, filed against the Section Library as a template bug, since a valid, in-contract setting value should never be able to break the template it belongs to — see the note in §11).

**Example — pass:** the Home page renders cleanly with the new Hero background color and the reordered Testimonials section, all sections present with expected markup → proceeds; this is also the render the merchant actually sees update live in the iframe.

**Feedback loop:** for an AI-caused failure, the specific render error (which section, and where possible which setting) feeds back to the AI's one bounded regeneration attempt, per §11. Because this layer usually indicates either a settings-validation gap (a value that should have been caught at layer 3 but wasn't) or a genuine edge case in a section template, a preview-validation failure is also logged distinctly for our own review — a recurring failure at this layer on a specific section type is a signal that the section's settings contract (doc 07/08) needs tightening, not just that this one configuration needs correcting.

---

## 9. Shopify validation

**Question:** independent of everything checked so far, will Shopify's Admin API actually accept the resulting theme configuration and `settings_data` when we attempt to write it (doc 16)?

**When it runs:** at publish time only, immediately before the actual Admin API write — the last check before doc 16 commits anything to the live store.

**Checks:**
- `settings_data.json` and per-template settings payload sizes are within Shopify's platform limits.
- Total section/block counts per page are within whatever limits Shopify enforces for the shop's plan and theme.
- Every section/block reference in the outgoing write resolves to a real file in our Base Theme's Section Library deployment on Shopify — i.e. that the theme files doc 16 expects to already be present on the store (from onboarding/installation) are, in fact, present and haven't drifted.
- No reserved file/name collisions in what's being written.
- The connected Shopify installation's OAuth scopes actually permit writing theme settings (a permission/connection-health check, not a content check).

**Hard block:** Shopify would reject the write outright — a size-limit violation, a missing/mismatched theme file reference, a permission/scope denial.

**Warning:** Shopify would accept the write but flags a soft concern — approaching (not exceeding) a size or count limit, or use of a settings field Shopify still accepts but has marked for future deprecation.

**Example — fail:** the connected Shopify installation's access token has had its theme-write scope revoked (the merchant uninstalled and reinstalled the app in a way that changed granted permissions) since the draft was built → hard block, "we've lost permission to update your theme — please reconnect your store," which routes to a reconnect flow (doc 16), not to AI regeneration, since no amount of content correction fixes a permissions problem.

**Example — pass:** the outgoing `settings_data` write is well within size limits and every referenced section resolves to a real deployed theme file → proceeds to the actual write.

**Feedback loop:** most Shopify-validation failures are operational (permissions, platform limits) rather than content problems, so they generally do **not** consume the AI's bounded-regeneration budget (§11) — they surface directly in the Publish UI with an appropriate recovery action (reconnect, wait/retry, contact support). The one content-driven exception is a size/count limit actually being exceeded by the configuration itself (e.g. an unusually large number of blocks across many sections) — that case can still route to a Clarification suggesting the merchant trim content, since it is something content-level correction can fix.

---

## 10. Publish validation

**Question:** did the publish operation (doc 16) actually complete successfully, end to end?

**When it runs:** immediately after the Admin API write attempt(s) in doc 16 complete — this is a post-write verification pass, not a pre-write gate like layer 7.

**Checks:**
- Every Admin API call doc 16 issued for this publish returned success.
- A read-back of what was just written matches what was intended — the theme settings Shopify now reports match the Store Configuration that was just published, catching the case where a write appears to succeed but silently drops or alters something.
- A lightweight post-publish check against the live storefront itself (a fetch of the published page checking for expected content markers) confirms the change is actually visible, not just accepted by the API and stuck behind a caching/propagation delay long enough to matter.
- A publish history record (doc 14 §5.4, doc 16) is created, marking the corresponding Configuration Version as `published`.

**Hard block:** any write call failed, the read-back doesn't match what was sent, or the storefront check fails outright. Per doc 16's publish design, the live store is left in its last-known-good state — a failed publish must never leave the storefront in a half-written, inconsistent state — and the merchant is told clearly what happened, with a retry action.

**Warning:** the publish succeeded and verified, but a non-critical post-publish signal is worth surfacing (e.g. a detected CDN propagation delay — the write and read-back both succeeded, but the storefront check needed a couple of retries before content appeared, suggesting the merchant might see brief staleness).

**Example — fail:** the Admin API write for the Product page's `settings_data` returns success, but the API write for the Home page's template times out partway through → hard block on the overall publish; doc 16's atomicity handling determines the recovery (retry the failed piece, or roll the whole publish back), and the merchant sees "publish didn't fully complete — retrying" or an explicit failure with a retry button, never a silent partial-live state.

**Example — pass:** all writes succeed, the read-back matches, and the live storefront check confirms the new Hero content is visible → the Configuration Version is marked `published`, publish history is recorded, done.

**Feedback loop:** publish-validation failures are operational, not content problems, so — like Shopify validation — they are handled by direct retry/user action in the Publish UI rather than routed through AI Clarification or counted against any AI regeneration budget. They are always logged to the audit trail (doc 14) regardless of outcome, since "did this publish actually succeed" is exactly the kind of fact the product's safety promise depends on being able to answer definitively later.

---

## 11. Failure feedback into the Clarification / AI Generation flow

A validation hard block is never handled by silently regenerating and retrying without limit — unbounded regeneration burns AI generation cost with no guaranteed convergence, and repeatedly failing silently is worse for trust than surfacing the failure once, clearly.

```
On hard block at layers 3-6 (Settings, Assets, Product references, Preview — the layers that
describe an actual content problem an AI can meaningfully act on):
  1. The failing Operation (and, per doc 14 §8, its whole Operation Plan transaction) is rolled
     back — nothing partial is ever left applied to the Store Configuration.
  2. ValidationSummary detail (which layer, which specific field/path, the offending value, the
     allowed alternative where known) is attached to the Operation Plan record and made available
     to the AI Generation / Clarification logic (doc 11/13), not just logged for developers.
  3. The AI is allowed ONE automatic re-generation attempt for the failed step, informed by the
     specific validation failure detail (e.g. "heading_size must be between 12 and 48, you proposed
     60" fed back as context, not a bare "try again").
  4. If the re-generation attempt ALSO fails validation, auto-retry stops. The system surfaces a
     Clarification to the merchant: what was attempted, why it failed in plain language, and options
     (rephrase the request, pick a specific alternative if one exists — e.g. choose a different
     product/image — or cancel). This is a hard cap, not a soft suggestion.
  5. This retry budget (one automatic attempt) is tracked per failed step on the Operation Plan
     record, so a multi-step plan with two content-generation steps gets one retry budget EACH, not
     one shared across the whole plan.

On hard block at layers 1-2 (Configuration, Section — the layers that only ever fail due to a
system bug, never a content judgment call):
  These do not go through the regeneration flow at all. A malformed configuration or a reference to
  a section type that doesn't exist in the catalog the AI was given is, by construction, not
  something a second AI attempt with the same faulty premise is likely to fix — it's routed straight
  to internal logging/alerting, and the merchant sees a generic "something went wrong building that
  update, please try again" rather than a content-correction Clarification.

On hard block at layers 7-8 (Shopify, Publish — operational, publish-time only):
  These never consume AI regeneration budget (§9, §10) — they are operational/infrastructure
  failures surfaced directly in the Publish UI with a direct recovery action (retry, reconnect,
  trim content if the failure was genuinely size-driven).

Warnings (any layer) never block a transaction and never trigger regeneration — they are attached
to the ValidationSummary and surfaced in the plan-review UI / history entry for the user's
awareness, and the operation proceeds.
```

This — one bounded automatic retry for content-level failures, no retry loop at all for system-bug-only layers, immediate user Clarification once the content-retry budget is spent, and a hard separation between content failures and operational publish failures — is the concrete mechanism that prevents validation failures from ever turning into silent, unbounded AI spend or a merchant staring at a stuck, unexplained state.

---

## 12. Summary table

| Layer | Checks | Runs at | Typical hard block | Typical warning |
|---|---|---|---|---|
| 1. Configuration | Store Configuration is well-formed per doc 08 | Every AI op / editor save / pre-publish | Missing required field, wrong type, duplicate id | none |
| 2. Section | `type` exists in the Section Library (doc 07) | Every AI op / editor save / pre-publish | Unknown/nonexistent section type | Deprecated but still-supported type |
| 3. Settings | Settings match the section's contract (doc 07/08) | Every AI op / editor save / pre-publish | Wrong type, missing required field, out-of-range/enum value, exceeds `maxBlocks` | Deprecated-but-accepted field value |
| 4. Assets | Referenced images/assets exist and resolve | Alongside settings validation / pre-publish | Broken/dead asset reference | Approaching size limit, poor aspect ratio |
| 5. Product references | Product references point at real, current Product Data | Alongside settings validation / pre-publish | Nonexistent product id, stale field reference | Incomplete underlying product data |
| 6. Preview | LiquidJS Preview Renderer (doc 09) renders without error | Continuously during editing / final pre-publish pass | Render throw, blank output, renderer error | Non-fatal render notice |
| 7. Shopify | Admin API / platform limits will accept the write | Publish time, pre-write | Size/count limit exceeded, permission/scope denial | Approaching soft limit, deprecated field |
| 8. Publish | The publish write actually completed end to end | Publish time, post-write | Write failure, read-back mismatch, storefront check failure | Detected propagation delay |

All hard blocks at layers 1–6 route through the bounded, one-automatic-retry AI feedback loop (§11) before reaching the merchant as a Clarification; layers 7–8 are operational and surface directly in the Publish UI with a direct recovery action. All warnings, at every layer, are non-blocking, persisted on the `Operation` record's `validationResult` (doc 14 §4), and surfaced to the user for awareness at plan-review time and in AI operation history.

---

## Future / Advanced Architecture

The pipeline above assumes every Liquid template it validates data against is our own, fixed, code-reviewed Section Library — which is why there is no Liquid-syntax-validation layer and no cross-cutting regression/scope-validation layer here. An earlier, heavier design explored both, for a world where an AI could generate or modify arbitrary Liquid/CSS/JS against an unknown merchant's existing theme:

- **Liquid syntax validation** — parsing/linting AI-generated Liquid source (e.g. via Shopify's `theme-check` tooling) before it's ever uploaded, catching unbalanced tags, unknown filters, and malformed schema blocks pre-upload rather than discovering them via a failed Admin API write.
- **Regression/scope validation** — proving that a generated code change touched only the paths it declared it would touch, by cross-checking the resulting Diff's entries (doc 14) against the operation's declared scope and hard-blocking anything outside it, since free-form generated code can have side effects a fixed template's own author would never introduce.

Neither is needed for MVP: the Section Library is fixed and reviewed like any other application code, so there is no AI-generated Liquid to lint, and the blast radius of any one Operation is already bounded by construction (it can only ever touch settings/content on the sections it explicitly targets, per doc 07/08). Both are noted here only in case a future "arbitrary theme" or "AI-authored section" mode is ever built on top of this system — at which point they would slot back in as additional layers between what is today Section validation and Preview validation.
