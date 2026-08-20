# contentEditable

Inline text editing directly inside the [preview iframe](08-preview-iframe.md), as an interaction mechanism
only — how it works, and why the DOM is never the persisted source of truth.

```
User edits text
      |
contentEditable
      |
Editor captures change
      |
Store Configuration updated
      |
LiquidJS rerenders
```

## 1. Governing principle

**`contentEditable` is only an editor interaction mechanism. It is never the source of truth, and raw DOM
mutations are never persisted directly.** The DOM is used as a transient editing surface; the moment an edit is
committed, it is reconciled back into [Store Configuration](03-store-configuration.md) — the single, real data
model — and the DOM is refreshed from a fresh render of that model, not trusted as storage at any point.

This is purely an interaction convenience layered on top of the Inspector: any text field editable in-preview
is equally editable through the Inspector sidebar, and both paths write through the identical settings-update
path.

## 2. Eligibility

Only elements carrying `data-sf-editable="text"` or `data-sf-editable="richtext"` (see
[DOM Metadata and Selection](10-dom-metadata-and-selection.md) §1) support in-preview `contentEditable` editing.
`data-sf-editable="image"` and `data-sf-editable="none"` elements do not — an image field is edited through the
Inspector or a dedicated image-picker interaction, and `"none"` elements are not directly editable at all.

## 3. Input handling

The user clicks into an eligible element and types. While actively typing, the browser's native
`contentEditable` behavior handles the in-place text mutation entirely within the iframe's DOM — cursor
movement, text insertion/deletion, and native selection behavior during typing are standard browser behavior,
not something the editor layer intercepts or reimplements. Nothing is written to `Store Configuration` while
typing is in progress; the DOM is allowed to diverge from the configuration for the duration of the edit.

## 4. Commit (blur) handling

On blur, or an explicit commit action, the editor reads the resulting text content back out of that DOM node —
the string value only, not the raw DOM subtree — and writes it into `Store Configuration` at the path resolved
by that element's `data-sf-setting` (e.g. `pages.home.sections[].settings.heading`), through the same
settings-update path any other editor field edit uses. That write:

1. Goes through the standard mutation pipeline — validated and diffed like any other change, AI or manual (see
   [Validation and Error Handling](17-validation-and-error-handling.md)).
2. Triggers a LiquidJS rerender (§5) of the affected Section — including the very element just edited.
3. Produces a Diff / version entry through the same path as any other committed edit (see
   [Versioning and Undo/Redo](18-versioning-and-undo-redo.md)).

The text the user sees immediately after commit is the result of a fresh render off the updated
`Store Configuration`, not the raw DOM mutation the browser applied while the user was typing.

### 4.1 Worked example

Before:

```json
{ "id": "sec_a1", "type": "hero", "settings": { "heading": "Everyday Carry, Elevated" } }
```

Rendered: `<h1 data-sf-setting="heading" data-sf-editable="text">Everyday Carry, Elevated</h1>`

The user edits the heading in-preview to `"Carry Less. Carry Better."`. On blur, the string is read back and
written to `settings.heading`:

```json
{ "id": "sec_a1", "type": "hero", "settings": { "heading": "Carry Less. Carry Better." } }
```

Rerendered: `<h1 data-sf-setting="heading" data-sf-editable="text">Carry Less. Carry Better.</h1>`

## 5. Rerender behavior

Commit always triggers a LiquidJS rerender — a fresh render off the current `Store Configuration`, never a DOM
patch (see [Preview iframe](08-preview-iframe.md) §8) — scoped to the affected Section instance(s) or the full
page. This loop never touches Shopify; it is entirely in-session, client-side state until the user explicitly
saves/publishes (see [Shopify Publishing](14-shopify-publishing.md)).

## 6. Validation and sanitization

Because a `contentEditable` commit writes through the identical settings-update path as any other field edit,
it passes through the same validation pipeline as every other mutation — see
[Validation and Error Handling](17-validation-and-error-handling.md) for the validation categories applied to
every write. This document does not define a separate sanitization or validation rule specific to
`contentEditable` text/richtext values beyond that standard pipeline.

## 7. Cursor and selection preservation

Cursor position and text selection during active typing are native browser behavior, scoped entirely to the
iframe's DOM, and are not managed by the editor layer (§3). Because commit happens on blur — after focus has
already left the element — cursor/selection state is not something the post-commit rerender needs to restore;
by the time the rerender replaces the DOM node, the user's focus and cursor are already elsewhere.

## 8. Undo/redo interaction

A committed `contentEditable` edit is an ordinary `Store Configuration` write and therefore produces an
ordinary Diff / version entry, undoable and redoable exactly like any other field edit (see
[Versioning and Undo/Redo](18-versioning-and-undo-redo.md)). Keystroke-level history *within* a single
uncommitted edit (i.e., undo of individual characters before blur) is native browser `contentEditable` behavior,
not part of the editor's Diff/version system.

## 9. Failure handling

If a commit fails validation, the specific error handling and recovery behavior (e.g. whether the edited text
is retained in-place for correction, reverted, or flagged) is not specified here — see
[Validation and Error Handling](17-validation-and-error-handling.md) for the general validation-failure
handling every mutation path shares.

## 10. Open Questions / TBD

| Item | Status | Blocking |
|---|---|---|
| Mid-edit selection conflict | Decision Required | Whether clicking a different selectable element while a `contentEditable` field has unsaved changes should auto-commit, prompt, or discard the in-progress edit is undecided. This document only establishes the write-back principle (§1, §4), not this specific UX rule. |
