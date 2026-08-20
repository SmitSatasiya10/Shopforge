# Implementation Roadmap

Seven phases, Phase 0 through Phase 6. Phase 0 and Phase 1 run partly in parallel: a platform/business-
development track (the `write_themes` exemption application) alongside engineering. Only Phase 5 (Publishing)
actually requires `write_themes` access — Phases 1-4 need zero Shopify write access to build and demo end to
end, since the LiquidJS preview never round-trips through Shopify.

## Phase 0 — Technical Validation

**Goal**: De-risk platform and content-production unknowns before implementation begins.

- Submit the `write_themes` exemption application to Shopify, framed around a bounded write surface:
  installing/updating one specific, versioned, first-party Base Theme, never arbitrary edits to a merchant's
  own theme.
- Stand up a Shopify development store and validate theme CLI access as a Phase 5 substrate.
- Confirm the open platform questions directly with Shopify where possible (exemption criteria, Base Theme
  update policy, rate limits) — see [DECISIONS.md](DECISIONS.md) and the "Open Questions" sections throughout
  this folder.
- Begin Section Library content-production planning — a content-production timeline distinct from engineering
  effort.

**Acceptance criteria**: Exemption application submitted; dev store operational; this specification frozen as
the contract for downstream engineering; a content production plan exists for the ~15-20 sections Phase 1
needs.

## Phase 1 — Foundation

**Goal**: Base Theme skeleton, initial Section Library slice, Store Configuration schema, Product Import,
core data model.

- Implement `User`, `Organization`, `OrgMembership`, `Product`, `Project`, `StoreConfigVersion`,
  `SectionDefinition` (see [Data Model](19-data-model.md)).
- Author the initial Section Library slice — each section as its full set of sibling artifacts: Liquid
  template, `{% schema %}`, editor metadata, settings/blocks contract, design spec — each emitting the
  `data-sf-*` DOM metadata contract required for later click-to-select support (see
  [Base Theme and Section Library](02-base-theme-and-section-library.md)).
- Implement Store Configuration CRUD (see [Store Configuration](03-store-configuration.md)).
- Implement Product Import: URL validation, SSRF-safe fetching, scrape parsing, partial-failure handling (see
  [Product Import](05-product-import.md)).
- Basic dashboard shell, without the Visual Editor or AI Generation screens yet.

**Acceptance criteria**: A developer can create a Project, import a product from a supported URL and get back
valid Product data (or a clear partial-failure state), and every section in the initial catalog validates
against the Section/Settings validation categories.

## Phase 2 — Preview

**Goal**: The LiquidJS Preview Renderer, same-origin iframe, responsive preview.

- Implement the resolve-type → load-template → inject-settings/blocks → LiquidJS render → HTML pipeline (see
  [Preview Architecture](06-preview-architecture.md)).
- Implement the same-origin iframe host and its CSS/asset isolation from the builder app chrome (see
  [Preview iframe](08-preview-iframe.md)).
- Decide and implement the Shopify runtime-object stubbing strategy (`shop`, `cart`, `routes`, etc.) that
  section Liquid depends on but that has no real value outside a live Shopify request — settle this here, not
  incrementally per section later.
- Implement responsive viewport simulation (desktop/tablet/mobile).
- Stand up the LiquidJS-vs-real-Shopify structural parity check now, against the Phase 0 dev store, so preview
  drift is caught from the first section onward (see [Preview-to-Shopify Parity](16-preview-shopify-parity.md)).

**Acceptance criteria**: Every section in the current catalog renders correctly via LiquidJS into the iframe
across a fixture Store Configuration set; the structural parity check passes against the dev store for every
section.

## Phase 3 — Editor

**Goal**: Full editor operation catalog, selection, `contentEditable`, undo/redo.

- Implement hover/click-to-select using the `data-sf-*` metadata contract emitted by section Liquid — resolve
  a clicked DOM node back to Page → Section → Block → Setting (see
  [DOM Metadata and Selection](10-dom-metadata-and-selection.md)).
- Implement `contentEditable` write-back into Store Configuration, with sanitization, never persisting raw DOM
  state directly (see [contentEditable](11-contenteditable.md)).
- Implement the React builder shell: structure panel bound to the Store Configuration's pages/sections tree,
  inspector bound to a section's settings contract, selection-outline overlay drawn by React over the iframe
  (see [Visual Editor](09-visual-editor.md)).
- Implement Diff-backed undo/redo — validate the diff/versioning design before AI operations start also
  writing to the same stack in Phase 4 (see [Versioning and Undo/Redo](18-versioning-and-undo-redo.md)).
- Implement the per-section-instance render cache, with test coverage for stale-cache failure modes.

**Acceptance criteria**: A user can perform every editor operation against a live Project and see it reflected
immediately in the preview; undo/redo works cleanly across a sequence of mixed manual edits; click-to-select
correctly resolves for every section in the catalog.

## Phase 4 — AI

**Goal**: AI Store Generation, conversational editing, clarification, provenance-aware regeneration.

- Implement the provider abstraction with one live provider (see [AI Architecture](04-ai-architecture.md)).
- Implement context selection: catalog/keyword lookup against the fixed Section Library, with a lightweight
  embedding fallback scoped narrowly to vague style language only.
- Implement the reuse-vs-generate decision logic (does an existing section/setting already satisfy the
  request) and the full generation pipeline.
- Implement the five-outcome clarification decision table.
- Implement provenance tagging (`ai`/`user` per section and per setting) and the regeneration default that only
  touches `ai`-tagged fields.
- Wire AI-produced operations through the same validation and Diff pipeline already proved out in Phases 1 and
  3 — no separate AI-specific write path.

**Acceptance criteria**: The MVP acceptance scenarios from [MVP Scope](24-mvp-scope.md) §7 pass consistently
across a fixture Product set, not just one hand-picked example.

## Phase 5 — Shopify

**Goal**: OAuth, Base Theme install/update, Store Configuration publish, rollback.

- Implement Shopify OAuth connect and the theme-slot check.
- Implement the Base Theme install flow, with `UNPUBLISHED` role on creation.
- Implement the Base Theme update path for stores that already have an older Base Theme version installed —
  resolve the auto-update-vs-opt-in policy question as part of this phase's design work, not after (see
  [DECISIONS.md](DECISIONS.md) open questions).
- Implement Store-Configuration-to-JSON translation and the publish call sequence.
- Implement publish history and rollback (republish a prior entry).

**Acceptance criteria**: A design-partner merchant's Project, built and edited entirely through Shopforge,
publishes successfully to their real live Shopify store via the Base Theme, is confirmed correct by the
merchant, and rollback is demonstrated at least once against a real store.

## Phase 6 — Hardening

**Goal**: Testing, parity, security, performance, error handling; begin scaling a proven core loop.

- Extend the Section Library on an ongoing content-production cadence toward the full ~40-60 target.
- Extend the provider abstraction to route image-generation calls.
- Implement AI image generation, bulk whole-page regeneration, and the override-user-edits regeneration
  variant on top of the existing operation system.
- Full tiered billing integration against the usage/credit ledger that has existed since MVP.
- Deepen conversational AI editing; broaden the embedding-based fallback if MVP's narrow version proves
  insufficient.

**Acceptance criteria**: The Section Library reaches its full target range; image generation flows through the
same validation/credit pipeline as copy generation; a merchant can self-serve upgrade/downgrade across billing
tiers.

## Explicitly out of this roadmap

Not a later phase — a different, unbuilt product direction:

- Arbitrary existing-theme import/parsing.
- Theme capability detection against an unknown theme.
- Generic arbitrary-theme compatibility.
- AI-generated Liquid/CSS/JS.
- AI modification of a merchant's own pre-existing, non-Shopforge-authored theme files.
