# 24 — Development Roadmap

Ten phases, Phase 0 through Phase 9. Phase 0 and Phase 1 run partly in parallel (business-development exemption application vs. engineering) per doc 16 §10.4 — this is the single most important scheduling decision in this roadmap and is called out explicitly below.

---

## Phase 0 — Research & Platform De-risking

**Features**: None (no user-facing product). Output is: this document set (docs 01–25), a validated architecture-core schema set, and a started Shopify partner relationship.

**Dependencies**: None — this is the current phase, already substantially complete via docs 01–22.

**Technical work**:
- Submit the `write_themes` exemption application to Shopify Partner support (doc 16 §10.4), framed around the safety properties this architecture already specifies (duplicate-first, never touches `MAIN`, full diff/undo).
- Stand up a Shopify development store and validate `theme pull`/CLI access as the Phase 1 engineering substrate (doc 16 §10.4 fallback path).
- Confirm the open questions in doc 16 §11 directly with Shopify where possible (rate limits, exemption criteria, webhook semantics, `files` connection content-inline behavior) — these affect Phase 1/2 API client design.

**Risks**:
- Exemption timeline is unknown and outside our control — this is why Phase 1 engineering is explicitly designed not to depend on it (see Phase 1).
- Some doc 16 open questions may require a live support ticket or partner call to resolve, not just documentation reading.

**Acceptance criteria**: Exemption application submitted; dev store operational with CLI theme pull/push validated; architecture-core.md schemas frozen as the v1 contract for all downstream docs (already done).

---

## Phase 1 — Foundation

**Features**: Auth (email + Shopify OAuth), org/store data model, theme import against the dev-store/local-file path (not yet gated on the exemption), basic dashboard shell (doc 05's IA, minus AI Workspace/Editor).

**Dependencies**: Phase 0's dev store; doc 17's DB schema; doc 18's `/shopify/*` and base `/theme/*` endpoints.

**Technical work**:
- Implement `User`, `Organization`, `OrgMembership`, `ShopifyStore`, `ShopifyInstallation` per doc 17.
- OAuth connect flow (doc 16 §2) including `read_themes` (freely grantable) and requesting `write_themes` (works against the dev store regardless of exemption status, per doc 16 §10.4).
- Theme listing + duplication-as-working-copy (doc 16 §3, §5) against the dev store.
- Basic dashboard shell and navigation per doc 05, without the Editor/AI Workspace screens yet.

**Risks**: None platform-blocking, since this phase deliberately avoids the exemption dependency by building/testing against the dev store.

**Acceptance criteria**: A developer can OAuth-connect the dev store, list its themes, and create a Shopforge working-copy duplicate, all persisted correctly per doc 17's schema.

---

## Phase 2 — Theme Intelligence

**Features**: Theme Parser, Theme Manifest, Theme Model (read-only at this point — no mutation UI yet), capability summary view.

**Dependencies**: Phase 1's imported working-copy themes; docs 07–09.

**Technical work**:
- Build the Parser exactly per doc 07 (three-pass extraction, capability heuristics, vintage-theme rejection).
- Build Manifest storage/versioning per doc 08 (`themeVersionHash`-keyed, immutable rows).
- Build the Model construction step per doc 09, including the full mutation API surface (even though nothing calls it yet except read paths).
- Validate against **multiple real themes**, not just one — doc 21 §1's fixture set (Dawn, Craft, Sense, Colorblock, Studio) exists specifically because capability-flag heuristics that only work on one theme don't prove the "works on a merchant's *actual*, arbitrary theme" claim.

**Risks**: Capability-flag heuristics (doc 07's static rules) may have a higher false-negative rate against unusual/heavily-customized themes than expected — budget time for iterating against the multi-theme fixture set, not just Dawn.

**Acceptance criteria**: For each fixture theme, Parser produces a Manifest whose capability flags a human reviewer agrees are correct; Model construction round-trips (Model → Serializer → re-parse → same Manifest) with no drift.

---

## Phase 3 — Visual Editor

**Features**: Full doc 06 editing operations (section/block settings, add/remove/reorder/duplicate, global styles), editor states (autosave, undo/redo, device preview), doc 19's editor layout (structure panel, canvas, inspector).

**Dependencies**: Phase 2's Model; doc 18's `/editor/*` endpoints; doc 14's Diff system (every editor mutation produces a Diff, even before AI exists).

**Technical work**:
- Implement the mutation-function-to-endpoint mapping from doc 18 (`update-setting`, `add-section`, `move-section`, etc.), each producing Diff entries per doc 14.
- Implement the frontend per doc 19: structure panel bound to `TemplateNode`/`SectionInstance` tree, inspector bound to `SettingDef`s, canvas with device switcher.
- Implement undo/redo over the Diff stack (doc 14 §3) — this validates the diff/versioning design *before* AI operations start also writing to the same stack in Phase 4, which is deliberate sequencing to isolate bugs.

**Risks**: Live preview rendering mechanism is a confirmed doc 16 §8 gap (`[Not found]` — no confirmed server-side Admin API path for a hosted app to generate preview links). This phase's engineering spike must resolve it or fall back to an interim approach (e.g. Shopforge's own server-side Liquid-adjacent render approximation) before the canvas can show a faithful live preview.

**Acceptance criteria**: A user can perform every doc 06 operation against a real imported theme, see it reflected in a live/near-live preview, and undo/redo cleanly across a sequence of mixed edits.

---

## Phase 4 — AI Operations

**Features**: AI chat (doc 10), Operation Planner (doc 11), Clarification System (doc 13), context-selection/token optimization (doc 12) — structural operations only at first (`update_setting`, `move_section`, etc.), matching MVP's narrow generative scope (doc 23 §3).

**Dependencies**: Phase 3's Diff-integrated mutation path (AI operations reuse the exact same mutation functions and Diff stream, per Principle 7); Phase 2's Manifest/Model for context retrieval.

**Technical work**:
- Implement the AI provider abstraction (doc 10) with one live provider.
- Implement context selection (doc 12): keyword extraction → capability index lookup, deferring the embedding-based fallback tier to a later phase.
- Implement the Operation Planner's reuse-vs-generate decision rules (doc 11 §5).
- Implement the 5-outcome Clarification decision table (doc 13).
- Wire AI-produced Operations through the *same* validation (Phase 5, built alongside) and Diff pipeline Phase 3 already proved out.

**Risks**: This is the highest product-risk phase — "does the reuse-vs-generate decision actually work well against real, messy themes" is the core untested hypothesis of the whole product. Budget significant iteration time against the doc 21 §4 AI-specific test suite (ambiguous-prompt accuracy, section-selection accuracy, hallucination resistance) before considering this phase done.

**Acceptance criteria**: The doc 23 §8 MVP acceptance scenarios (hero-background example, ambiguous-header example) pass consistently against the multi-theme fixture set, not just one theme.

---

## Phase 5 — Validation & Safety

**Features**: Full 9-layer validation pipeline (doc 15), snapshot/backup system (doc 14 §2), bounded generative-op scope (`create_section_file` for an allowlisted archetype set, per doc 23 §3).

**Dependencies**: Phase 4's Operations; Phase 3's Diff system.

**Technical work**:
- Implement all 9 validation layers in order, with the hard-block-vs-warning behavior doc 15 specifies per layer.
- Implement `ThemeSnapshot` triggers (pre-destructive, pre-generative, pre-publish) per doc 14 §2.
- Implement the bounded single-retry-then-surface behavior for generative-op validation failures (doc 15's closing section).
- Build the Liquid-syntax validation layer specifically (likely via a theme-check-equivalent tool) — this is new integration work, not a reuse of anything from earlier phases.

**Risks**: Regression validation (any Diff entry outside an Operation's declared scope = hard block) depends on the per-`OperationType` allowed-secondary-effects list from doc 15 being complete; an incomplete list produces false-positive blocks that make the AI look broken even when it isn't. Expect iteration here informed by Phase 4/6 real usage.

**Acceptance criteria**: No operation in the doc 21 regression-test suite passes with an out-of-scope file change; every generative-op validation failure surfaces to the user within one retry, never loops silently.

---

## Phase 6 — Shopify Publishing

**Features**: Preview (resolved from Phase 3's spike), Publish (doc 16 §9), rollback, `PublishHistory`.

**Dependencies**: Phase 0's exemption status (this phase is the first one that *requires* real `write_themes` access against a real, non-dev-store merchant — everything before this can run entirely on the dev store).

**Technical work**:
- Implement `themePublish` flow with async processing awaited before recording `PublishHistory` (doc 16 §9).
- Implement rollback (republish a demoted prior theme — doc 16 §7's inferred design, needs confirmation against live behavior).
- **Gate decision point**: if the exemption from Phase 0 has not landed yet, this phase ships to design-partner merchants via the custom/unlisted-app fallback (doc 16 §10.4) rather than blocking entirely.

**Risks**: This is the phase most exposed to the doc 16 §11 open questions (exact publish-processing timing, rollback mechanism) — treat the first few real-merchant publishes as closely monitored, not routine.

**Acceptance criteria**: A design-partner merchant's working-copy theme, edited via Shopforge, publishes successfully to their real live store and is confirmed correct by the merchant; rollback is demonstrated at least once against a real store.

---

## Phase 7 — AI Image/Copy Generation

**Features**: Grounded AI copywriting and image generation (doc 03 §6.2 Should-haves), tied to real `AssetRef` slots and Manifest content rather than free-floating generation.

**Dependencies**: Phase 4's AI pipeline; Phase 5's validation (generated assets/copy still flow through the same pipeline).

**Technical work**: Extend the provider abstraction (doc 10) to route image-generation calls; extend the Operation system with `update_asset` executions tied to `GeneratedAsset` records (doc 17).

**Risks**: Image generation is the least-differentiated part of the product relative to Dropmagic/Instant (doc 03 §5) — scope conservatively, don't let this phase expand past "parity, grounded."

**Acceptance criteria**: Generated copy/images are traceable to the specific Manifest section/asset slot they targeted, consume credits per doc 22's cost table, and pass validation before being offered to the user.

---

## Phase 8 — CRO Features

**Features**: CRO/upsell suggestions, lightweight A/B testing hooks (doc 03 §6.3 Nice-to-haves), product-URL import as a grounded accelerator (doc 03 §5).

**Dependencies**: A proven core editing loop (Phases 4–6) — doc 03 §6.1 is explicit that this is not the wedge and shouldn't be pulled forward.

**Technical work**: New Operation types or presets built on the existing system (e.g. "add trust badges" as a pre-composed Operation Plan template), not new architecture.

**Risks**: Scope creep risk — CRO is a crowded, well-served category (GemPages Optimize, Shogun's dedicated products, per doc 03). Build only what naturally extends the existing Operation system; don't build a separate CRO subsystem.

**Acceptance criteria**: At least one CRO-oriented multi-step request (e.g. "add social proof near the buy button") produces a correct Operation Plan reusing existing capabilities where present.

---

## Phase 9 — Billing & Scale

**Features**: Full tiered billing (doc 22's Free/Starter/Growth/Agency), multi-provider AI (second provider wired into the Phase 4 abstraction), embedding-based fuzzy capability matching (doc 12's deferred fallback tier), full 4-role permission nuances (doc 18).

**Dependencies**: Everything prior — this phase is explicitly about scaling a proven product, not proving new mechanisms.

**Technical work**: Stripe-equivalent billing integration against the `AIUsageEvent`/`CreditBalance` ledger that's existed since MVP (doc 23 §6); second AI provider config; embedding search infrastructure for the doc 12 semantic-match fallback.

**Risks**: Standard scale risks (cost predictability under real usage, provider outage handling now that a fallback provider matters) — nothing novel to this product specifically.

**Acceptance criteria**: A merchant can self-serve upgrade/downgrade across tiers; usage-based overage handling (doc 22 §5) behaves correctly under real load; a provider outage fails over or degrades gracefully rather than hard-failing the whole AI Workspace.
