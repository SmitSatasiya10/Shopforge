# Phase 07 — Preview Editor

## Objective

Let a user select a section inside the live preview, edit its settings or content, and see the change reflected
immediately — completing the core prototype's vertical slice.

## Scope

- React builder chrome: structure/section navigator, the preview iframe, an inspector/settings panel — per
  [`docs/product-spec/09-visual-editor.md`](../product-spec/09-visual-editor.md).
- Click/hover selection resolved through `data-sf-*` DOM metadata (emitted by each section's own Liquid
  template, per [`docs/product-spec/10-dom-metadata-and-selection.md`](../product-spec/10-dom-metadata-and-selection.md)):
  `data-sf-page`, `data-sf-section-id`, `data-sf-section-type`, `data-sf-block-id`, `data-sf-setting`,
  `data-sf-editable`.
- Settings panel: structural/style setting changes (`set_setting`-equivalent), applied to the Store
  Configuration, triggering Phase 06's rerender.
- `contentEditable` interaction for text/richtext fields: DOM edit → on-commit extraction of the string value
  only → write to the resolved Store Configuration setting path → rerender. The DOM itself is never persisted,
  per [`docs/product-spec/11-contenteditable.md`](../product-spec/11-contenteditable.md) and
  [`docs/product-spec/DECISIONS.md`](../product-spec/DECISIONS.md) #10.
- Session-level undo/redo, built on a minimal Diff mechanism (an ordered list of reversible changes with a
  cursor) — proven here before Phase 09 (AI) starts writing through the same mutation path at higher volume.
  The full durable `StoreConfigVersion`/`Diff` persistence model is Phase 10's concern; this phase's undo/redo
  can be session-scoped.
- Persistence of configuration changes (reload restores the edited state) using Phase 04's minimal persistence
  boundary.

## Out of Scope

- AI-driven editing (Phase 09) — this phase is manual editing only.
- The full versioned `StoreConfigVersion` lineage, `lockVersion` optimistic concurrency, and permanent audit-log
  `Diff` persistence — Phase 10.
- Adding/removing/reordering sections, duplicating sections, blocks beyond what a starter section already
  defines — these are valid `Operation` types in the full spec
  ([`docs/product-spec/04-ai-architecture.md`](../product-spec/04-ai-architecture.md)'s operation vocabulary)
  and can be added to the editor in this phase or deferred to align with Phase 08's growing section catalog;
  either is acceptable, but is not required for this phase's Completion Criteria.
- Persisting raw DOM/HTML under any circumstance, ever — not a deferred item, a permanent rule.

## Architecture

```text
Click/hover in iframe
  |
data-sf-* metadata resolved (React reads iframe DOM directly - same-origin, no postMessage needed)
  |
Selected Section / Block / Setting identity (React state, never the source of truth)
  |
Settings panel edit  OR  contentEditable commit
  |
Store Configuration updated (React state + persisted)
  |
Phase 06's LiquidJS rerender
  |
Preview updates
```

Overlays (selection outline, drag handles) are drawn by React on top of the iframe, never injected into the
iframe's own DOM — the one exception is `contentEditable` itself, which does toggle inside the iframe DOM for
the duration of the edit, per
[`docs/product-spec/09-visual-editor.md`](../product-spec/09-visual-editor.md). Because the iframe is
same-origin, React reaches its DOM directly; no `postMessage` protocol is needed or used, matching
[`docs/product-spec/08-preview-iframe.md`](../product-spec/08-preview-iframe.md).

## Inputs

The rendered preview and Store Configuration from Phase 06.

## Outputs

An editable Store Configuration, with every edit persisted and every edit rerendering the live preview.

## Dependencies

Phase 06 (a working preview to select inside and rerender).

## Implementation Areas

- Selection resolution: walk up the DOM from the clicked/hovered node, checking `data-sf-setting` first, then
  `data-sf-block-id`, then `data-sf-section-id`, per the exact resolution order in
  [`docs/product-spec/10-dom-metadata-and-selection.md`](../product-spec/10-dom-metadata-and-selection.md).
- Settings panel: form fields generated from the selected section's settings contract (Phase 08 formalizes the
  contract shape; this phase can start against the starter sections' inline settings).
- `contentEditable` commit handler: string-only extraction, write through the same settings-update path the
  panel uses (both must hit the identical mutation path — no separate write path for inline edits).
- Minimal Diff/undo-redo: an ordered, in-session list of reversible changes with a cursor; undo reverse-applies,
  redo reapplies, a new edit after undo discards the redo tail.
- Debounced persistence of the current Store Configuration.
- Render-cache consideration (optional at this phase, required at scale): memoize per-section HTML keyed by
  `{type, settings, blocks}` fingerprint so an edit to one section doesn't require rerendering every section —
  see [`docs/product-spec/09-visual-editor.md`](../product-spec/09-visual-editor.md) for the caching approach if
  needed.

## Data Contracts

No new persisted entity beyond Phase 04's Store Configuration and a minimal in-session Diff shape:

```text
SessionDiff {
  entries: { path: string, before: SettingValue, after: SettingValue }[]
  cursor: number
}
```

This is intentionally smaller than the full `Diff`/`DiffEntry` schema in
[`docs/product-spec/18-versioning-and-undo-redo.md`](../product-spec/18-versioning-and-undo-redo.md) — that
full shape (with `causedBy`, `kind`, stable id-rooted paths, permanent persistence) is Phase 10's job once this
phase has already proven the interaction model works.

## User Flow

```text
Click a section (e.g. Product Hero)
  |
Section highlighted, settings panel opens
  |
Change a setting (e.g. heading text) via the panel, or click directly into an editable text field
  |
Store Configuration updates
  |
LiquidJS rerenders
  |
Preview reflects the change immediately
  |
Reload the page
  |
Configuration and preview are both restored
```

## Error Handling

- An edit to a setting that fails structural validation (Phase 04's schema) is rejected before it reaches the
  Store Configuration — the UI shows the rejection, the preview does not rerender with invalid data.
- A `contentEditable` commit must never write raw HTML/DOM into a setting — only the extracted string value,
  enforced at the commit handler, not left to convention.
- Losing the selection (e.g., the selected section was removed by some other path) must clear the settings
  panel gracefully, not error.

## Testing

- Selection resolution tests: given a DOM fixture with nested `data-sf-*` attributes, clicking at various
  nesting depths resolves to the correct section/block/setting.
- Settings-update tests: a panel edit updates the Store Configuration and triggers exactly the expected rerender
  scope.
- `contentEditable` tests: committing an edit writes only the string value to the correct setting path; a test
  explicitly asserting no raw HTML/DOM ever reaches the Store Configuration.
- Undo/redo tests: a sequence of edits, undo, redo, and a new edit after undo, all producing the expected
  configuration state at each step.
- Persistence test: edit, reload, confirm both configuration and rendered preview are restored.

## Completion Criteria

This phase's completion is the core prototype's milestone — the exact scenario from
[`docs/product-spec/01-product-architecture-overview.md`](../product-spec/01-product-architecture-overview.md):

```text
Import a product -> preview renders -> click a section -> edit a setting or text ->
Store Configuration updates -> preview updates immediately -> reload -> both are restored
```

Additionally: undo/redo works correctly for at least a simple edit sequence, and no raw DOM/HTML is ever
observed in the persisted Store Configuration.

## Next Phase

With the core prototype (Phases 01-07) proven, [08 — Section Library](08-section-library.md) grows the small
starter set into the MVP catalog, and [09 — AI Generation](09-ai-generation.md) begins writing through this
exact same editing pipeline instead of a separate path.
