# Testing Strategy

This document defines the test suite that guarantees the product's core promise holds: a generated store is
built from a controlled, pre-tested Section Library, and the store a merchant edits in the LiquidJS Preview
Renderer is the store that actually goes live on Shopify. Every test category below maps to one of three
failure modes:

1. **An invalid or hallucinated Store Configuration** — AI selects a Section `type` outside the fixed catalog,
   sets a setting a Section's schema doesn't define, or otherwise asserts something about the
   [Section Library](02-base-theme-and-section-library.md) that isn't true.
2. **The LiquidJS Preview Renderer diverges from the real Shopify storefront** — a Section renders differently
   in the [preview](06-preview-architecture.md) than through Shopify's own Liquid engine and theme runtime once
   [published](14-shopify-publishing.md).
3. **AI regeneration destroys a merchant's manual edits** — a later AI Generation or AI-driven edit call
   silently overwrites content a user has since hand-edited through the [Visual Editor](09-visual-editor.md).

## Fixture Strategy

The Section Library and Base Theme are fixed and owned; the thing that varies from store to store is the
[Store Configuration](03-store-configuration.md) built on top of them. Fixtures are built around that: a small
set of representative Store Configurations, dedicated coverage of the Section Library itself, and a separate
fixture layer for Product Import.

### Fixture Store Configurations

| Fixture | Composition |
|---|---|
| **Minimal** | One page, two or three Sections, default settings throughout. The happy-path baseline. Never used as the only fixture in a test run — it is also the configuration most likely to look correct by accident. |
| **Full-Catalog** | Every Section `type` in the library appears at least once across its pages, with a representative spread of settings and, where applicable, blocks. Primary vehicle for "every Section is exercised at least once" coverage. |
| **Edge-Case** | Sections with no blocks, every optional setting omitted (must fall back to schema defaults correctly), Sections at their maximum block count, very long copy (overflow/truncation/wrapping), and missing or broken image references. |
| **Multi-Page** | Home, product, collection, and cart pages each configured distinctly, with shared Section types reused across pages under different settings — catches cross-page state leakage or incorrect per-page scoping. |
| **Large/Realistic** | A large configuration of the kind a real end-to-end AI Generation run produces from real product data. Serves as the performance/token-budget worst case and a general non-degenerate regression baseline. |

Every test category that runs "against the fixture set" runs against all five fixtures, not just one. A test
that only passes on **Minimal** is treated as a bug in the test, not a pass.

Fixture Store Configurations are versioned alongside the Section Library. Adding a new Section to the library
requires updating the **Full-Catalog** fixture to include it, enforced as part of the Section Library's own
review/release process.

### Fixture Product Imports

The [Product URL → Product Import → Product Data → AI Generation](05-product-import.md) pipeline has its own
deterministic fixture layer, separate from Store Configuration fixtures:

- A small set of **recorded/frozen scraped product pages** — HTTP response snapshots for a representative
  spread of real source sites (e.g. a marketplace-style listing, an existing Shopify store's product page, and
  a generic/unknown-platform HTML product page) — checked into fixture storage and replayed in CI so Product
  Import and AI Generation pipeline tests are deterministic and don't depend on live network access or a
  third-party page staying unchanged commit-to-commit.
- Each recorded fixture also gets hand-authored **malformed/adversarial variants**: missing price, missing
  images, a description containing injection-shaped text. These are used for extraction-robustness and
  prompt-injection-resistance tests.
- A much smaller **live-fetch smoke suite** (a handful of real, currently-valid product URLs against real
  third-party sites) runs nightly rather than per-commit, to catch drift in real-world page structures that the
  frozen fixtures cannot detect on their own. A live-fetch failure here is a signal to refresh the recorded
  fixture set, not necessarily a product bug.

Recorded Product Import fixtures are refreshed on a deliberate, reviewed cadence — a refresh is a visible,
reviewed diff against the previous recorded fixture, not silent drift picked up automatically.

## Unit Tests

Fast, deterministic, run on every commit. No real network calls — no live Shopify API, no live LLM calls.
LLM-touching logic is tested via recorded fixtures/mocks at this layer; live-model behavior is covered
separately under [AI-Specific Tests](#ai-specific-tests).

### Section Library correctness

| What's tested | How |
|---|---|
| Every Section renders valid output across its settings-schema range | Render each Section with default settings, with each enum/option value, with numeric settings at min/max/step boundaries, and with optional settings/blocks both present and absent — golden-file comparison against a checked-in expected HTML snapshot per case. Any diff requires explicit review and re-approval, never silent acceptance. |
| Section settings schema itself validates | Each Section's schema (setting types, ids, option lists, `min`/`max`/`step`, block/`maxBlocks` declarations) is checked for internal well-formedness — no duplicate setting ids, no malformed option list, matches the [Shared Section Contract](12-shared-section-contract.md)'s conventions. |
| Defensive handling of out-of-schema input | A Section given a settings value outside its own schema's declared range/type fails predictably — a structured error, never a silent partial render or an unhandled exception mid-render. |
| Block rendering and limits | Sections that support blocks render correctly at zero blocks, one block, and their declared maximum; a block count above the declared maximum is rejected upstream by schema validation, not something the Section template guards against itself. |
| Cross-Section consistency conventions | Shared conventions across the library (how every Section consumes a common color/typography setting, how every Section names its root DOM element for [click-to-select](10-dom-metadata-and-selection.md)) are asserted across the whole library in one pass, to catch a Section that doesn't follow the shared contract. |

### Store Configuration schema validation

| What's tested | How |
|---|---|
| Structural validity | A Store Configuration's `pages -> sections[] -> {id, type, settings, blocks}` shape is validated: every `type` resolves to a real Section in the library, every `id` is unique within its scope, `settings` conforms to that Section's schema, `blocks` respects that Section's block rules. |
| Malformed input handling | An unknown `type`, a duplicate `id`, a missing required setting, or a setting value outside its schema's allowed range fails with a structured, field-attributable error — never silently coerced or dropped. |
| Round-trip integrity | Serializing a Store Configuration and re-parsing it produces an identical structure (no field loss, no meaning-changing reordering). |
| Versioning/provenance metadata | The `ai`/`user` provenance tag per field (see [AI Architecture](04-ai-architecture.md)) round-trips and updates correctly under mutation — depended on by the regeneration tests below. |

### Store Configuration mutation functions

Every mutation function operating on a Store Configuration (add/remove/reorder Section, add/remove/reorder
block, set a setting value, set copy/text content, add/remove a page) gets a dedicated unit test asserting:

- **Correctness** — the result reflects exactly the intended change and nothing else.
- **Id stability** — a Section or block instance's `id` never changes across reorders, edits, or duplication of
  *other* instances.
- **Schema-bound invariants** — block insertion respects a Section's `maxBlocks`; setting updates respect that
  setting's type/`options`/`min`/`max`/`step` constraints and are rejected, never silently clamped, if invalid.
- **Ordering invariants** — a page's Section order and a Section's block order stay internally consistent after
  every structural mutation (no orphaned ids, no duplicate positions).
- **Shared mutation path** — the Visual Editor and AI-driven edits go through the same mutation functions; each
  function's test suite is written with that shared-path stake in mind, since a bug here corrupts both surfaces
  at once.

### Operation executors

The AI/editor Operation system defines a fixed set of Operation types — all structural (select/replace a
Section, set a setting, set copy, reorder, add/remove a block, add/remove a page, and similar), with **none**
that accept or emit Liquid, HTML, CSS, or JS. Per Operation type:

- The executor invokes the correct Store Configuration mutation function(s) for its payload shape.
- **No code-emitting Operation type exists** — asserted as a standing, enumerable regression gate over the full
  Operation type list (every type's payload schema is checked to contain no field capable of carrying
  template/code source), not assumed from the design doc.
- **Target-existence guard** — executing any Operation whose target (a Section id, block id, setting id, or
  page id) does not exist in the current Store Configuration is rejected before any mutation is attempted. This
  is the executor-level half of hallucination resistance; the AI-output half is covered under
  [Hallucination resistance](#hallucination-resistance).
- Estimated cost/credit accounting is populated per the documented convention for that Operation type.

### Validation layers

Each validation layer between an Operation/AI output and a persisted Store Configuration gets its own isolated
unit suite, fed hand-crafted good/bad inputs (not full pipeline runs). There is no code-validation layer,
because no Operation type can carry code.

| Layer | Unit-tested by |
|---|---|
| Section/type existence | Feed an Operation or AI-generated entry referencing a `type` not in the Section Library. Must be rejected pre-persistence. |
| Settings schema conformance | Feed a setting value of the wrong type, out of range, or referencing an option a Section's schema doesn't define; feed a block count exceeding a Section's `maxBlocks`. All rejected pre-mutation. |
| Content sanitization / injection safety | Feed copy/text content containing HTML- or script-like markup and literal Liquid-delimiter-looking text; assert it's sanitized/escaped for its field type rather than passed through raw. |
| Structural consistency | Feed a Store Configuration with a duplicate id, an orphaned reference, or inconsistent page/Section ordering (simulated bad mutation output). Must be rejected — the unit-level counterpart to the [blast-radius regression tests](#regression-tests). |

## Integration Tests

Slower, real-network tests. Run nightly and pre-release, not on every commit.

### Shopify Admin API — Base Theme install/update and publish

Run against a real Shopify Partner development store, dedicated to CI, reset between runs:

- OAuth connect flow end-to-end, including scope verification (`write_themes` and whatever read scopes Product
  Import/publish require).
- Install the Base Theme fresh onto a store with no existing Shopforge theme; assert the resulting theme's file
  tree/assets match what the Section Library and Base Theme source should produce. The only "read back" here is
  verifying the app's own installed output — there is no arbitrary existing theme to read.
- Apply a fixture Store Configuration onto the installed Base Theme via the Admin API, fetch the live rendered
  pages via a headless request, and assert they reflect the configuration correctly.
- **Update flow** — apply a changed Store Configuration to an already-installed Base Theme; assert the change
  applies correctly and idempotently: no duplicated Sections, no stale settings left over from the prior
  configuration, no drift if the same configuration is re-applied twice in a row.
- **Rollback** — revert to a previous [Store Configuration version](18-versioning-and-undo-redo.md) and assert
  the live storefront (fetched via a headless request) reflects the prior state.
- **API resilience** — rate-limit (429) backoff/retry, conflict handling mid-multi-request publish,
  partial-failure recovery (publish fails partway through must not leave the store in a half-applied state).

### Full AI Generation and editing pipeline, end-to-end

Two pipelines get end-to-end integration coverage:

- **Generation pipeline** — Product URL (from the recorded fixture set) → Product Import/Scraper → Product Data
  → AI Generation → Store Configuration, run through the real pipeline (recorded product fixtures + real or
  recorded LLM calls) → validation → a persisted, publishable Store Configuration.
- **Editing pipeline** — a natural-language edit request against an existing fixture Store Configuration →
  Operation Planner → Executor → Validation → updated Store Configuration.

Both are asserted for:

- The final Store Configuration validates cleanly and renders correctly (paired with
  [Preview Parity](#preview-parity) checks).
- The AI's stated plan/rationale is internally consistent with what actually executed.
- Section-selection behavior is exercised across the full catalog, using request templates broad enough to
  plausibly reach most or all Section types over the whole corpus — specifically to catch selection bias
  toward a small, over-familiar subset of the catalog.

## AI-Specific Tests

The category most unique to an AI-driven product, and most prone to silent quality drift as prompts or models
change. Every suite here re-runs on every Operation Planner, prompt-template, or model-version change, not just
on a schedule.

### Ambiguous-prompt suite (clarify vs. execute)

A hand-labeled corpus of prompts against fixture Store Configurations, each labeled with the expected outcome:

| Example prompt | Fixture context | Expected outcome |
|---|---|---|
| "Make it pop more" | any | `clarify` — no unambiguous target or action |
| "Change the button color to blue" | config with one global button style setting | `execute` — a structural setting update |
| "Change the button color to blue" | config with per-Section button style overrides on 3 different Sections | `clarify` — which button(s)? |
| "Add a sale banner" | catalog includes both an announcement-bar Section and a promo-banner Section | `clarify` — which Section type? |
| "Move the reviews section above the FAQ" | config with exactly one reviews Section and one FAQ Section present | `execute` — a reorder operation |
| "Add a wishlist feature" | any fixture (no Section in the catalog provides this) | `clarify`, or an explicit "not available in the current Section library" — never silently invented |

Tracked metrics with hard thresholds enforced in CI:

- **False-execution rate** (guessed instead of asking) — target **< 5%**. An unwanted silent change is the
  costlier failure mode.
- **False-clarification rate** (asked when it should have just acted) — target **< 15%**, tolerated more
  loosely since it costs a user round-trip, not configuration integrity.

### Section-selection accuracy

Section selection is the AI's central job, both at generation time and edit time, and is tracked as two
distinct metrics since the two calls have different context and ambiguity profiles:

- **Generation-time selection** — given fixture Product Data, does the AI choose an appropriate, sensible
  subset of the Section catalog to build the store from, measured against a hand-curated "acceptable set" per
  fixture product (there is rarely exactly one correct answer here)?
- **Edit-time selection** — given a descriptive prompt targeting a specific existing Section by natural-language
  description rather than by id (e.g. "the section right under the header that shows customer reviews"), does
  the AI resolve it to the correct Section `id`, against a ground-truth expected answer from that fixture Store
  Configuration? Measured as **top-1 selection accuracy**, target **≥ 95%** aggregated.
- Both metrics are tracked **per Section type**, not just in aggregate. A chronically under-selected or
  over-selected Section type is itself a signal worth surfacing — it may mean the Section's catalog name/
  description is ambiguous, or the selection prompt is biased toward a familiar subset. A suite that scores
  well in aggregate while systematically missing a handful of Section types is a fail, not a pass.

### Regeneration preserves user edits

AI regeneration or a follow-up AI edit must not blindly overwrite content a user has since hand-edited.

- A labeled corpus of fixture Store Configurations where specific Sections/settings are marked as user-edited
  since their last AI touch, per the provenance/ownership tracking defined in
  [AI Architecture](04-ai-architecture.md).
- For each fixture, run a follow-up AI Generation or edit request that does **not** explicitly target the
  user-edited content, and assert the user-edited Section/setting is unchanged afterward.
- For a request that legitimately **does** target user-edited content (e.g. "change the hero heading" when the
  user already hand-edited that exact heading), assert the AI either proceeds, since it was explicitly asked, or
  flags the conflict for confirmation — but never silently discards the edit as a side effect of an unrelated
  request.
- A closely related assertion: a partial edit request ("make the hero more compelling") must not cause any
  Section outside its declared target to be touched at all, user-edited or not — feeds directly into
  [Regression Tests](#regression-tests).
- This suite is a **hard-fail release gate** (see [Test Cadence and Release Gates](#test-cadence-and-release-gates)).

### Hallucination resistance

Prompts that reference Section types, settings, or content that **do not exist** in the fixed Section Library
or in a given fixture Store Configuration's actual composition, validated using the adversarial fixtures from
[Fixture Product Imports](#fixture-product-imports)-style variants and deliberately-absent-Section fixture
variants:

- An automated checker parses the AI's structured output (any Operation targets, any proposed `type`/setting
  selections) **and** its natural-language response text, cross-references every named Section type/setting
  against the ground-truth Section Library and the fixture's actual Store Configuration, and fails the test if
  the AI asserts or implies the existence of a Section type outside the catalog, or a setting/option outside a
  given Section's declared contract.
- Expected behavior on a miss: clarify, state plainly that it's not available in the current Section library,
  or, for generation-time requests, select the nearest real Section instead — never fabricate a `type` string
  or a setting key that doesn't resolve to anything real.
- Because the entire catalog is fixed and fully known in advance, this suite doubles as a check on whether the
  AI's context assembly (see [Token usage budget assertions](#token-usage-budget-assertions)) correctly grounds
  it in the real catalog rather than the model's general prior knowledge of "what a Shopify theme section is
  typically called."

### Token usage budget assertions

The context an AI call needs is bounded by a small, fixed universe — the Section catalog and its schemas, plus
the relevant Product Data — per the context-selection strategy in [AI Architecture](04-ai-architecture.md).

- Assert the assembled context payload for a single generation or edit call stays within the documented
  per-call token budget, across both context regimes: a **generation-time call**, which plausibly needs
  awareness of most or all of the catalog to make a good initial selection, and a **targeted edit call**, which
  needs only the one (or few) Section(s) the request concerns.
- Assert **recall** under budget pressure: for edit-time calls, the Section(s)/setting(s) actually relevant to
  the prompt's target are present in the selected context in **≥ 99%** of cases; for generation-time calls, the
  catalog summary provided is sufficient for the AI to reliably reach every Section type at least somewhere
  across the full test corpus (cross-checked against [Section-selection accuracy](#section-selection-accuracy)).
  A budget-compliant context that quietly makes half the catalog unreachable is a failure, not a pass.

## Regression Tests

Purpose: catch any Operation or AI edit, on any fixture Store Configuration, whose blast radius exceeds its
declared target.

- **Snapshot-diff harness** — for a given fixture Store Configuration + Operation, capture the full
  configuration before, execute, capture it after, compute the complete diff, and assert every resulting change
  is rooted under the Operation's declared target. Example: an Operation targeting Section `id: "hero-1"` may
  only produce changes under that Section's own settings/blocks; a reorder Operation may additionally touch the
  owning page's Section-order array, an explicitly whitelisted secondary path per Operation type. Anything
  outside the whitelist fails the test.
- Run this harness for **every Operation type**, against **every fixture Store Configuration**, as a required
  gate before any Operation executor change ships.
- **Sequence/fuzz mode** — apply long random sequences of valid structural Operations to a fixture Store
  Configuration, then undo the same number of steps, and assert the final configuration is identical to the
  starting state. Catches slow state drift and undo/redo bugs a single-operation test can't see.

## E2E

End-to-end tests drive the full product flow from a real product URL through to a live Shopify storefront:

```
Product URL
  |
Generation
  |
Preview
  |
Edit
  |
Save
  |
Publish
  |
Shopify Store
```

Each stage is asserted against the entity it produces before moving to the next:

| Stage | Asserted output |
|---|---|
| Product URL | A submitted URL resolves to a queued `ProductImportJob`. |
| Generation | The job produces normalized Product Data, and AI Generation produces a valid, schema-conforming Store Configuration. |
| Preview | The LiquidJS Preview Renderer renders the Store Configuration into the same-origin preview iframe with `data-sf-*` metadata present. |
| Edit | A Visual Editor operation (structural or `contentEditable` text edit) produces a validated Store Configuration mutation, reflected in the re-rendered preview. |
| Save | The mutation is persisted as a new `ConfigurationVersion`, undoable/redoable. |
| Publish | The current Store Configuration is applied to the merchant's installed Base Theme via the Shopify Admin API, recorded as a `PublishRecord`. |
| Shopify Store | The live storefront, fetched via a headless request, reflects the published Store Configuration. |

## Preview Parity

Direct coverage of failure mode 2: what the LiquidJS Preview Renderer shows during editing must be what
actually appears once published to a real Shopify store. Given how central this guarantee is to the product's
promise, it gets dedicated coverage rather than being folded into general visual regression testing. See
[Preview-Shopify Parity](16-preview-shopify-parity.md) for parity as an engineering goal; this section defines
how it is tested.

### What gets compared

For each fixture Store Configuration, render it through both paths and compare:

1. **LiquidJS Preview Renderer path** — Store Configuration → LiquidJS `render()` against the Section Library's
   Liquid templates → HTML, rendered headlessly at three breakpoints matching the Visual Editor's own preview
   context: **desktop (1440px)**, **tablet (768px)**, **mobile (375px)**.
2. **Real Shopify path** — the same Store Configuration applied to the Base Theme on the dedicated dev store,
   fetched live via a headless request/browser at the same three breakpoints.

The comparison runs at two levels:

- **Structural (DOM) comparison** — for each Section, its rendered DOM subtree from path 1 is diffed against
  its rendered DOM subtree from path 2, keyed by Section id, so any difference is attributable to a specific
  Section. Catches markup-level divergence (wrong element, missing attribute, different applied setting value)
  without needing a full visual render. Covers content changes, section order, images, and typography as
  data-bound attributes and structure.
- **Visual (perceptual screenshot) comparison** — full-page and per-Section-bounding-box screenshot diffs
  between the two paths. Catches differences a DOM diff wouldn't: CSS resolved differently, a font failing to
  load, a layout or responsive-behavior difference from how each path serves static assets. Covers buttons,
  typography rendering, images, and responsive behavior across the three breakpoints.

### How differences are triaged

Not every difference between the two paths is a bug; the suite classifies rather than blanket-suppressing or
blanket-failing:

- **Expected/allowed differences** — explicitly allowlisted by known cause and excluded from failing the run:
  real Shopify-only dynamic state a local LiquidJS render cannot reproduce (live cart contents/count, live
  inventory/stock-level text, customer-specific/logged-in content, storefront-selected currency/language),
  Shopify CDN image URL/transform parameters versus local preview image references, and script tags injected by
  other apps installed on the dev store. This allowlist is reviewed periodically so it cannot silently grow to
  swallow a genuine bug under an "expected difference" label.
- **Unexpected differences** — anything outside that allowlist, at either the structural or visual level — are
  a **hard fail** and block release, since they mean the preview a merchant edited against does not represent
  what actually published. Each failure is attributed to the specific Section and fixture Store Configuration
  responsible, so it's immediately clear whether the issue is in that Section's Liquid template, in a
  LiquidJS-vs-Shopify-Liquid engine behavioral difference, or in the Store Configuration → template
  data-binding itself.
- **Known engine incompatibilities** — because LiquidJS is an independent implementation of the Liquid
  language, it is not guaranteed to be behaviorally identical to Shopify's own Liquid engine on every filter or
  tag's edge cases. Any incompatibility discovered through this suite is recorded in a known-incompatibility
  list maintained alongside the Section Library, and Section templates are authored/reviewed against that list
  to avoid constructs known to diverge between the two engines.

### Handling flakiness and dynamic state

- The dev store's cart and inventory state is reset or seeded to a known fixed state before each comparison
  run, so "expected dynamic difference" cases are themselves deterministic — allowlisted because their cause is
  understood, not because the suite tolerates nondeterminism.
- Perceptual screenshot diffing uses a noise tolerance for anti-aliasing/font-rendering jitter, but a
  **systematic** visual gap between the two rendering contexts (e.g. a webfont that fails to load in one path
  but not the other) is never waved through under that tolerance regardless of pixel-delta magnitude — a
  consistent, explainable divergence is a parity bug.
- The live-Shopify fetch is retried with backoff for genuine transient network conditions, but a content/
  structural mismatch is never retried in the hope it resolves itself — a real difference fails immediately.

### Coverage and cadence

- Every Section in the library gets parity coverage at least once, via the **Full-Catalog** fixture. A new
  Section is not done until its parity comparison passes, gated alongside its own golden-render coverage under
  [Section Library correctness](#section-library-correctness).
- After every Operation type is exercised at least once per representative fixture Store Configuration (a smoke
  matrix: Operation types × fixture configs), both paths are re-rendered and compared.
- The cheaper **structural (DOM) comparison** runs on every CI run touching the Section Library, the LiquidJS
  renderer, or the Store Configuration schema.
- The more expensive **full visual/screenshot comparison**, which requires the real dev store, runs nightly and
  pre-release.

## Test Cadence and Release Gates

| Category | Network/LLM required | Runs on |
|---|---|---|
| Unit — Section Library, Store Configuration schema/mutations, Executors, Validation layers | No (mocked) | Every commit |
| Integration — Shopify Admin API (Base Theme install/update, publish) | Yes (real dev store) | Nightly + pre-release |
| Integration — full AI Generation and editing pipeline, end-to-end | Yes (mock or real Shopify, real/recorded LLM, recorded Product fixtures) | Nightly + pre-release |
| AI-specific — ambiguous prompts, section selection, regeneration-preserves-edits, hallucination, token budget | Yes (real LLM) | Every Planner/prompt/model change + nightly |
| Regression — snapshot-diff, fuzz/undo | No (mocked) | Every commit (single-op) / nightly (fuzz sequences) |
| Preview parity — structural | Yes (LiquidJS render only) | Every CI run touching Section Library / renderer / schema |
| Preview parity — full visual | Yes (render service + real dev store) | Nightly full matrix + pre-release |
| Live Product Import smoke suite | Yes (real third-party sites) | Nightly |

**Non-negotiable release gate.** The following must be 100% green before release, since they map directly to
the three failure modes this document opens with:

- [Validation layers](#validation-layers)
- [Regeneration preserves user edits](#regeneration-preserves-user-edits)
- [Hallucination resistance](#hallucination-resistance)
- [Regression Tests](#regression-tests)
- [Preview Parity](#preview-parity)'s structural comparison

All other suites carry tracked thresholds but are not hard release blockers at MVP.

## Open Questions / TBD

- Exact per-call token budget figures referenced in [Token usage budget assertions](#token-usage-budget-assertions)
  are documented in [AI Architecture](04-ai-architecture.md); this suite verifies against whatever figure is
  set there rather than defining it independently.
- Final storage/hosting location for the fixture Store Configuration set, recorded Product Import fixtures, and
  golden-file HTML snapshots is **TBD** — not yet finalized.
