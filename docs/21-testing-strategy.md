# 21 — Testing Strategy

## 0. Why this doc exists

Shopforge's entire value proposition rests on a promise Dropmagic cannot make: *we touch your theme as little as possible, and when we do touch it, we tell you exactly what changed and why.* That promise is only as strong as the test suite behind it. Three failure modes would each independently kill trust in the product:

1. The Operation Planner reaches for a **generative** op (`create_section_file`, `modify_liquid`, `modify_css`, `modify_js`) when a **structural** op would have satisfied the request — this silently breaks Principle 3 (minimal AI generation) and burns the merchant's AI credits for nothing.
2. An operation's Diff touches more of the theme than its declared target — this breaks Principle 1 (preserve the existing theme) and Principle 6 (everything is reversible, which only holds if we know exactly what changed).
3. The AI asserts something about the theme that isn't true (a section, setting, or block that doesn't exist in the Manifest) — this breaks Principle 4 (ask instead of guessing) and Principle 10 (imported data is untrusted, so our own model of it must be provably accurate).

Every test category below maps back to one or more of these three failure modes, and ultimately back to the ten Design Principles.

---

## 1. Fixture Theme Set

### 1.1 Composition

Shopforge ships and version-pins a **fixture theme set** of five real, free Shopify (OS 2.0) themes, checked into fixture storage with their `themeVersionHash` recorded:

| Fixture theme | Why it's in the set |
|---|---|
| **Dawn** | Shopify's own reference theme. Canonical section/setting naming, the schema most third-party docs and our own early prototypes were built against. This is our "does the happy path work" baseline — but it must never be the *only* fixture, because it is also the theme most likely to make our parser look correct by accident. |
| **Craft** | Editorial/blog-forward layout, different section-group composition in the header/footer, different block-limit conventions on media-heavy sections. Exercises `sectionGroupRef` and `maxBlocks` edge cases Dawn doesn't have. |
| **Sense** | Minimalist, sparse settings surface per section, unconventional use of `color_scheme` groups. Exercises `supportsColorSchemes` capability derivation on a theme that uses fewer schemes than Dawn. |
| **Colorblock** | Bold, layout-heavy theme with custom CSS custom properties driving most of its visual identity rather than settings. Exercises `cssCustomProperties` extraction and `update_global_style` correctness. |
| **Studio** | Large section count, many snippets shared across sections, heavier use of app-block-compatible regions. Exercises `renderedBySections` fan-out, `isAppBlockCompatible`, and is our largest theme for token-budget and performance tests. |

### 1.2 Why one canonical theme is not enough

Principle 2 ("reuse existing capabilities") is only true in production if the Manifest correctly models *whatever theme the merchant actually installed* — and free Shopify themes disagree with each other constantly: different `sectionId` naming conventions, different setting `id` casing, different presence/absence of section groups, different `maxBlocks`, different reliance on `color_scheme` vs. hard-coded hex, different snippet-sharing patterns. A parser, Operation Planner, or section-selection heuristic that is only ever exercised against Dawn will overfit to Dawn's conventions and silently misbehave — wrong section picked, unnecessary generative op chosen, or a hallucinated capability flag — the moment a merchant imports Craft or a themeforest-style variant. Every test category in §2–§6 below that says "against fixture themes" means **run against all five, not just Dawn**, and any test that only passes on Dawn is treated as a bug in the test, not a pass.

### 1.3 Fixture maintenance

- Fixtures are pinned by `themeVersionHash`; a scheduled job checks upstream Shopify theme releases and opens a PR to bump a fixture only on a deliberate, reviewed cadence (not automatically) — Shopify theme updates can change section schemas and we want that to be a visible, reviewed diff against our golden files, not a silent drift.
- Each fixture theme also gets a small set of **hand-authored mutation variants** (e.g. "Dawn with a wishlist section added by hand," "Craft with a broken/missing `schema.name`") used specifically for parser error-handling and hallucination tests in §4.

---

## 2. Unit Tests

Unit tests are fast, deterministic, run on every commit, and never touch the network (no real Shopify API, no real LLM calls — LLM-touching logic is tested via recorded fixtures/mocks at this layer; live-model behavior is covered separately in §4).

### 2.1 Theme Parser correctness

| What's tested | How |
|---|---|
| Full-tree parse of each of the 5 fixture themes | Golden-file comparison: parse → assert output `ThemeManifest` matches a checked-in expected snapshot (sections, settings, presets, templates, capabilities). Any diff must be explicitly reviewed and re-approved, not silently accepted. |
| OS 2.0 vs. legacy `settings_schema.json` conventions | Parser correctly distinguishes `color_scheme` setting types from hard-coded values across fixtures that use each style. |
| Section-group parsing (`header`/`footer`) | Layout parsing correctly resolves `sectionGroupRef` on themes with and without section groups (Dawn/Studio have them structured differently than a theme that inlines header/footer directly in `theme.liquid`). |
| Malformed / partial input | Missing `schema.name`, invalid JSON in a template file, a section referenced in a template that doesn't exist on disk — parser must fail with a structured, actionable error, never a silent partial Manifest. |
| Locale extraction | `locales[].keys` correctly enumerates keys across nested locale JSON, `isDefault` correctly identified. |
| Asset classification | `assets[].type` correctly bucketed (css/js/image/font/other) across each fixture's real asset folder. |

### 2.2 Manifest generation

| What's tested | How |
|---|---|
| Cache invalidation | Re-parsing an unchanged file tree produces an identical `themeVersionHash` and is a cache hit; a single-byte change to any file changes the hash and triggers regeneration. |
| Manifest diffing | Comparing two Manifests (e.g. before/after a merchant hand-edits a section in the Shopify code editor outside Shopforge) correctly identifies added/removed/changed sections, settings, and templates. |
| Capability derivation — static rules | Each `capabilities` flag (`hasHeroSection`, `hasReviewsSection`, `hasFaqSection`, `hasProductRecommendations`, `hasAnnouncementBar`, `hasUpsellCapability`, `supportsColorSchemes`, `supportsSectionGroups`, …) is asserted true/false against every fixture with a hand-verified expected value table — this is the single highest-leverage test in the whole parser suite, since a wrong capability flag directly causes the Operation Planner to reach for a generative op unnecessarily (Principle 3 violation). |
| Capability derivation — embedding-match path | The embedding-similarity portion of capability derivation (per doc 12) is tested with **mocked, deterministic embeddings** at this layer so results are reproducible; real-embedding accuracy is covered in §4. |

### 2.3 Theme Model mutation functions

Every mutation function in the Theme Model layer (add/remove/move/duplicate section, add/remove/reorder block, update setting, update block setting, update global style, update theme setting, update asset ref) gets a dedicated unit test asserting:

- **Correctness** — the resulting `ThemeModel` reflects exactly the intended change.
- **`instanceId` stability** — an instance's `instanceId` never changes across reorders, edits, or duplication of *other* instances; only `duplicate_section` mints a new one.
- **Schema-bound invariants** — block insertion respects `maxBlocks`; setting updates respect the `SettingDef` type/`options`/`min`/`max`/`step` constraints and are rejected (not silently clamped) if invalid.
- **Ordering invariants** — `TemplateNode.sectionInstances` and `sectionGroups` stay internally consistent after every structural mutation (no orphaned instance IDs, no duplicate positions).
- **Diff emission** — every mutation function emits a correct `DiffEntry` (`kind`, `path`, `before`, `after`, `humanSummary`) as a side effect, since this is the shared mutation path used by both the visual editor and the AI (Principle 7) — a bug here corrupts undo for *both* surfaces at once.

### 2.4 Operation executors (one test class per `OperationType`)

For **all 15** `OperationType` values, a dedicated executor test suite asserts:

- The executor invokes the correct Theme Model mutation function(s) for its `payload` shape.
- The resulting `Diff.entries` are scoped and accurate.
- `requiresNewCode` is `true` **only** for `create_section_file` and `modify_liquid`/`modify_css`/`modify_js`, and `false` for all 11 structural types — this exact boolean is asserted per-type as a standing regression gate, not just spot-checked.
- `riskLevel` defaults match the documented convention (structural → `safe`, generative → `review`; destructive-leaning structural ops like `remove_section` on a section used by multiple templates may escalate — tested explicitly).
- `estimatedCreditCost` is populated per the cost table in doc 22, and is asserted to be effectively zero for all structural types and non-zero for all four generative types.
- **Target-existence guard**: executing any operation whose `target` (instanceId, blockInstanceId, settingId, assetFile) does not exist in the current Manifest/Model is rejected before any mutation is attempted — this is the executor-level half of hallucination resistance (the AI-output half is covered in §4.4).

### 2.5 Validation layers (per doc 15)

Each validation layer that sits between Operation execution and the Theme Serializer gets its own isolated unit suite, fed hand-crafted good/bad Operations and Diffs (not full pipeline runs):

| Layer | Unit-tested by |
|---|---|
| **Schema Conformance** | Feed an `update_setting` with an out-of-range value, a wrong type, or an option not in `SettingDef.options`; feed an `add_block` exceeding `maxBlocks`. All must be rejected pre-mutation. |
| **Liquid/JSON Syntax & Render Validation** | Feed syntactically broken Liquid from a `modify_liquid`/`create_section_file` payload; feed a template JSON that fails to parse. Must be rejected with a specific, line-attributable error — never passed through to Shopify. |
| **Security & Sandboxing (Principle 10)** | Feed payloads containing disallowed Liquid tags/filters, script-injection attempts in generated markup, and asset uploads with mismatched declared vs. actual content type. All rejected. |
| **Regression / Blast-Radius** | Feed a Diff with entries outside the operation's declared target subtree (simulated bad executor output). Must be rejected — this is the unit-level counterpart to the full regression tests in §5. |
| **Manifest-Consistency / Hallucination** | Feed an Operation targeting a `sectionId`/`settingId`/`blockType` absent from the Manifest snapshot passed alongside it. Must be rejected. |

---

## 3. Integration Tests

Slower, real-network, run nightly and pre-release (not on every commit).

### 3.1 Shopify Admin API — theme download / upload / publish

Run against a real Shopify Partner **development store**, dedicated to CI, reset between runs:

- OAuth connect flow end-to-end, including scope verification.
- List themes, download a full theme's file tree via the Admin API, and assert the resulting parse matches parsing the same theme from local fixture storage (catches Admin-API-specific quirks — pagination, asset encoding, rate-limit responses — that local fixture parsing can't).
- Round-trip: download → apply a known Operation Plan → re-upload → re-download → assert the file tree matches the expected post-operation state byte-for-byte (modulo whitespace normalization rules we explicitly allow).
- Publish an `unpublished`/`development` theme as `main`, and roll it back via `ThemeSnapshot` restore; assert the live storefront (fetched via a headless request) reflects each state transition.
- API resilience: rate-limit (429) backoff/retry, 409 asset-conflict handling mid-multi-file-upload, partial-failure recovery (upload fails halfway through a multi-file operation — must not leave the store in a half-written state).

### 3.2 Full AI operation pipeline, end-to-end

A curated corpus of fixture **requests** (natural-language prompt + target fixture theme + expected outcome), run through the real pipeline: Operation Planner → Executor → Validation (all layers from §2.5) → Diff → Theme Serializer → theme file output (against the dev store from §3.1, or a serializer-only mock for the cheaper/faster variant of this suite).

- Asserts the final serialized files render correctly (paired with the visual tests in §6).
- Asserts the full `OperationPlan` (ordered operations + rationale + risk summary) is internally consistent with what actually executed.
- Runs across **all 5 fixture themes** per request template where the request is theme-agnostic (e.g. "make the hero more prominent"), specifically to catch section-selection or capability-derivation regressions that only manifest on non-Dawn schemas.

---

## 4. AI-Specific Tests

This is the category most unique to an AI-driven product, and the one most prone to silent quality drift as prompts/models change. Every suite here is re-run **on every Operation Planner / prompt-template / model-version change**, not just on a schedule.

### 4.1 Ambiguous-prompt suite (clarify vs. execute)

A hand-labeled corpus of prompts, each labeled with the expected outcome — `clarify` or `execute` — per Principle 4 ("ask instead of guessing"):

| Example prompt | Fixture context | Expected outcome |
|---|---|---|
| "Make it pop more" | any | `clarify` — no unambiguous target or action |
| "Change the button color to blue" | theme with one global button style | `execute` — `update_global_style` |
| "Change the button color to blue" | theme with per-section button overrides on 3 different sections | `clarify` — which button(s)? |
| "Add a sale banner" | theme with both an announcement-bar section and a promo-banner section available | `clarify` — which section type? |
| "Move the reviews section above the FAQ" | theme with exactly one reviews and one FAQ section present | `execute` — `move_section` |
| "Add a wishlist feature" | any fixture (no theme has native wishlist) | `clarify` or explicit "not available as a structural change, would require new code" — never silently invented |

Tracked metrics with hard thresholds enforced in CI:
- **False-execution rate** (guessed instead of asking) — target **< 5%**, since an unwanted silent change is the costlier failure mode.
- **False-clarification rate** (asked when it should have just acted) — target **< 15%**, tolerated more loosely since it costs a user round-trip, not theme integrity.

### 4.2 Correct section-selection accuracy

For each fixture theme, a set of descriptive prompts targeting a specific section by natural-language description rather than by name (e.g. "the section right under the header that shows customer reviews"), with a ground-truth expected `instanceId` from that theme's Manifest.

- Measured as **top-1 selection accuracy**, target **≥ 95%** aggregated, but tracked **per fixture theme individually** — a suite that scores 99% on Dawn and 80% on Craft is a fail, since it reveals overfitting to Dawn's naming conventions rather than genuine semantic selection.

### 4.3 "Minimal modification" assertions

A labeled corpus of requests known to be satisfiable purely structurally (recolor, retext an existing setting, reorder, add/remove an existing section or preset, resize/toggle visibility). For every request in this corpus:

- Assert the Operation Planner **never** emits `requiresNewCode: true`.
- Assert the Operation Planner **never** selects one of `create_section_file` / `modify_liquid` / `modify_css` / `modify_js`.

This is treated as a **hard-fail regression gate** — any single violation blocks the change from shipping, because it directly represents burning a merchant's AI credits and touching raw Liquid when it was never necessary (Principle 3).

### 4.4 Hallucination resistance

Prompts that reference sections, settings, or blocks that **do not exist** in the given fixture theme's Manifest (validated using the hand-authored mutation variants from §1.3 — e.g. "Dawn without its testimonials section," so we know for certain it's absent):

- Automated checker parses the AI's structured output (any Operation targets) **and** its natural-language response text, cross-references every named section/setting/block against the ground-truth Manifest, and fails the test if the AI asserts or implies existence of anything not present.
- Expected behavior on a miss: clarify, say it's not available, or propose a generative option explicitly — never state or imply the capability already exists.
- This suite is run against all 5 fixtures plus their mutation variants, since hallucination risk is highest on the more sparse fixtures (Sense) where the AI has less context to ground itself.

### 4.5 Token usage budget assertions

Per the context-selection strategy defined in doc 12, for every fixture theme (including Studio, our largest and therefore worst-case fixture) and a representative prompt set:

- Assert the assembled context payload for a single planning call stays within the documented per-call token budget.
- Assert **recall** under budget pressure: the section(s)/setting(s) actually relevant to the prompt's target are present in the selected context in **≥ 99%** of cases, even when the full Manifest for that theme would exceed budget and had to be truncated/summarized — a budget-compliant context that drops the one thing the user is actually asking about is a failure, not a pass.

---

## 5. Regression Tests

Purpose: catch any operation, on any theme, whose blast radius exceeds its declared target — the automated enforcement of Principle 1.

- **Snapshot-diff harness**: for a given fixture theme + Operation, capture the full `ThemeModel` before, execute, capture the full `ThemeModel` after, compute the complete diff, and assert **every** resulting `DiffEntry.path` is rooted under the operation's declared target subtree (e.g. an operation targeting `instanceId: "hero-1"` may only produce entries under `sections.hero-1.*`; a `move_section` may additionally touch the owning `TemplateNode.sectionInstances` ordering array, which is an explicitly whitelisted secondary path per operation type — anything outside the whitelist fails the test).
- Run this harness for **every `OperationType`**, against **every fixture theme**, as a required gate before any Operation executor change ships.
- **Sequence/fuzz mode**: apply long random sequences of valid operations (structural-only, to keep it deterministic and fast) to a fixture theme, then undo the same number of steps, and assert the final serialized file tree is byte-identical to the starting state — this catches slow state drift and undo/redo bugs that a single-operation test can't see.

---

## 6. Visual / Rendering Tests

Purpose: catch changes that are invisible at the model/diff level but visible on the actual storefront — CSS cascade effects, shared-snippet side effects, and cross-breakpoint regressions.

- For each of the 5 fixture themes, render a live preview at three breakpoints — **desktop (1440px)**, **tablet (768px)**, **mobile (375px)** — via headless browser against the preview URL, and capture a baseline screenshot per template (index, product, collection, cart, at minimum).
- After every operation type is exercised at least once per fixture theme (a smoke matrix: 15 operation types × 5 themes, generative types only for themes/sections where applicable), re-render and perceptually diff against baseline.
- Diffs are evaluated against two thresholds:
  1. **Inside** the operation's target section bounding box — a visual change is *expected* and is compared against an approved "after" reference, not flagged as a regression.
  2. **Outside** the target section bounding box — any perceptible diff above a small noise tolerance (accounting for anti-aliasing/font-rendering jitter) is a **hard fail**, since it means a change leaked outside its declared scope visually even if the Diff schema said otherwise (e.g. a CSS custom property change cascading further than intended).
- Run nightly across the full matrix; run the specific affected subset synchronously in CI for any change touching the Serializer, global styles, or CSS-generation paths.

---

## 7. Test Cadence Summary

| Category | Network/LLM required | Runs on |
|---|---|---|
| Unit — Parser, Manifest, Model, Executors, Validation layers | No (mocked) | Every commit |
| Integration — Shopify Admin API | Yes (real dev store) | Nightly + pre-release |
| Integration — full AI pipeline end-to-end | Yes (mock or real Shopify, real/recorded LLM) | Nightly + pre-release |
| AI-specific — ambiguous prompts, section selection, minimal-mod, hallucination, token budget | Yes (real LLM) | Every Planner/prompt/model change + nightly |
| Regression — snapshot-diff, fuzz/undo | No (mocked) | Every commit (single-op) / nightly (fuzz sequences) |
| Visual/rendering | Yes (render service) | Nightly full matrix + CI for Serializer/style-path changes |

**Non-negotiable release gate:** §4.3 (minimal-modification), §4.4 (hallucination resistance), and §5 (regression/blast-radius) must be 100% green — these three map directly to the three failure modes in §0 that would break user trust in the core product promise. All other suites have tracked thresholds but are not hard release blockers at v1.
