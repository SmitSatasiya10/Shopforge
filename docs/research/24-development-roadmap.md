# 24 — Development Roadmap

Seven phases, Phase 0 through Phase 6. Phase 0 and Phase 1 run partly in parallel (business-development exemption application vs. engineering) per doc 16 §8.4 — this is still the single most important scheduling decision in this roadmap, and it is *more* favorable now than under the old plan: the new architecture's preview loop (Phases 1–4) needs **zero** Shopify write access to build and demo end to end, since the LiquidJS Preview Renderer never round-trips through Shopify (doc 09, doc 16 §6). Only Phase 5 (Publishing) actually requires `write_themes`.

---

## Phase 0 — Research & Platform De-risking

**Features**: None (no user-facing product). Output is: this document set (docs 01–26), a frozen v1 schema contract (Section, Store Configuration, Operation, Diff — docs 07/08/11/14), and a started Shopify partner relationship.

**Dependencies**: None — this is the current phase, substantially complete via docs 01–22 and this rewrite pass (docs 01–26).

**Technical work**:
- Submit the `write_themes` exemption application to Shopify Partner support (doc 16 §8.4), framed around the new, narrower write surface: installing/updating one specific, versioned, first-party Base Theme, never arbitrary edits to a merchant's own theme — doc 16 §8.2 argues this is an easier case to make than the old "editing an unknown merchant theme" framing was.
- Stand up a Shopify development store and validate `theme pull`/CLI access as a Phase 5 engineering substrate (doc 16 §8.4 fallback path) — not needed before Phase 5, but worth having ready.
- Confirm the open questions in doc 26 directly with Shopify/internally where possible (exemption criteria, Base Theme update policy, rate limits) — these affect Phase 5's design, not earlier phases.
- Begin Section Library content production planning (doc 07 §3's category breakdown) — this is now a genuine content-production project with its own timeline, not purely an engineering task, and should start in parallel with engineering rather than being treated as a Phase 1 afterthought.

**Risks**:
- Exemption timeline is unknown and outside our control — this is why Phases 1–4 are explicitly designed not to depend on it.
- Section Library authorship throughput is a new, real risk this document set didn't previously name explicitly: producing well-designed, schema-clean, on-brand Liquid sections at the pace this roadmap assumes is a design + engineering effort, not just engineering.

**Acceptance criteria**: Exemption application submitted; dev store operational; docs 01–26 frozen as the v1 contract for all downstream engineering; Section Library production plan exists for the ~15–20 sections Phase 1 needs.

---

## Phase 1 — Foundation

**Features**: Base Theme skeleton, an initial Section Library slice (per doc 23 §2: header, footer, hero, image banner, rich text, product grid, featured product, product info/gallery, testimonials, FAQ, CTA banner, newsletter, about), Store Configuration schema + persistence, Product Import against a narrow allowlisted source set, auth/org data model, basic dashboard shell (doc 05 minus the Visual Editor).

**Dependencies**: None blocking — this phase deliberately needs no Shopify write access at all.

**Technical work**:
- Implement `User`, `Organization`, `OrgMembership`, `Product`, `Project`, `StoreConfigVersion`, `SectionDefinition` per doc 17.
- Author the initial Section Library slice: for each section, the five sibling artifacts doc 07 §2 specifies (Liquid template, `{% schema %}`, editor metadata, settings/blocks contract, design spec), each emitting the `data-sf-*` DOM metadata contract doc 09 §6 requires for later click-to-select support.
- Implement Store Configuration CRUD per doc 08, backed by doc 17's `StoreConfigVersion`.
- Implement Product Import: URL validation, SSRF-safe fetching (doc 20's Product Import threat model), scrape parsing into `Product`, partial-failure handling (doc 17 §6's `importStatus`/`importedFieldsMissing`).
- Basic dashboard shell per doc 05 (`Organization → Project → {…}`), without the Visual Editor or AI Generation screens yet.

**Risks**: Section Library authorship throughput (carried over from Phase 0) is the dominant risk here — budget real design/content time, not just engineering time. Product Import reliability varies by source site; expect the allowlisted-source approach (doc 23 §2) to need iteration as real URLs are tested.

**Acceptance criteria**: A developer can create a `Project`, import a product from a supported URL and get back valid `Product` data (or a clear partial-failure state), and every section in the initial catalog validates against doc 15's Section/Settings validation categories.

---

## Phase 2 — LiquidJS Preview

**Features**: The LiquidJS Preview Renderer (doc 09), section Liquid loading, HTML generation, same-origin iframe hosting, preview styling isolation, responsive/device-viewport preview.

**Dependencies**: Phase 1's Section Library and Store Configuration.

**Technical work**:
- Implement the resolve-type → load-template → inject-settings/blocks → LiquidJS `render()` → HTML pipeline per doc 09 §2–§3.
- Implement the same-origin iframe host and its CSS/asset isolation from the builder app chrome (doc 09 §4, doc 20 §20.7).
- Decide and implement the Shopify runtime-object stubbing strategy (`shop`, `cart`, `routes`, etc.) that section Liquid depends on but that has no real value outside a live Shopify request — this is foundational for every section author from this point forward, so get it settled here, not incrementally per-section later.
- Implement responsive viewport simulation (desktop/tablet/mobile).
- Stand up doc 21 §6's LiquidJS-vs-real-Shopify structural parity check now, against the dev store from Phase 0, so preview drift is caught from the first section onward rather than discovered at Phase 5.

**Risks**: Preview-vs-Shopify parity gaps around the stubbed runtime objects are the main technical risk — an incomplete or inaccurate stub set produces sections that preview correctly but render differently (or error) on real Shopify. This is exactly why the parity harness is pulled into this phase instead of deferred.

**Acceptance criteria**: Every section in the current catalog renders correctly via LiquidJS into the iframe across doc 21 §1's fixture Store Configuration set; the structural parity check passes against the dev store for every section.

---

## Phase 3 — Visual Editor

**Features**: Full doc 06 operation catalog (section/block/setting editing, add/remove/duplicate/reorder section, global styles), doc 09's click-to-select and hover-detection interaction layer, `contentEditable` text editing, Diff-backed undo/redo, doc 19's editor shell (structure panel, canvas, inspector, AI panel placeholder).

**Dependencies**: Phase 2's preview iframe — the editor is built directly on top of it, not alongside it.

**Technical work**:
- Implement hover/click-to-select using the `data-sf-*` metadata contract emitted by section Liquid (doc 09 §6) — resolve a clicked DOM node back to Page → Section → Block → Setting.
- Implement `contentEditable` write-back into Store Configuration (doc 09 §7, doc 20 §20.7's sanitization requirement), never persisting raw DOM state directly.
- Implement the React builder shell per doc 19: structure panel bound to the Store Configuration's `pages`/`sections` tree, inspector bound to a section's settings contract (doc 08 §5), selection-outline overlay drawn by React over the iframe (doc 19 §19.4.4's stated decision).
- Implement Diff-backed undo/redo (doc 14 §3) — this validates the diff/versioning design *before* AI operations start also writing to the same stack in Phase 4, deliberately isolating bugs the same way the old plan did.
- Implement the per-section-instance render-cache doc 19 §19.5.1 specifies, with test coverage for the stale-cache failure class it flagged as new.

**Risks**: doc 09 §6.3 flagged several genuinely undecided interaction questions — ambiguous/overlapping click-target disambiguation, keyboard-accessible selection, mid-edit `contentEditable` selection behavior (also tracked in doc 26). Resolve these as real design work in this phase; don't let them surface as production bugs.

**Acceptance criteria**: A user can perform every doc 06 operation against a live `Project` and see it reflected immediately in the preview; undo/redo works cleanly across a sequence of mixed manual edits; click-to-select correctly resolves for every section in the catalog.

---

## Phase 4 — AI Generation

**Features**: AI provider abstraction (doc 10) with one live provider, Flow A — AI Store Generation (doc 11 §4: section selection → ordering → settings → copy → Store Configuration), Flow B — conversational editing (doc 11 §6–§7), context selection (doc 12), the 5-outcome Clarification system (doc 13), provenance-aware safe regeneration (doc 11 §9).

**Dependencies**: Phase 3's Diff-integrated mutation path — AI operations reuse the exact same `Operation` → `Diff` mechanism manual edits already proved out; Phase 1's Section Library/catalog, which is what the AI selects from and is scoped by.

**Technical work**:
- Implement the provider abstraction (doc 10) with one live provider.
- Implement context selection per doc 12: catalog/keyword lookup against the fixed Section Library, with the lightweight embedding fallback doc 12 scoped narrowly to vague style language only — not a full semantic-search tier.
- Implement doc 11 §8's decision logic (does an existing section/setting already satisfy the request) and §4's full generation pipeline.
- Implement doc 13's 5-outcome clarification decision table.
- Implement doc 11 §9's provenance tagging (`ai`/`user` per section and per setting) and the regeneration default that only touches `ai`-tagged fields.
- Wire AI-produced Operations through the same validation (Phase 1's pipeline, doc 15) and Diff pipeline (Phase 3) already proved out — no separate AI-specific write path.

**Risks**: This is now the highest product-risk phase, but the risk itself has changed shape from the old plan. The old risk was "does the reuse-vs-generate decision hold up against messy, unknown themes" — that problem doesn't exist anymore. The new risk is squarely about **generation quality**: does AI-selected section ordering and AI-authored settings/copy actually produce a credible, on-brand store from real, varied product data? Budget significant iteration against doc 21 §4's AI-specific test suite (hallucination resistance, regeneration-preserves-user-edits, section-selection accuracy) before considering this phase done.

**Acceptance criteria**: doc 23 §8's MVP acceptance scenarios (full generation from a product URL, a single well-scoped conversational edit, an ambiguous request, a regeneration-preserves-edits case) pass consistently across doc 21 §1's fixture Product set, not just one hand-picked example.

---

## Phase 5 — Shopify Publishing

**Features**: Shopify OAuth connect (doc 16 §2), theme-slot check (doc 16 §3), Base Theme install/update (doc 16 §4), Store Configuration publish (doc 16 §5/§7), rollback (doc 16 §7/`PublishHistory`).

**Dependencies**: Phase 0's exemption status — this is the *first* phase that requires real `write_themes` access against a non-dev-store merchant. Everything in Phases 1–4 runs entirely without it, since preview and editing never touch Shopify.

**Technical work**:
- Implement the `themeCreate`-from-our-own-source install flow (doc 16 §4) with `role: UNPUBLISHED` on creation.
- Implement the Base Theme update path for stores that already have an older Base Theme version installed (doc 16 §4.4) — resolve the auto-update-vs-opt-in policy question flagged there and in doc 26 as part of this phase's design work, not after.
- Implement Store-Configuration-to-JSON translation (section order/settings templates) plus `themeFilesUpsert`/`themePublish` (doc 16 §5/§7).
- Implement `PublishHistory` and rollback (republish a prior entry).

**Risks**: This phase is the first to touch a real merchant's live storefront — treat the first several real-merchant publishes as closely monitored, not routine. The Base Theme update/migration policy (doc 16 §9, doc 26) is a real open design question that needs resolving here, since real published stores start accumulating version drift the moment this phase ships.

**Acceptance criteria**: A design-partner merchant's `Project`, built and edited entirely through Shopforge, publishes successfully to their real live Shopify store via our Base Theme, is confirmed correct by the merchant, and rollback is demonstrated at least once against a real store.

---

## Phase 6 — Advanced Features

**Features**: Section Library expansion toward the full ~40–60 target (doc 07 §3), deeper conversational AI editing, `generate_image` (image generation/enhancement), bulk `regenerate_page` and the `overrideUserEdits` regeneration variant (doc 11 §3.3/§9), CRO optimization, analytics, A/B testing, additional Shopify integrations, full tiered billing (doc 22 §1), multi-provider AI, and doc 12's fuller embedding-based fallback if MVP's narrow version proves insufficient.

**Dependencies**: A proven core loop (Phases 1–5) — this phase is explicitly about scaling and broadening a proven product, not proving new mechanisms.

**Technical work**: Extend the Section Library on an ongoing content-production cadence; extend the provider abstraction (doc 10) to route image-generation calls, tied to `GeneratedAsset` records (doc 17 §16); implement `generate_image`/`regenerate_page`/`overrideUserEdits` on top of the existing Operation system rather than new architecture; Stripe-equivalent billing integration against the `AIUsageEvent`/`CreditBalance` ledger that's existed since MVP.

**Risks**: Scope creep — CRO/analytics is a crowded, well-served category (doc 03's competitor research); build only what naturally extends the existing Operation system, don't build a separate CRO subsystem. Image generation is one of the least-differentiated capabilities relative to competitors (doc 03 §5) — scope conservatively.

**Acceptance criteria**: The Section Library reaches its full target range; at least one CRO-oriented request produces a correct Operation Plan reusing existing capabilities; image generation flows through the same validation/credit pipeline as copy generation; a merchant can self-serve upgrade/downgrade across billing tiers.

---

## Future / Out of scope for this roadmap entirely

Not a later phase — a different, unbuilt product direction, tracked only as the Future / Advanced Architecture appendices in docs 07, 09, 11, and 15:

- Arbitrary existing-theme import/parsing
- Theme capability detection against an unknown theme
- Generic arbitrary-theme compatibility
- AI-generated Liquid/CSS/JS
- AI modification of a merchant's own pre-existing, non-Shopforge-authored theme files
