# Phase 08 — Section Library

## Objective

Grow the first-party section catalog from the small starter set (Phase 05/06/07) into the MVP slice, and
establish the process by which the library grows safely past that without ever breaking an already-published
store.

## Scope

- The full five-artifact section shape:
  Liquid template, embedded `{% schema %}` (generated, not hand-written), `editor.meta.json`, `contract.json`
  (the Shared Settings Contract — `SettingDef[]`/`BlockDef[]`/`PresetDef[]`), `design-spec.md` — per
  [`docs/product-spec/02-base-theme-and-section-library.md`](../product-spec/02-base-theme-and-section-library.md)
  §2.2.
- `catalog.json` generation: aggregates every section's type, category, status, `contractVersion`, and contract
  into one document, read by AI context assembly (Phase 09) and the editor's "add section" picker.
- Engineering review + design review process for every section change (§3 of that document) — this phase
  establishes the process, not just the first batch of sections.
- The MVP slice: ~15-20 sections sufficient to build a homepage and a product page (header/footer, hero, image
  banner, rich text, product grid, featured product, product information, product gallery, testimonials/
  reviews, FAQ, CTA banner, newsletter, about) — per
  [`docs/product-spec/24-mvp-scope.md`](../product-spec/24-mvp-scope.md).
- The contract-immutability rule that makes the library safe to grow: a published type slug's settings shape
  never changes shape — backward-compatible changes publish in place with a `contractVersion` bump, breaking
  changes ship as a new type slug (`hero` → `hero-v2`), and a deprecated slug is never deleted or rendered
  unable to work, per §5 of the same document.

## Out of Scope

- The full ~40-60 section target — ships on an ongoing post-MVP content-production cadence, explicitly not
  blocking MVP.
- AI authoring or modifying any section's Liquid/schema/contract — permanently out of scope, not deferred (see
  [`docs/product-spec/DECISIONS.md`](../product-spec/DECISIONS.md) #4).
- Any section-selection logic — that belongs to Phase 09 (AI) and Phase 07 (editor's "add section" picker),
  both of which are consumers of `catalog.json`, not owners of it.

## Architecture

```text
Proposal -> Design spec -> Contract (SettingDef[]/BlockDef[]/PresetDef[]) -> Liquid implementation
(schema generated from contract) -> Editor metadata -> Review (engineering + design) ->
Merge -> catalog.json regenerated (status: "active", contractVersion: "1.0.0")
```

`catalog.json` is the one artifact most other systems need to know about — AI context assembly and the editor's
picker both read it live (or from a short-TTL cache), never a per-store cached copy, so a new section becomes
usable immediately after merge. Neither the AI nor the editor ever reads a `.liquid` file directly.

## Inputs

The starter section set from Phase 05/06/07 (retrofitted into the full five-artifact shape) plus new sections
authored to reach the MVP slice.

## Outputs

A populated `section-library/` with the MVP slice of sections, each complete across all five artifacts, plus a
generated `catalog.json`.

## Dependencies

Phase 05 (Base Theme loader must resolve whatever this phase adds), Phase 06 (every new section must render
correctly through LiquidJS, including parity coverage), Phase 07 (every new section's settings must work
through the editor's settings panel and, where applicable, `contentEditable`).

## Implementation Areas

- `generate-schema.ts`-equivalent: compiles each `contract.json` into its section's embedded `{% schema %}`
  block — the schema is never hand-maintained separately from the contract.
- `generate-catalog.ts`-equivalent: rebuilds `catalog.json` from every section's `contract.json` +
  `editor.meta.json`.
- Section-by-section authoring toward the MVP slice, each going through the proposal → design spec → contract →
  implementation → editor metadata → review pipeline above.
- Filter/tag coverage checklist per new section against Phase 05's compatibility layer (confirm before use, per
  that phase's rule) as part of engineering review.
- Structural (DOM) parity check per section (Phase 06 started this on the first section; this phase is where it
  becomes a per-section checklist item, not an afterthought).

## Data Contracts

```text
SettingDef { id, type, label, default?, options?, min?, max?, step?, unit? }
BlockDef { type, name, settings: SettingDef[], limit? }
PresetDef { name, settings: object, blocks: { type, settings }[] }
```

Full authoritative shape:
[`docs/product-spec/12-shared-section-contract.md`](../product-spec/12-shared-section-contract.md). A section's
`type` slug is its immutable primary key once published — the Liquid filename stem, the value every
`SectionInstance.type` references, and the key the Preview Renderer resolves.

## User Flow

No new end-user flow beyond what Phase 07 already built — the editor's "add section" picker (if built in Phase
07 or here) now offers a real, growing catalog instead of a hardcoded handful, and imported products can now
seed a fuller homepage/product page from Phase 04's deterministic generator.

## Error Handling

- A section merged without both engineering and design review sign-off is a process violation this phase's
  workflow must prevent, not just discourage.
- A breaking contract change made in place (rather than as a new type slug) is the specific failure mode this
  phase's immutability rule exists to prevent — any tooling built here should make it hard to do accidentally
  (e.g., a check comparing a `contract.json` diff against its previous `contractVersion` for a shape-breaking
  change under a non-major version bump).
- A section referencing an unshimmed Shopify filter/tag must fail review, not ship and silently misrender (the
  same silent-failure risk from Phase 06, now enforced per-section at review time).

## Testing

- Golden-file HTML snapshot tests per section across a representative range of settings values, per
  [`docs/product-spec/23-testing-strategy.md`](../product-spec/23-testing-strategy.md).
- Schema well-formedness tests (the generated `{% schema %}` matches its source `contract.json`).
- Defensive out-of-schema handling tests (a section given a setting value outside its declared range/options
  doesn't crash the render).
- Block-limit tests where a section defines `BlockDef.limit`.
- Structural DOM parity test per section against a real Shopify dev-store render — part of the non-negotiable
  release gate from Phase 06, now required for every section in the MVP slice, not just the starter set.
- A `contractVersion` immutability test: attempting to change an existing type's contract shape without bumping
  to a new type slug is caught.

## Completion Criteria

- The MVP slice (~15-20 sections) exists, each complete across all five artifacts.
- `catalog.json` accurately reflects every section, and is what the editor's picker and AI context assembly
  actually read (not a hardcoded list).
- Every section in the MVP slice passes structural parity comparison.
- The contract-immutability process is enforced by tooling or checklist, not only by documentation.

## Next Phase

[09 — AI Generation](09-ai-generation.md) reads `catalog.json` to ground what sections it's allowed to select
and configure — AI generation cannot meaningfully start until this phase's catalog is real.
