# Phase 04 — Store Configuration

## Objective

Define the JSON document that becomes the single source of truth for the entire system — the shape every other
subsystem (AI, editor, preview, and eventually the publisher) reads and writes, and nothing else.

## Scope

- The Store Configuration schema: `pages -> sections[] -> {id, type, settings, blocks}`, matching
  [`docs/product-spec/03-store-configuration.md`](../product-spec/03-store-configuration.md) and
  [`docs/product-spec/DECISIONS.md`](../product-spec/DECISIONS.md) decision #1 exactly — this shape is binding,
  not a starting draft.
- Schema version field, section ordering (array position), section identity (`SectionInstance.id`, stable,
  never reused) vs. section type (`SectionInstance.type`, a Section Library reference).
- `GlobalSettings` (colors, typography, buttons).
- `SettingValue` shapes, including the two reference types: `ProductRef` and `AssetRef`.
- Defaults: an instance missing a setting value falls back to that setting's schema default (this is what makes
  Section Library changes backward-compatible — see Phase 08).
- Validation of the configuration shape itself (structural — "is this valid JSON matching the schema," distinct
  from the deeper per-setting/per-section validation layers introduced properly in Phase 09/13).
- Serialization and a minimal persistence boundary: a Store Configuration can be saved and reloaded, byte-for-
  byte equivalent, without yet building the full versioning/lineage model (that's Phase 10).
- Deterministic initial-configuration generation from a Normalized Product Contract (Phase 03's output) — no AI
  involved yet, per
  [`docs/product-spec/DECISIONS.md`](../product-spec/DECISIONS.md) and the "build incrementally" principle.

## Out of Scope

- `StoreConfigVersion` lineage, `lockVersion` optimistic concurrency, `Diff`/`Operation` history — Phase 04
  needs a Store Configuration to exist and persist, not the full versioned/undoable model. Phase 07 introduces
  session-level undo/redo; Phase 10 formalizes durable versioning at scale.
- AI-driven generation (Phase 09) — this phase's generator is deterministic and rule-based only.
- Publishing/Shopify-format conversion (Phase 12).
- The Section Library itself (Phase 08) — Phase 04 only needs a small fixed set of section types to prove the
  schema works; it does not own section definitions.

## Architecture

```text
AI (Phase 09) --\
Editor (Phase 07) --> Store Configuration (this phase) --> Preview (Phase 06)
Publisher (Phase 12) --/
```

No system in this diagram is allowed a private write path or a private render path — every one of them reads
and writes this exact JSON shape. No system should ever treat rendered HTML as the source of truth (a
recurring rule enforced by every later phase's Architecture section too).

## Inputs

A Normalized Product Contract (Phase 03), used only to seed the initial configuration's section settings
deterministically.

## Outputs

A Store Configuration instance: valid against its schema, serializable, persistable, and reloadable unchanged.

## Dependencies

Phase 03 (normalized product data to seed initial settings). Does not depend on Phase 05/06 — the schema and
its validation can be fully built and tested without a Base Theme or a renderer existing yet (see Testing
below).

## Implementation Areas

- Store Configuration TypeScript types/schema (whichever validation library the Foundation phase established).
- `PageConfig` per page type (`product` first, matching the MVP's product-import-driven flow;
  `home`/`collection`/`about` follow as Phase 08 grows the section catalog and page coverage).
- `SectionInstance`/`BlockInstance` structures.
- Deterministic initial-configuration generator (Normalized Product Contract → Store Configuration), with a
  fixed, predictable section order — no randomness, no AI.
- Structural validator (schema conformance only at this phase).
- A minimal persistence read/write path (can reuse Phase 01's Postgres connection directly; does not need the
  full entity model from Phase 10 yet).

## Data Contracts

```text
StoreConfiguration {
  version: number
  pages: {
    [pageKey: string]: {
      pageType: "home" | "product" | "collection" | "about" | "custom"
      slug?: string
      sections: SectionInstance[]
    }
  }
  globalSettings: GlobalSettings
}

SectionInstance {
  id: string          // stable identity, never reused
  type: string         // Section Library reference (Phase 08)
  settings: { [settingId: string]: SettingValue }
  blocks?: BlockInstance[]
  visibility?: { desktop: boolean, tablet: boolean, mobile: boolean }
  disabled?: boolean
}

BlockInstance { id: string, type: string, settings: { [settingId: string]: SettingValue } }

SettingValue = string | number | boolean
  | { productId: string, handle: string, source: "scraped" | "shopify" }   // ProductRef
  | { url: string, alt?: string, source: "ai-generated" | "scraped" | "stock" | "user-uploaded" }  // AssetRef
```

Full authoritative definition:
[`docs/product-spec/03-store-configuration.md`](../product-spec/03-store-configuration.md).

## User Flow

No new user-facing screen — this phase is invisible infrastructure that Phase 06 (preview) and Phase 07
(editor) render/manipulate. The only observable behavior at this phase's completion is that an imported product
(Phase 02/03) deterministically produces a valid Store Configuration.

## Error Handling

- An invalid Store Configuration (fails structural schema validation) is rejected at the write boundary — hard
  block, never partially applied, matching the severity model in
  [`docs/product-spec/17-validation-and-error-handling.md`](../product-spec/17-validation-and-error-handling.md).
- Generating an initial configuration from a Normalized Product Contract with missing fields (Phase 03's
  partial-import case) must still produce a valid, renderable configuration — missing product data becomes
  empty/default section settings, not a generation failure.

## Testing

- Schema validation unit tests: valid configuration passes; each category of structural violation (missing
  required field, wrong type, duplicate section id) is rejected.
- Deterministic-generation unit tests: the same Normalized Product Contract always produces the same
  configuration (no hidden randomness), and a sparse/partial product still produces a valid configuration.
- Serialization round-trip test: configuration → persisted → reloaded → structurally identical.
- These tests do not require LiquidJS or the Base Theme to exist yet — that's the point of sequencing this
  phase before Phase 05/06.

## Completion Criteria

- The Store Configuration schema is implemented, documented in code (types), and validated.
- A real imported product (from Phase 02/03, including the sample product) deterministically produces a valid
  initial Store Configuration.
- A configuration can be persisted and reloaded with no data loss.
- No AI code exists in this phase.

## Next Phase

[05 — Base Theme Runtime](05-base-theme-runtime.md) can be built in parallel with this phase (see
[`00-phase-overview.md`](00-phase-overview.md)'s dependency graph) — both converge at
[06 — LiquidJS Preview](06-liquidjs-preview.md), which needs a Store Configuration (this phase) and a Base
Theme (Phase 05) to render.
