# 21 — Testing Strategy

## 0. Why this doc exists

Shopforge's value proposition is a promise: *pick a product, and we build you a real, working store from a library of sections we've already built and tested — and the store you preview while editing is the store that actually goes live.* That promise is only as strong as the test suite behind it. Three failure modes would each independently kill trust in the product:

1. **The AI produces an invalid or hallucinated Store Configuration** — it selects a Section `type` outside the fixed catalog, sets a setting that Section's schema doesn't define, or otherwise asserts something about the Section Library that isn't true. Since the whole AI Generation flow (Product URL → Product Import → Product Data → AI Generation → Store Configuration) depends on the AI staying strictly inside the catalog it's been given, this is the single most direct way the system's core assumption could break.
2. **The LiquidJS preview lies about what will actually publish.** The entire editing experience is built on the premise that what the merchant sees in the LiquidJS-rendered preview (doc 09) is what they'll get on their live Shopify store once published (doc 16). If those two diverge — a Section renders differently in preview than through Shopify's real Liquid engine and theme runtime — the product's central promise is broken even if every other test passes.
3. **AI regeneration destroys a merchant's manual edits.** Once a merchant has hand-edited a Section's copy or settings through the Visual Editor, a later AI Generation or AI-driven edit call must not silently blow that edit away. Losing user work to "helpful" AI regeneration is one of the fastest ways to lose trust in an AI-assisted editor.

Every test category below maps back to one or more of these three failure modes.

---

## 1. Fixture Store Configuration Set

There is no longer an arbitrary, unknown merchant theme to test against — Shopforge owns a fixed Base Theme and a fixed library of roughly 40–60 Sections (doc 07), and the thing that varies from store to store is the **Store Configuration** (doc 08) built on top of that library. Fixtures are built accordingly: instead of a handful of real-world *themes*, the fixture set is a handful of representative *Store Configurations*, plus dedicated coverage of the Section Library itself, plus a small set of recorded Product Import fixtures to exercise the front of the pipeline.

### 1.1 Composition

Shopforge maintains a **fixture Store Configuration set**, checked into fixture storage as versioned JSON:

| Fixture Store Configuration | Why it's in the set |
|---|---|
| **Minimal** | Smallest viable config — one page, two or three Sections, default settings throughout. The "does the happy path work" baseline — but, as with the old theme set, this must never be the *only* fixture, because it's also the config most likely to make everything look correct by accident. |
| **Full-Catalog** | Every Section `type` in the library appears at least once across its pages, each populated with a representative spread of settings and (where applicable) blocks. This is the primary vehicle for "every Section gets exercised at least once" coverage referenced throughout §2 and §6. |
| **Edge-Case** | Deliberately adversarial data shapes: Sections with no blocks, every optional setting omitted (must fall back to schema defaults correctly), Sections at their maximum block count, very long text in copy fields (overflow/truncation/wrapping behavior), and missing or broken image references. |
| **Multi-Page** | Exercises the `pages` level of the schema specifically — home, product, collection, and cart pages (at minimum) each configured distinctly, with shared Section types reused across pages under different settings, to catch cross-page state leakage or incorrect per-page scoping. |
| **Large/Realistic** | A larger, "real-looking" configuration of the kind an actual end-to-end AI Generation run produces from real product data — many Sections, realistic copy length. Serves as the performance/token-budget worst case (the role Studio played in the old theme fixture set) and a general non-degenerate regression baseline. |

### 1.2 Why fixture variety still matters, even with a fixed catalog

Owning the Section Library removes the biggest source of variance the old fixture strategy had to defend against — there's no more "every free Shopify theme names things differently," since we wrote every Section ourselves. But a fixed catalog does not mean a fixed set of *outcomes*: Sections combine in a large number of ways, each Section has its own settings surface, and a Section's Liquid can still have edge-case behavior that only shows up under specific combinations of settings, adjacent Sections, or data shapes (an empty state, a settings combination its author didn't think to hand-test, an assumption about what typically precedes it on a page). A test suite that only ever exercises the **Minimal** or **Full-Catalog** fixture with tidy, default-ish data risks the same overfitting the old "only ever tested against Dawn" failure mode represented — just relocated from "theme markup variety" to "configuration and combination variety." Every test category in §2–§6 that says "against the fixture set" means run against all five fixtures above, not just the friendliest one, and a test that only passes on **Minimal** is treated as a bug in the test.

### 1.3 The Section Library itself is a test target, not just fixture content

Because Sections are code we wrote and maintain (doc 07), each one needs its own direct test coverage independent of which fixture Store Configuration happens to reference it — this is new relative to the old model, where "the theme" was fixture input, never something Shopforge's own test suite was responsible for being correct. See §2.1 for unit-level Section Library correctness testing and §6 for its rendering-parity coverage.

### 1.4 Fixture Product Imports

The Product URL → Product Import → Product Data → AI Generation pipeline needs its own deterministic fixture layer at the front, separate from Store Configuration fixtures:

- A small set of **recorded/frozen scraped product pages** — HTTP response snapshots for a representative spread of real source sites (e.g. an AliExpress-style listing, an Amazon-style listing, an existing Shopify store's product page, and a generic/unknown-platform HTML product page) — checked into fixture storage and replayed in CI so that Product Import and AI Generation pipeline tests (§3.2, §4) are deterministic and don't depend on live network access or a third-party site's page staying unchanged commit-to-commit.
- Each recorded fixture also gets a small set of **hand-authored malformed/adversarial variants** (missing price, missing images, a description containing injection-shaped text per doc 20 §20.9) used specifically for extraction-robustness and prompt-injection-resistance tests in §4.
- A much smaller **live-fetch smoke suite** (a handful of real, currently-valid product URLs against real third-party sites) runs nightly rather than per-commit, specifically to catch drift in real-world page structures that the frozen fixtures — by construction — can't detect on their own. A live-fetch failure here is a signal to refresh/expand the recorded fixture set, not necessarily a bug in Shopforge.

### 1.5 Fixture maintenance

- Fixture Store Configurations are versioned alongside the Section Library. Adding a new Section to the library (doc 07) requires updating the **Full-Catalog** fixture to include it — enforced as part of the Section Library's own review/release process (doc 20 §20.5.1), not a separately scheduled job, since there's no external "upstream theme released a new version" drift risk once we own the catalog outright.
- Recorded Product Import fixtures (§1.4) are refreshed on a deliberate, reviewed cadence — real marketplace and storefront pages change layout over time, and a refresh should be a visible, reviewed diff against the previous recorded fixture, not silent drift picked up automatically.

---

## 2. Unit Tests

Unit tests are fast, deterministic, run on every commit, and never touch the network (no real Shopify API, no real LLM calls — LLM-touching logic is tested via recorded fixtures/mocks at this layer; live-model behavior is covered separately in §4).

### 2.1 Section Library correctness

| What's tested | How |
|---|---|
| Every Section renders valid output across its settings-schema range | For each Section, render it with default settings, with each enum/option value, with numeric settings at min/max/step boundaries, and with optional settings/blocks both present and absent — golden-file comparison against a checked-in expected HTML snapshot per case. Any diff must be explicitly reviewed and re-approved, not silently accepted. |
| Section settings schema itself validates | Each Section's schema (setting types, ids, option lists, `min`/`max`/`step`, block/`maxBlocks` declarations) is checked for internal well-formedness — no duplicate setting ids, no malformed option list, matches doc 07's schema conventions. |
| Defensive handling of out-of-schema input | A Section given a settings value outside its own schema's declared range/type (simulating a bug elsewhere in the pipeline, since this should never happen given §2.2's validation) fails predictably — a structured error, never a silent partial render or an unhandled exception mid-render. |
| Block rendering and limits | Sections that support blocks render correctly at zero blocks, one block, and their declared maximum; a block count above the declared maximum is rejected upstream (§2.2) rather than something the Section template itself has to guard against silently. |
| Cross-Section consistency conventions | Shared conventions across the library (e.g. how every Section consumes a common color/typography setting, how every Section names its root DOM element for the Visual Editor's click-to-select mapping, doc 09) are asserted across the *whole* library in one pass, not just per-Section, to catch a Section that doesn't follow the shared contract. |

### 2.2 Store Configuration schema validation

| What's tested | How |
|---|---|
| Structural validity | A Store Configuration's `pages` → `sections[]` → `{id, type, settings, blocks}` shape (doc 08) is validated: every `type` resolves to a real Section in the library, every `id` is unique within its scope, `settings` conforms to that Section's schema, `blocks` respects that Section's block rules. |
| Malformed input handling | An unknown `type`, a duplicate `id`, a missing required setting, or a setting value outside its schema's allowed range must fail with a structured, actionable, field-attributable error — never silently coerced or dropped. |
| Round-trip integrity | Serializing a Store Configuration and re-parsing it produces an identical structure (no field loss, no reordering that changes meaning), which the mutation functions in §2.3 and the persistence layer both depend on. |
| Versioning/history metadata | If the Store Configuration schema carries version or provenance metadata (doc 08, doc 11 — e.g. marking a section or setting as AI-authored vs. user-edited, which §4.3 depends on), that metadata round-trips and updates correctly under mutation. |

### 2.3 Store Configuration mutation functions

Every mutation function that operates on a Store Configuration (add/remove/reorder Section, add/remove/reorder block, set a setting value, set copy/text content, add/remove a page) gets a dedicated unit test asserting:

- **Correctness** — the resulting Store Configuration reflects exactly the intended change and nothing else.
- **Id stability** — a Section or block instance's `id` never changes across reorders, edits, or duplication of *other* instances.
- **Schema-bound invariants** — block insertion respects a Section's `maxBlocks`; setting updates respect that setting's type/`options`/`min`/`max`/`step` constraints and are rejected (not silently clamped) if invalid.
- **Ordering invariants** — a page's Section order and a Section's block order stay internally consistent after every structural mutation (no orphaned ids, no duplicate positions).
- **Shared mutation path** — since both the Visual Editor and AI-driven edits go through the same mutation functions (doc 11), a bug here would corrupt both surfaces at once; each mutation function's test suite is written and reviewed with that shared-path stake in mind.

### 2.4 Operation executors (one test class per Operation type)

Doc 11's AI Generation & Editing Operation System defines a fixed set of Operation types — all of them structural (select/replace a Section, set a setting, set copy, reorder, add/remove a block, add/remove a page, and similar) with **none** that accept or emit Liquid/HTML/CSS/JS. For every Operation type, a dedicated executor test suite asserts:

- The executor invokes the correct Store Configuration mutation function(s) for its payload shape.
- **No code-emitting Operation type exists** — this is asserted as a standing, enumerable regression gate over doc 11's full Operation type list (every type's payload schema is checked to contain no field capable of carrying template/code source), not just an assumption carried over from the design doc. This is the unit-test counterpart to doc 20 §20.9's security claim that there's structurally nothing for a prompt injection to reach for.
- **Target-existence guard**: executing any Operation whose target (a Section id, block id, setting id, or page id) does not exist in the current Store Configuration is rejected before any mutation is attempted — the executor-level half of hallucination resistance (the AI-output half is covered in §4.4).
- Estimated cost/credit accounting (doc 22, where applicable) is populated per the documented convention for that Operation type.

### 2.5 Validation layers (per doc 15)

Each validation layer that sits between an Operation/AI output and a persisted Store Configuration gets its own isolated unit suite, fed hand-crafted good/bad inputs (not full pipeline runs). The categories are simpler than the old theme-editing validation pipeline, since there's no code-validation layer to test:

| Layer | Unit-tested by |
|---|---|
| **Section/type existence** | Feed an Operation or AI-generated Store Configuration entry referencing a `type` not in the Section Library. Must be rejected pre-persistence. |
| **Settings schema conformance** | Feed a setting value of the wrong type, out of range, or referencing an option a Section's schema doesn't define; feed a block count exceeding a Section's `maxBlocks`. All must be rejected pre-mutation. |
| **Content sanitization / injection safety** | Feed copy/text content containing HTML- or script-like markup and literal Liquid-delimiter-looking text (doc 20 §20.7.2, §20.10); assert it's sanitized/escaped appropriately for its field type rather than passed through raw. |
| **Structural consistency** | Feed a Store Configuration with a duplicate id, an orphaned reference, or an inconsistent page/Section ordering (simulated bad mutation output). Must be rejected — the unit-level counterpart to the full blast-radius regression tests in §5. |

---

## 3. Integration Tests

Slower, real-network, run nightly and pre-release (not on every commit).

### 3.1 Shopify Admin API — Base Theme install/update and Store Configuration publish

Run against a real Shopify Partner **development store**, dedicated to CI, reset between runs:

- OAuth connect flow end-to-end, including scope verification (`write_themes` and whatever read scopes Product Import/publish require, per doc 20 §20.2).
- Install the Base Theme fresh onto a store with no existing Shopforge theme, and assert the resulting theme's file tree/assets match what the Section Library and Base Theme source should produce — there is no more "download a merchant's theme" step, since Shopforge never reads an existing arbitrary theme; the only "read back" here is verifying our own installed output.
- Apply a fixture Store Configuration onto the installed Base Theme via the Admin API, then fetch the live rendered pages (via a headless request) and assert they reflect the configuration correctly — the round-trip check that used to be "download → apply → re-upload → re-download, byte-identical" becomes "apply → fetch-rendered, matches expected."
- **Update flow**: apply a changed Store Configuration to an *already-installed* Base Theme and assert the change is applied correctly and idempotently — no duplicated Sections, no stale settings left over from the prior configuration, no drift if the same configuration is re-applied twice in a row.
- **Rollback**: revert to a previous Store Configuration version and assert the live storefront (fetched via a headless request) reflects the prior state.
- API resilience: rate-limit (429) backoff/retry, conflict handling mid-multi-request publish, partial-failure recovery (publish fails partway through — must not leave the store in a half-applied state).

### 3.2 Full AI Generation and editing pipeline, end-to-end

Two related pipelines get end-to-end integration coverage:

- **Generation pipeline**: Product URL (from the fixture set in §1.4) → Product Import/Scraper → Product Data → AI Generation → Store Configuration, run through the real pipeline (recorded product fixtures + real or recorded LLM calls) → validation (§2.5) → a persisted, publishable Store Configuration.
- **Editing pipeline**: a natural-language edit request against an existing fixture Store Configuration → Operation Planner (doc 11) → Executor → Validation → updated Store Configuration.

Both are asserted for:

- The final Store Configuration validates cleanly and renders correctly (paired with the visual/parity tests in §6).
- The AI's stated plan/rationale is internally consistent with what actually executed.
- Section-selection behavior is exercised across the **full catalog**, using request templates broad enough to plausibly reach most/all of the ~40–60 Sections over the whole corpus — specifically to catch selection bias toward a small, over-familiar subset of the catalog (a risk noted further in §4.2).

---

## 4. AI-Specific Tests

This is the category most unique to an AI-driven product, and the one most prone to silent quality drift as prompts/models change. Every suite here is re-run **on every Operation Planner / prompt-template / model-version change**, not just on a schedule.

### 4.1 Ambiguous-prompt suite (clarify vs. execute)

A hand-labeled corpus of prompts against fixture Store Configurations, each labeled with the expected outcome — `clarify` or `execute`:

| Example prompt | Fixture context | Expected outcome |
|---|---|---|
| "Make it pop more" | any | `clarify` — no unambiguous target or action |
| "Change the button color to blue" | config with one global button style setting | `execute` — a structural setting update |
| "Change the button color to blue" | config with per-Section button style overrides on 3 different Sections | `clarify` — which button(s)? |
| "Add a sale banner" | catalog includes both an announcement-bar Section and a promo-banner Section | `clarify` — which Section type? |
| "Move the reviews section above the FAQ" | config with exactly one reviews Section and one FAQ Section present | `execute` — a reorder operation |
| "Add a wishlist feature" | any fixture (no Section in the catalog provides this) | `clarify` or an explicit "not available in the current section library" — never silently invented, see §4.4 |

Tracked metrics with hard thresholds enforced in CI:
- **False-execution rate** (guessed instead of asking) — target **< 5%**, since an unwanted silent change is the costlier failure mode.
- **False-clarification rate** (asked when it should have just acted) — target **< 15%**, tolerated more loosely since it costs a user round-trip, not configuration integrity.

### 4.2 Section-selection accuracy

Section selection is now literally the AI's central job — both when generating a new store from product data and when editing an existing one — so this suite gets proportionately more weight than its equivalent did in the old architecture, and is tracked as two distinct metrics rather than one, since the two calls have very different context and ambiguity profiles:

- **Generation-time selection**: given fixture Product Data, does the AI choose an appropriate, sensible subset of the ~40–60 Section catalog to build the store from (measured against a hand-curated "acceptable set" per fixture product, since there's rarely exactly one correct answer here)?
- **Edit-time selection**: given a descriptive prompt targeting a specific existing Section by natural-language description rather than by id (e.g. "the section right under the header that shows customer reviews"), does the AI resolve it to the correct Section `id`, with a ground-truth expected answer from that fixture Store Configuration? Measured as **top-1 selection accuracy**, target **≥ 95%** aggregated.
- Both metrics are tracked **per Section type**, not just in aggregate — with a catalog this small (40–60, not an open-ended vocabulary), a chronically under-selected or over-selected Section type is itself a signal worth surfacing (it may mean the Section's name/description in the catalog is ambiguous, or that the selection prompt is biased toward a familiar subset), and a suite that scores well in aggregate while systematically missing a handful of Section types is a fail, not a pass.

### 4.3 Regeneration does not destroy user edits

The old "minimal modification" concept — proving the AI made the smallest sufficient edit to an existing theme — doesn't map cleanly onto an architecture with no free-form theme to minimally touch. What replaces it, and matters just as much for user trust, is: **AI regeneration or a follow-up AI edit must not blindly overwrite content a user has since hand-edited.**

- A labeled corpus of fixture Store Configurations where specific Sections/settings are marked as user-edited since their last AI touch (per doc 11's provenance/ownership tracking, if defined — otherwise, this suite establishes the general expected contract directly: content a human has manually changed is not fair game for silent AI overwrite).
- For each fixture, run a follow-up AI Generation or edit request that does **not** explicitly target the user-edited content, and assert the user-edited Section/setting is unchanged afterward.
- For a request that legitimately **does** target user-edited content (e.g. "change the hero heading" when the user already hand-edited that exact heading), assert the AI either proceeds (since it was explicitly asked) or flags the conflict for confirmation, per whatever behavior doc 11 specifies — but never silently discards the edit as a side effect of an unrelated request.
- A closely related assertion, inherited in spirit from the old blast-radius principle: a partial edit request ("make the hero more compelling") must not cause *any* Section outside its declared target to be touched at all, user-edited or not — this feeds directly into the regression tests in §5.
- This is treated as a **hard-fail regression gate** (§7) given how directly it maps to failure mode 3 in §0.

### 4.4 Hallucination resistance

Prompts that reference Section types, settings, or content that **do not exist** in the fixed Section Library or in a given fixture Store Configuration's actual composition (validated using the hand-authored mutation/adversarial fixtures from §1.4-style variants and deliberately-absent-Section fixture variants):

- Automated checker parses the AI's structured output (any Operation targets, any proposed `type`/setting selections) **and** its natural-language response text, cross-references every named Section type/setting against the ground-truth Section Library (doc 07) and the fixture's actual Store Configuration, and fails the test if the AI asserts or implies the existence of a Section type outside the catalog, or a setting/option outside a given Section's declared contract.
- Expected behavior on a miss: clarify, state plainly that it's not available in the current Section library, or (for generation-time requests) select the nearest real Section instead — never fabricate a `type` string or a setting key that doesn't resolve to anything real.
- Because the entire catalog is fixed and fully known in advance (unlike the old model, where "what does this theme actually contain" was itself something the AI had to reason about from a parsed Manifest), this suite doubles as a check on whether the AI's context assembly (§4.5) is correctly grounding it in the *real* catalog rather than the model's general prior knowledge of "what a Shopify theme section is typically called."

### 4.5 Token usage budget assertions

Per the context-selection strategy defined in doc 12, the context an AI call needs is now bounded by a small, fixed universe (the ~40–60 Section types and their schemas, plus the relevant Product Data) rather than an unbounded, previously-unseen theme Manifest that could itself be arbitrarily large — so the budget itself is expected to be smaller and far less variable call-to-call than the old model, but that expectation is exactly what this suite verifies rather than assumes:

- Assert the assembled context payload for a single generation or edit call stays within the documented per-call token budget, across both context regimes: a **generation-time call**, which plausibly needs awareness of most/all of the catalog to make a good initial selection, and a **targeted edit call**, which needs only the one (or few) Section(s) the request concerns.
- Assert **recall** under budget pressure: for edit-time calls, the Section(s)/setting(s) actually relevant to the prompt's target are present in the selected context in **≥ 99%** of cases; for generation-time calls, the catalog summary provided is sufficient for the AI to reliably reach every Section type at least somewhere across the full test corpus (cross-checked against the selection-bias concern raised in §3.2/§4.2) — a budget-compliant context that quietly makes half the catalog unreachable is a failure, not a pass.

---

## 5. Regression Tests

Purpose: catch any Operation or AI edit, on any fixture Store Configuration, whose blast radius exceeds its declared target.

- **Snapshot-diff harness**: for a given fixture Store Configuration + Operation, capture the full configuration before, execute, capture it after, compute the complete diff, and assert **every** resulting change is rooted under the Operation's declared target (e.g. an Operation targeting Section `id: "hero-1"` may only produce changes under that Section's own settings/blocks; a reorder Operation may additionally touch the owning page's Section-order array, an explicitly whitelisted secondary path per Operation type — anything outside the whitelist fails the test).
- Run this harness for **every Operation type**, against **every fixture Store Configuration**, as a required gate before any Operation executor change ships.
- **Sequence/fuzz mode**: apply long random sequences of valid structural Operations to a fixture Store Configuration, then undo the same number of steps, and assert the final configuration is identical to the starting state — this catches slow state drift and undo/redo bugs that a single-operation test can't see.

---

## 6. Visual / Rendering Tests: LiquidJS preview vs. real Shopify parity

Purpose: this is the direct test of failure mode 2 in §0 — that what the LiquidJS Preview Renderer shows during editing is what actually appears once the Store Configuration is published to a real Shopify store. Given how central this guarantee is to the product's promise, it gets dedicated, specific coverage rather than being folded into general visual regression testing.

### 6.1 What gets compared

For each fixture Store Configuration, render it through **both** paths and compare:

1. **LiquidJS Preview Renderer path**: Store Configuration → LiquidJS `render()` against the Section Library's Liquid templates → HTML, rendered headlessly at three breakpoints — desktop (1440px), tablet (768px), mobile (375px) — matching the Visual Editor's own preview context.
2. **Real Shopify path**: the same Store Configuration applied to the Base Theme on the dedicated dev store (§3.1), fetched live via a headless request/browser at the same three breakpoints.

The comparison runs at two levels:

- **Structural (DOM) comparison** — for each Section, its rendered DOM subtree from path 1 is diffed against its rendered DOM subtree from path 2, keyed by Section id, so any difference is attributable to a specific Section rather than "somewhere on the page." This catches markup-level divergence (wrong element, missing attribute, different applied setting value) cheaply, without needing a full visual render.
- **Visual (perceptual screenshot) comparison** — full-page and per-Section-bounding-box screenshot diffs between the two paths, catching differences a DOM diff wouldn't (CSS resolved differently, a font failing to load, a layout difference from how each path serves static assets).

### 6.2 How differences are triaged

Not every difference between the two paths is a bug — some are expected, and the suite has to classify rather than either blanket-suppress or blanket-fail:

- **Expected/allowed differences**, explicitly allowlisted by known cause and excluded from failing the run: real Shopify-only dynamic state that a local LiquidJS render cannot reproduce (live cart contents/count, live inventory/stock-level text, customer-specific/logged-in content, storefront-selected currency/language), Shopify CDN image URL/transform parameters versus local preview image references, and script tags injected by other apps installed on the dev store. This allowlist is itself reviewed periodically so it can't silently grow to swallow a genuine bug under an "expected difference" label.
- **Unexpected differences** — anything outside that allowlist, at either the structural or visual level — are a **hard fail** and block release, since they mean the preview a merchant edited against does not represent what actually published. Each failure is attributed to the specific Section and fixture Store Configuration responsible, so it's immediately clear whether the issue is in that Section's Liquid template, in a LiquidJS-vs-Shopify-Liquid engine behavioral difference, or in the Store Configuration → template data-binding itself.
- **Known engine incompatibilities**: because LiquidJS is an independent implementation of the Liquid language, it is not guaranteed to be behaviorally byte-identical to Shopify's own Liquid engine on every filter/tag's edge cases. Any such incompatibility discovered through this suite is recorded in a known-incompatibility list maintained alongside the Section Library, and Section templates are authored/reviewed with that list in mind, specifically to avoid constructs known to diverge between the two engines rather than re-discovering the same gap Section by Section.

### 6.3 Handling flakiness and expected-dynamic-state cases

- The dev store's cart and inventory state is reset or seeded to a known fixed state before each comparison run (consistent with the general dev-store reset discipline in §3.1), so that "expected dynamic difference" cases are themselves deterministic — they're allowlisted because their *cause* is understood, not because the suite has learned to shrug at nondeterminism.
- Perceptual screenshot diffing uses a noise tolerance for anti-aliasing/font-rendering jitter, but a **systematic** visual gap between the two rendering contexts (e.g. a webfont that fails to load in one path but not the other) is never waved through under that tolerance just because the pixel delta is individually small — a consistent, explainable divergence is a parity bug regardless of magnitude, since it means the two paths aren't actually equivalent.
- The live-Shopify fetch is retried with backoff for genuine transient network conditions, but a content/structural mismatch is never retried in the hope it resolves itself — a real difference fails immediately, since retrying wouldn't change a genuine parity bug.

### 6.4 Coverage and cadence

- Every Section in the library gets parity coverage at least once, via the **Full-Catalog** fixture (§1.1) — a new Section isn't considered done until its parity comparison passes, gated alongside its own unit/golden-render coverage in §2.1.
- After every Operation type is exercised at least once per representative fixture Store Configuration (a smoke matrix: Operation types × fixture configs, mirroring the old operation-types × themes matrix), both paths are re-rendered and compared.
- The cheaper **structural (DOM) comparison** runs on every CI run touching the Section Library, the LiquidJS renderer, or the Store Configuration schema. The more expensive **full visual/screenshot comparison**, which requires the real dev store, runs nightly and pre-release — the same cadence split the old visual-test design used, for the same reason (cost vs. how quickly a regression needs to surface).

---

## 7. Test Cadence Summary

| Category | Network/LLM required | Runs on |
|---|---|---|
| Unit — Section Library, Store Configuration schema/mutations, Executors, Validation layers | No (mocked) | Every commit |
| Integration — Shopify Admin API (Base Theme install/update, publish) | Yes (real dev store) | Nightly + pre-release |
| Integration — full AI Generation and editing pipeline, end-to-end | Yes (mock or real Shopify, real/recorded LLM, recorded Product fixtures) | Nightly + pre-release |
| AI-specific — ambiguous prompts, section selection, regeneration-preserves-edits, hallucination, token budget | Yes (real LLM) | Every Planner/prompt/model change + nightly |
| Regression — snapshot-diff, fuzz/undo | No (mocked) | Every commit (single-op) / nightly (fuzz sequences) |
| Visual/rendering — LiquidJS vs. real Shopify parity (structural) | Yes (LiquidJS render only) | Every CI run touching Section Library / renderer / schema |
| Visual/rendering — LiquidJS vs. real Shopify parity (full visual) | Yes (render service + real dev store) | Nightly full matrix + pre-release |
| Live Product Import smoke suite (§1.4) | Yes (real third-party sites) | Nightly |

**Non-negotiable release gate:** §2.5 (validation layers), §4.3 (regeneration does not destroy user edits), §4.4 (hallucination resistance), §5 (regression/blast-radius), and §6.1's structural parity comparison must be 100% green — these map directly to the three failure modes in §0 that would break user trust in the core product promise. All other suites have tracked thresholds but are not hard release blockers at v1.
