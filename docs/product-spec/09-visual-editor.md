# Visual Editor

The Visual Editor is a React/Next.js application built around the [same-origin preview iframe](08-preview-iframe.md). It is a point-and-click surface over the same [Store Configuration](03-store-configuration.md) writes AI produces: every operation in this document resolves to a write against a specific Store Configuration path, produces a `Diff` ([Versioning and Undo/Redo](18-versioning-and-undo-redo.md)), and passes through the same [validation pipeline](17-validation-and-error-handling.md), regardless of whether a person or the AI triggered it. **The editor manipulates the Store Configuration, not Liquid source code — it has no private write path and no private render path.** It never renders a React reconstruction of the storefront; the canvas is the literal output of the [LiquidJS Preview Renderer](06-preview-architecture.md).

## 1. Application layout

```
Builder
├── Toolbar
├── Left Sidebar
├── Section Navigator
├── Preview iframe
├── Inspector
├── AI Editing Panel
└── Editor Controls
```

Rendered as a top toolbar plus a four-region body:

```
┌───────────────────────────────────────────────────────────────────┐
│ Toolbar: project/version • undo/redo • device switcher • preview • │
│          save status • publish                                     │
├───────────┬───────────────────────────────────┬─────────┬─────────┤
│ Structure │                                     │ Inspec- │   AI    │
│(Section   │           Preview iframe            │  tor    │ Panel   │
│ Navigator)│      (LiquidJS-rendered HTML)        │ panel   │(chat +  │
│           │                                     │         │ plan)   │
└───────────┴───────────────────────────────────┴─────────┴─────────┘
```

- **Toolbar** — project name and Store Configuration version label with a version switcher, undo/redo, a save-status indicator, a device switcher (desktop / tablet / mobile — drives both the iframe viewport and which `visibility` flags the Inspector surfaces), a preview-mode toggle, and Publish (gated by org role, a connected Shopify Store, and no outstanding unsaved/unvalidated changes).
- **Section Navigator (Structure panel)** — the current page's sections as a tree: the active page body, with `layout.header`/`layout.footer` shown as pinned nodes above/below it; each section instance expands to its `blocks[]`. This is where every *structural* operation (add, remove, duplicate, reorder) is triggered — never from the preview iframe directly, since these change a page's section *list*, not an in-place edit of something currently rendered.
- **Preview iframe** — a same-origin iframe showing the current Store Configuration rendered by the LiquidJS Preview Renderer. Byte for byte the same Liquid template output that later ships to the real storefront.
- **Inspector** — controls for whatever is selected: one input per setting the selected Section Definition or block type declares, bound to that instance's `settings`. With nothing selected, it falls back to Global Settings (§6).
- **AI Editing Panel** — a persistent chat surface docked alongside the editor (not a modal), showing AI message history, a composer, a selection-driven scope indicator, and in-flight plan/execution state (§8).
- **Editor Controls** — undo/redo, save status, and version controls surfaced in the toolbar and cross-cutting editor state (§7).

The Structure panel and AI panel are collapsible but never destroyed — collapsing preserves scroll position, conversation state, and selection so re-opening is instant.

## 2. State management

Client state falls into three categories. **The specific state-management library is TBD** (see [Technical Dependencies](22-technical-dependencies.md)) — the categories and the mutation flow below are settled; the library that implements them is not.

1. **Store Configuration — the source of truth.** The JSON document fetched from `/config/*`, held in a normalized client-side structure keyed the way the document itself is keyed: by page id, then section `id`, then block `id`. Every panel (Structure, Preview, Inspector, AI) reads from this one structure rather than holding independent copies of section/block data.
2. **Per-section render cache — derived, not recomputed wholesale.** Because the preview is LiquidJS output, not a React tree, a Store Configuration write doesn't directly produce new pixels — it goes through a render pass first. Re-running that render pass for the entire page on every keystroke would be wasteful and would risk visible flicker across unaffected sections. Rendered HTML is memoized **per section instance**, keyed by a content fingerprint of that instance's own `{type, settings, blocks}`:
   - A section-scoped write invalidates exactly that one section's cache entry; every other section's cached HTML is untouched.
   - A `globalStyles`/`themeSettings` write invalidates every section on the current page that doesn't declare its own override for the changed token — the same blast radius Global Settings writes have (§6).
   - Reordering a section invalidates nothing — no section's fingerprint changes, only its position — so the preview only repositions an already-rendered fragment rather than re-rendering it.
   - **Stale-cache handling:** a cache entry is only ever trusted for as long as its fingerprint matches the live instance's current `{type, settings, blocks}`. Any write that changes that triple recomputes the fingerprint and treats a mismatch as a cache miss, forcing a fresh LiquidJS render before the entry is served again — the cache is correctness-transparent, never a source of stale content shown in place of the current configuration.
3. **Editor UI state — explicitly not Store Configuration content.** `selectedSectionId`, `selectedBlockId`, device-switcher state, preview-mode, panel collapse state, and AI conversation/plan state. Ephemeral and per-session, but readable by every panel so selection and AI scope stay consistent across Structure, Preview, Inspector, and the AI panel.

**Open question this document flags rather than resolves: where the LiquidJS render actually executes** for the live editing session (client-side, e.g. a Web Worker, vs. a server-rendered per-section fragment per write). See [Preview Architecture](06-preview-architecture.md) and [Technical Dependencies](22-technical-dependencies.md) — TBD. The render-cache design above holds regardless of which side executes the render; only the latency profile before a cache entry updates changes.

### Mutation flow

Every write, regardless of origin (Inspector field edit, `contentEditable` commit, Structure panel drag, or an applied AI operation step), follows the same flow:

```
1. Operation expressed as {path, new value} against the client-held Store Configuration
2. Applied OPTIMISTICALLY to local state
     -> invalidates the affected section's render-cache entry
     -> that section's preview fragment re-renders immediately, no network wait
3. Same operation sent to /editor/* (or, for AI, arrives via the plan-execution endpoint)
4. Server is authoritative: validates (doc 17), applies to persisted config,
   produces a Diff (doc 18), returns confirmation or rejection
5. On confirmation: local state reconciled (normally a no-op)
   On rejection: local optimistic write rolled back (that write only, not the
   whole configuration); error surfaced scoped to the affected panel; render
   cache entry invalidated back to its pre-write state
6. Debounced autosave batches rapid writes into one persisted save; explicit
   save flushes immediately. The debounce governs persistence only — the
   optimistic local render already reflects every intermediate value.
```

Because both the Visual Editor and the standalone AI Workspace mutate the same server-side Store Configuration, opening the Visual Editor after making changes elsewhere re-fetches (or receives a pushed update to) the current configuration rather than assuming its own cache is current.

**Server communication** splits along the same line as the state categories: Store Configuration writes go through the bespoke optimistic-mutation flow above (required for the Saving/Saved/Error states in §7); read-only data that doesn't participate in live editing (Assets library, Version history, AI Usage records) is a good fit for a conventional fetch/cache library. Neither the mutation-layer implementation nor the fetch/cache library is finalized — TBD, same technical-dependencies entry as the state-management library above.

## 3. Selection, hover, and the overlay layer

Clicking or hovering a rendered element inside the preview iframe resolves through the `data-sf-*` DOM metadata mapping ([DOM Metadata and Selection](10-dom-metadata-and-selection.md)) to a specific Section/Block/Setting identity, setting the cross-cutting selection state (`selectedSectionId`, optional `selectedBlockId`). The Structure panel highlights the matching node, the Inspector renders that instance's fields, and the AI panel reads it for scope (§8).

**Selection and hover outlines are drawn by React, on top of the iframe — never injected into the iframe's own DOM.** The preview iframe's content is the real production Liquid render; keeping editor-only chrome (outlines, resize handles, badges) entirely outside that DOM guarantees nothing editor-only can leak into what ships to production. Mechanically:

1. Doc 10's click-to-select mapping resolves the current selection/hover target to a DOM element inside the iframe.
2. React reads that element's on-screen bounding box (`getBoundingClientRect`), translated into the parent document's coordinate space.
3. React positions an absolutely-positioned overlay `<div>` over that box.
4. The overlay is resynced on scroll, resize, and every re-render.

The same technique draws the drag handle some sections expose for direct spacing adjustment (§5.8), the "AI editing…" locked-section indicator during an in-flight AI operation (§8), and the proposed-change ghost overlay shown during AI diff preview (§8).

`contentEditable` is the one interaction that toggles inside the iframe's own DOM rather than as an overlay — it is a real browser text-editing feature applied to an actual rendered text node, so it has to live where that node lives. React's role there is limited to reacting to the resulting commit: reading the value back out and issuing the Store Configuration write (§5.5). See [contentEditable](11-contenteditable.md).

## 4. How to read the operation write paths

Every operation below states: what the user does and where (preview iframe direct manipulation vs. a React panel control), the exact Store Configuration path it writes, what re-renders, and the resulting `Diff`/validation. Paths are written against the shape defined in [Store Configuration](03-store-configuration.md):

```
StoreConfiguration {
  pages: { [pageId]: { sections: SectionInstance[] } }   // array position = display order
  layout: {
    header: { sections: SectionInstance[] },
    footer: { sections: SectionInstance[] }
  },
  globalStyles: {
    colors:     { ... },
    typography: { headingFont, bodyFont, scaleRatio, baseSize },
    buttons:    { radius, borderWidth, shadow, style },
    spacing:    { sectionSpacing, containerWidth }
  },
  themeSettings: { [settingId]: value }   // raw passthrough for Base Theme settings
                                           // not yet promoted into a structured
                                           // globalStyles field
}

SectionInstance {
  id: string,
  type: string,             // resolves to a Section Definition
  settings: { [settingId]: value },
  blocks: BlockInstance[],
  visibility?: { desktop: boolean, tablet: boolean, mobile: boolean },
  disabled?: boolean
}

BlockInstance { id: string, type: string, settings: { [settingId]: value } }
```

Path notation: `pages.index.sections[sec_9f2a].settings.heading` means the `heading` key in the `settings` object of the section instance with `id: sec_9f2a`, inside `pages.index.sections[]`.

A **Section** (capital S) is one fixed, human-authored catalog entry (a Liquid template + schema) — see [Base Theme and Section Library](02-base-theme-and-section-library.md) and [Shared Section Contract](12-shared-section-contract.md). A **section instance** is the `{id, type, settings, blocks}` object living in a Store Configuration, pointing at a Section Definition by `type`. Adding a section never creates a new Section Definition, only a new instance referencing an existing one — the section picker (§5.1) only ever lists Section Definitions that already exist.

## 5. Editing operations

### 5.1 Add Section

**Trigger:** "+ Add" in the Section Navigator (at a chosen insertion index) or a hover-triggered "+" affordance between two sections, drawn by React over the preview (an overlay, not an iframe-DOM element — §3). Opens a section picker: every Section Definition valid for the current page's type, shown with its declared presets as selectable variants. Also reachable by clicking "Apply" on an `add_section` step in a reviewed AI Operation Plan (§8) — same write, the type/position/preset are AI-chosen rather than user-picked. **React-panel-triggered only** — never from the preview iframe, since this is a structural change to a page's section list.

**Store Configuration write:** appends a new `SectionInstance` to `pages.<pageId>.sections[]` (or `layout.header.sections[]` / `layout.footer.sections[]`) at the chosen index:
```json
{ "id": "<new id>", "type": "<sectionType>", "settings": "<from preset, or Section schema defaults>", "blocks": "<from preset, or []>" }
```
No generative counterpart exists — the picker only lists Section Definitions that already exist; a request no existing Section satisfies is out of scope for this operation (see [AI Architecture](04-ai-architecture.md)).

**Preview update:** LiquidJS renders only the new instance; the resulting fragment is inserted into the iframe at the corresponding position. No other section re-renders.

**Diff & validation:** one `added` `Diff` entry at `pages.<pageId>.sections[<newId>]` plus a position-change entry. Validation confirms `type` resolves to a real Section Definition and, if a preset was supplied, that it's one the Section declares — hard block otherwise.

### 5.2 Remove Section

**Trigger:** delete icon on a Structure panel row, or a context-menu "Remove" reached from a section's selection state. **React-panel-triggered.** A confirmation dialog is shown when either: the instance is in `layout.header`/`layout.footer.sections[]` (shared across every page), or it has any non-default setting value or blocks. A plain page-body section still at defaults with no blocks deletes without a dialog.

**Store Configuration write:** removes the matching `SectionInstance` from its containing `sections[]` array.

**Preview update:** the removed section's fragment is removed from the iframe DOM; nothing else re-renders.

**Diff & validation:** one `removed` `Diff` entry with the full prior instance stored as `before` (enabling undo as clean re-insertion) plus a position-change entry on the containing array. Validation confirms no dangling block/preset reference remains.

### 5.3 Duplicate Section

**Trigger:** "Duplicate" on a Structure panel row or its context menu. **React-panel-triggered.** Copy is inserted immediately after the source in the same `sections[]` array.

**Store Configuration write:** deep-copies the source instance's `settings` and `blocks`, mints a fresh `id` for the new instance and for each copied block, inserts after the source.

**Preview update:** LiquidJS renders only the new instance.

**Diff & validation:** one `added` entry plus a position-change entry — mechanically identical to Add Section, with content pre-populated from an existing instance. Copied block count is re-checked against the Section's `max_blocks`; this always passes by construction since the source was never over the ceiling.

### 5.4 Reorder Section

**Trigger:** drag a Structure panel row to a new position and drop. **React-panel-triggered, exclusively** — reordering is a structural list change, never a preview-iframe drag gesture. The drop target resolves to an index within the current `sections[]` array; dragging across regions (e.g. page body into the header list) resolves to a move between two different `sections[]` arrays. **The drag-and-drop implementation/library is TBD** (see [Technical Dependencies](22-technical-dependencies.md)).

**Store Configuration write:** removes the instance from its current position and re-inserts it, unchanged, at the new index — in the same array or a different one for a cross-region move. Array position *is* order; `id` stays stable across the move.

**Preview update:** no section's content changes, so no LiquidJS re-render is needed — the iframe DOM reorders the already-rendered fragments to match the new array order (a DOM re-position, not a re-render).

**Diff & validation:** one `moved` `Diff` entry recording the before/after index (and before/after array, for a cross-region move). Validation bounds-checks the target index — out-of-range is a hard block, though unreachable from a UI that only offers valid drop targets.

### 5.5 Edit Text / Richtext

**Trigger:** clicking directly into rendered text inside the preview iframe and typing. **The canonical iframe-DOM-triggered operation.** The section's Liquid emits identifying attributes on the DOM elements carrying `text`/`richtext` settings; clicking one toggles `contentEditable` on it in place of opening a modal. A `richtext` field constrains allowed formatting (bold/italic/link/list) to what the underlying setting's sanitization allowlist permits. The identical field is also editable from the Inspector for users who prefer the side panel — both paths write the same key.

`contentEditable` is an interaction mechanism only. Typing into the DOM does not by itself persist anything — on commit (blur, or a debounced interval during continuous typing) the current text is **read back out of the DOM** and written into the Store Configuration. Arbitrary DOM mutations are never persisted directly; only the value read back through this path reaches the configuration. See [contentEditable](11-contenteditable.md).

**Store Configuration write:** `pages.<pageId>.sections[<id>].settings.<settingId>` (section-level field) or `pages.<pageId>.sections[<id>].blocks[<blockId>].settings.<settingId>` (block-level field).

**Preview update:** committing the read-back value triggers a LiquidJS re-render scoped to the owning section — the mechanism that keeps the Store Configuration and rendered HTML from silently diverging.

**Diff & validation:** one `modified` entry. Validation confirms `settingId` exists on that instance's schema and the value's shape matches its declared type. For `richtext`, the value is sanitized against an allowlist of tags (`p`, `br`, `strong`, `em`, `a[href]`, `ul`/`ol`/`li`) on write — identically whether the text came from direct typing or an accepted AI copy suggestion.

### 5.6 Edit Image

Three interactions on the same section field, distinguished by where the new content comes from. All **React-panel-triggered** — none has a meaningful in-place DOM equivalent. Clicking an image in the preview selects its owning section/setting (§3) and opens the Inspector to that field; replacement happens in the Inspector or a modal it opens, never by manipulating the `<img>` element in the iframe directly.

**(a) Upload.** File dropped on an `image_picker` field's Inspector control, or picked from a file dialog or the [Assets](13-assets.md) library. **Write:** two writes — an asset reference registration, then `pages.<pageId>.sections[<id>].settings.<settingId> = <assetRef>`. Kept as two independently-reversible writes so undoing the setting swap alone leaves the uploaded asset in the library.

**(b) AI-generate.** "Generate with AI" on an image field. Images are ordinary content assets and remain in scope for AI generation even though Section Liquid never is. Calls the image-generation endpoint; on acceptance the same two-write pattern as (a) runs, tagging the asset's origin as AI-generated. Credit-consuming. **Deferred post-MVP** — see [MVP Scope](24-mvp-scope.md).

**(c) Crop / focal point.** Offered only if the section's own schema exposes a setting for it (e.g. a `select`-typed "image position" field alongside the `image_picker`). When present, an ordinary field edit to that `settingId`. When absent, the Inspector does not synthesize a control — the image isn't repositionable for that section.

**Preview update:** LiquidJS re-renders the owning section once the asset write and the setting write both land.

**Diff & validation:** one `added`/`modified` entry at the asset reference, one `modified` entry at the settings path. Validation enforces asset size/type limits before write — hard block on violation — and confirms the setting resolves to a real, existing asset reference. AI-generated images run through the same untrusted-content handling as any AI output.

### 5.7 Edit Button

A button is a cluster of independent settings, never one monolithic field — typically a `text` label setting, a `url` link-target setting, and, only where the Section schema declares one, a `select`-typed per-button style setting. The Inspector groups these into one visual "Button" card; each remains a distinct setting with its own `settingId`.

**Trigger — mixed.** The label is ordinary text content: where the markup exposes it as an editable DOM element, it follows §5.5's `contentEditable` path directly in the preview. Link target and style have no in-place DOM equivalent — **React-panel-triggered** exclusively, through the Inspector's Button card.

**Store Configuration write:** one write per field edited — label, link, and style are three independent writes if all three change, not one composite write (so undo can target just one). Each writes `pages.<pageId>.sections[<id>].settings.<settingId>` (or the block-scoped equivalent, for a button inside a block).

**Preview update:** each committed write triggers a scoped re-render (or writes within the same debounce window coalesce into one render pass — an optimization only, not a change in what's written).

**Diff & validation:** one `modified` entry per edited setting. A `url` field rejects a non-URL value; a `select` style field rejects a value outside its declared options. If a Section has no per-instance style setting — style is purely the `globalStyles.buttons` token — the Button card omits the style control and links into Global Settings > Buttons (§6) instead of showing a disabled control.

### 5.8 Edit Spacing / Padding

**Trigger:** an Inspector slider, shown per-section only when that Section's schema declares its own spacing setting (commonly a `range`-typed `padding_top`/`padding_bottom`). **Primarily React-panel-triggered.** Where a Section explicitly opts in, a secondary direct-manipulation path exists: a drag handle drawn by React as an overlay over the section's edge in the preview (§3), positioned from the section's on-screen bounding box. Dragging it still resolves to the same write on release — a second affordance for the same field, not a different write path. Most Sections don't opt in and use the Inspector slider only. **Deferred post-MVP:** the drag-handle affordance itself is out of MVP scope; the Inspector slider ships at MVP — see [MVP Scope](24-mvp-scope.md).

**Two distinct scopes:**

| Scope | Condition | Write |
|---|---|---|
| Section-level override | Section schema declares its own padding setting | `pages.<pageId>.sections[<id>].settings.<settingId>` — affects only this instance |
| Global spacing | No per-instance setting; only the theme-wide token applies | `globalStyles.spacing.sectionSpacing` — affects every section without its own override |

When a section has no schema-declared spacing setting, the Inspector shows a passive note linking to Global Settings rather than fabricating a control that would silently do nothing.

**Preview update:** a section-level write re-renders only that section; a global-spacing write potentially re-renders every section on the open page that doesn't declare its own override.

**Diff & validation:** one `modified` entry at whichever path — the path alone records which of the two scopes an edit landed in. Section-level edits are range/step-checked against the setting's declared `min`/`max`/`step`. Global spacing changes additionally run a structural check: a value that would compute to a negative or zero content width at a defined breakpoint is a hard block.

### 5.9 Edit Colors

**All color edits are React-panel-triggered** (Inspector or Global Settings) — no in-place DOM equivalent. Behavior differs by the setting's declared type, never a single generic "pick a color" UI:

| Case | Setting type | Trigger | Write |
|---|---|---|---|
| A | scheme-typed | Inspector — scheme picker (dropdown/swatch grid of named schemes) | `pages.<pageId>.sections[<id>].settings.<settingId> = "scheme-2"` — swaps which scheme this instance uses |
| B | editing what a scheme resolves to | Global Settings > Colors only, never a section's Inspector | `globalStyles.colors.<schemeName>.<role>` — changes every section anywhere currently assigned to that scheme |
| C | plain color field (a one-off overlay tint some Sections expose alongside their scheme setting) | Inspector — hex/swatch picker | `pages.<pageId>.sections[<id>].settings.<settingId> = <hex>` |

The editor decides A vs. C purely from the setting's declared type — it never upgrades a plain color field into a scheme picker or downgrades a scheme field into a hex input. Case B is never reachable from a single section's Inspector because of its blast radius; Global Settings shows "affects N sections across M pages" before commit.

**Preview update:** Case A/C re-renders only the affected section. Case B re-renders every section on the open page assigned to the changed scheme.

**Diff & validation:** Case A/C — one `modified` entry. Case B — one entry per changed role within the scheme. Validation confirms a Case A value is a real declared scheme name and a Case C value is well-formed. A resulting contrast concern is flagged as a warning, never a hard block, where automatable.

### 5.10 Edit Typography

**Default — global.** `globalStyles.typography` (`headingFont`, `bodyFont`, `scaleRatio`, `baseSize`) is the only lever for most Sections. **React-panel-triggered**, via Global Settings > Typography (§6).

**Section-level override — only where the schema declares one** (typically hero/banner Sections with their own `font_picker` or `range`-typed heading-size setting). Where present, an ordinary write to `pages.<pageId>.sections[<id>].settings.<settingId>` via the Inspector, additive to (not instead of) the global lever — a section-level override wins for that instance; the global token still governs every section without one.

**Preview update:** a section-level override re-renders only that section. A global change re-renders every section on the open page that doesn't declare its own override.

**Diff & validation:** one `modified` entry at `globalStyles.typography.<field>` or the settings path. `font_picker` values are checked against the Base Theme's available font list; `range` sizes against declared `min`/`max`/`step`. A global typography change additionally samples a representative set of page types (home, product, collection, cart) for rendering validation, since a scale change can affect layout beyond the section selected when the edit was made.

### 5.11 Edit Layout (columns, alignment)

**Trigger:** Inspector controls rendered strictly from `select`/`range`-typed settings the Section's own schema declares (e.g. `select` options `["2", "3", "4"]` for columns). **React-panel-triggered.**

**The editor is a faithful surface over exactly what a Section's schema declares — never a superset.** If a schema caps columns at 3, the control has three options; it does not add a fourth because a 4-column layout is conceptually plausible. What the user sees in the editor and what the Section's Liquid actually supports can never drift apart, because the schema is the single declared contract between the two.

**Store Configuration write:** `pages.<pageId>.sections[<id>].settings.<settingId>` — no different from any other field edit; layout settings are a distinct Inspector *grouping*, not a distinct write category.

When a section genuinely doesn't support the layout change requested, this is out of scope for the Visual Editor entirely — and, because Sections are never AI-generated, equally out of scope for AI editing. It surfaces as an absent control with an "ask AI about this" shortcut scoped to that instance, so the user can ask whether a different existing Section or preset gets closer, rather than a disabled control or any form of live code generation.

**Preview update:** LiquidJS re-renders only the affected section.

**Diff & validation:** one `modified` entry. Validation enum-checks the value against declared options — a value outside them is a hard block, though unreachable from a UI that only ever offers declared options.

### 5.12 Toggle Visibility (per device)

**Trigger:** three toggles (desktop / tablet / mobile, matching the toolbar's device switcher) on a Structure panel row or the Inspector's section-level controls — present identically for every section instance, independent of Section type. **React-panel-triggered.**

**Store Configuration write:** `pages.<pageId>.sections[<id>].visibility.<breakpoint> = <boolean>` — one write per breakpoint toggled. Distinct from `disabled` (§6): visibility toggled off per device is "hidden for now, reversible per device"; `disabled: true` is "fully off, one flag."

**Preview update:** the preview shows/hides the section's already-rendered fragment for the currently-active device viewport — a DOM show/hide, not a fresh LiquidJS render, since settings/blocks didn't change.

**Diff & validation:** one `modified` entry per toggle, so undo can target exactly the breakpoint changed. Validation warns — never hard-blocks — if disabling a section on `mobile` would leave no equivalent for content the validation layer flags as critical (e.g. the only nav/cart-access section) with nothing shown in its place.

### 5.13 Responsive controls generally

Not a separate control category layered on top of the write path — it is the device switcher changing which settings the Inspector foregrounds, against the same field-write mechanism as any other edit:

- Where a Section schema declares genuinely separate settings per breakpoint (e.g. `columns_desktop` and `columns_mobile`), both exist in the Store Configuration at all times; switching the device switcher to "mobile" brings `columns_mobile`'s control forward and collapses `columns_desktop`'s.
- Where a section has no such split, the single setting applies at every breakpoint — the Inspector doesn't fabricate a device-scoped variant absent from the schema.
- The device switcher never triggers a write on its own — switching devices is a local, ephemeral UI-state change (§2, category 3), affecting only the iframe viewport width and which breakpoint's values the Inspector foregrounds. It can trigger a preview re-render if a Section's CSS genuinely differs at that width, but that's the LiquidJS-rendered HTML responding to a viewport change, not a new Store Configuration write.

**Diff & validation:** identical to whatever underlying field is being edited (§5.5–§5.11) — no separate `Diff` shape of its own. Advanced per-breakpoint responsive overrides beyond the three standard viewports (desktop/tablet/mobile) are deferred post-MVP — see [MVP Scope](24-mvp-scope.md).

## 6. Global Settings

Shown in the Inspector when nothing is selected. **Entirely React-panel-triggered** — no in-place DOM equivalent, since Global Settings isn't scoped to any one rendered element.

| Area | Write path | Notes |
|---|---|---|
| Colors | `globalStyles.colors.<role>` or `.<schemeName>.<role>` | See §5.9 Case B for the scheme-editing flow. |
| Typography | `globalStyles.typography.<field>` | `headingFont` / `bodyFont` / `scaleRatio` / `baseSize`. |
| Buttons | `globalStyles.buttons.<field>` | `radius` / `borderWidth` / `shadow` / `style`. Site-wide fallback §5.7 uses when a section has no per-instance style override. |
| Spacing / container widths | `globalStyles.spacing.<field>` | `sectionSpacing` / `containerWidth`. Fallback §5.8 uses when a section has no per-instance padding setting. |
| Forms (inputs) | `themeSettings.<settingId>` (raw) | Base Theme models input styling as raw settings, same shape as any Section schema's settings, scoped globally instead of per-section. |
| Cards | `themeSettings.<settingId>` (raw) | Card style/corner-radius/image-ratio are Base Theme-specific raw entries, not a first-class `globalStyles` sub-object. |
| Borders | `globalStyles.buttons.borderWidth` for button borders (structured); `themeSettings.<settingId>` (raw) for card/input/section-level borders | Whether a control is structured or raw depends on whether it's the specific button-border token or another Base Theme border setting — not merged into one generic concept, since they aren't unified in the Store Configuration. |
| Shadows | `globalStyles.buttons.shadow` (structured, buttons only) or `themeSettings.<settingId>` (raw) | Same split as Borders. |
| Breakpoints | Not exposed as a field edit | Fixed in the Base Theme's CSS, not a declared setting — no `settingId` to bind to. Global Settings does not fabricate a breakpoint editor; a real breakpoint change is a Base Theme engineering change, out of scope for both the editor and AI editing. |

A Global Settings control is backed by a structured `globalStyles` write only for the four sub-objects it models (`colors`, `typography`, `buttons`, `spacing`); everything else the Base Theme declares is bound through `themeSettings`, grouped in the panel by the Base Theme's own declared category headers regardless of whether that category also has a structured `globalStyles` projection.

**Preview update:** the four structured `globalStyles` categories can each be read by any section on the open page, so a global write potentially re-renders every section on that page without its own override — the widest blast radius in this document short of a page-wide operation. A `themeSettings` (raw) write re-renders only the sections whose Liquid actually references that setting.

**Diff & validation:** one `modified` entry per edited field, at `globalStyles.<path>` or `themeSettings.<settingId>`. Because a global write's blast radius spans every page, validation always samples a representative set of page types (home, product, collection, cart) rather than only the page the user was viewing.

## 7. Editor states

| State | Trigger | What the user sees |
|---|---|---|
| Loading | Initial Store Configuration fetch, or switching version | Skeleton canvas/panels; toolbar actions disabled; preview iframe empty. |
| Saving — autosave | A local write applied optimistically, no explicit Save taken; batched on a rolling ~2s idle window (capped at ~10s max wait) | Small "Saving…" near the version label; panels stay interactive. |
| Saving — explicit | User clicks Save, or the editor forces a flush before Publish or before navigating away | Save control shows a spinner; Publish stays blocked until resolved. |
| Saved | Persistence call confirms, returning the new `lockVersion` | "Saved" indicator with a timestamp, reverting to neutral after a few seconds. |
| Unsaved changes | A local write exists whose persistence hasn't confirmed | Dot/asterisk on the version label; leaving the editor prompts confirmation. |
| Error | A write is rejected by validation, a save fails (network or a `409` stale-`lockVersion` conflict), or the initial fetch fails | Inline error scoped to the affected panel, with retry. A `409` re-fetches the current configuration/`lockVersion` and re-applies the still-pending local write against it rather than discarding it. |
| Undo / Redo | Available whenever the local undo/redo stack is non-empty in that direction | Toolbar buttons enable/disable to match stack state; hover previews the target `Diff`'s summary. Operates over the single unified `Diff` stream regardless of origin — the next undo targets whichever `Diff` is most recent, editor- or AI-originated. |
| Preview mode | User toggles Preview | Structure/Inspector/AI panels collapse; the iframe expands full width, hover/selection affordances disabled — the same LiquidJS-rendered HTML a visitor would see, no separate visitor-view render path. |
| Device switch | User selects a device in the toolbar | Iframe viewport resizes; active `visibility` breakpoint and any per-breakpoint setting split become what the Inspector foregrounds. Purely local UI state — no write, no `Diff`. |

Saving and AI-operation execution are independent state machines that can be simultaneously visible — "Saving…" in the toolbar while the AI panel shows "Executing plan (2/4)" — since a save can be triggered by the AI operation's own applied writes.

## 8. AI editing integration

The AI Editing Panel and the point-and-click controls are one continuous surface over the same Store Configuration, not two modes fighting for control of the same document.

**Selection-driven scoping.** Clicking a section/block in the preview sets `selectedSectionId`/`selectedBlockId` (§3); the AI panel's composer shows a scope chip (e.g. "Scoped to: Hero banner") reflecting it. A request like "make this bolder" attaches the current selection to the outgoing AI request, letting the Operation Planner ([AI Architecture](04-ai-architecture.md)) resolve "this" and constrain candidate operations to the selected path instead of searching the whole page. Scope is sticky across turns until the user selects something else, explicitly clears it, or the AI's own plan targets a broader path (e.g. `globalStyles`) — at which point the chip updates to the plan's actual target. Selection is bidirectional: clicking a target reference inside a plan step also selects that section/block in the preview.

**Plan lifecycle**, surfaced in the AI panel for anything beyond a trivial single-field change:

1. **Composing** — user typing, no request outstanding.
2. **Analyzing/streaming plan** — a streaming rationale, followed by the ordered list of proposed operations as they resolve, each labeled with a risk level (safe / review / destructive) and the Store Configuration path it targets.
3. **Plan review** — each operation shown with a human-readable summary and, where applicable, the same preview mechanism (§3's overlay technique, or a before/after toggle on the iframe) rendering the *proposed* post-operation state through the same LiquidJS pipeline, scoped to the affected section(s) — a second, not-yet-committed render pass, not a separate diffing UI. `review`/`destructive` operations require explicit confirmation; `safe` structural operations may batch under one "Apply all." Because Sections are never AI-generated, no plan step ever proposes new Liquid — every step is a write to an existing section instance, a new instance of an existing Section Definition, or a `globalStyles`/`themeSettings` token.
4. **Executing** — per-operation progress (queued / applying / applied / failed); the preview updates section-by-section as each operation lands and its LiquidJS re-render completes, not only after the whole plan finishes.
5. **Completed** — a summary card with a single "Undo this change" reverting the whole plan as one unit, in addition to normal step-level undo/redo.
6. **Blocked/error** — if planning fails, an operation fails validation, or execution errors partway through, the panel shows what happened and which operations already applied, with retry/rollback; partially-applied plans never leave the configuration ambiguous, since each applied operation already produced its own reversible `Diff`.

**Concurrency with manual editing.** A user can keep editing while an AI plan executes, with one exception: the specific Store Configuration paths a plan's currently-applying step targets are soft-locked for that step's duration, not the whole editor.

- The instant a step moves from *queued* to *applying*, every path in its declared scope locks, keyed by the current configuration version plus path, with a TTL matching expected execution time — broadcast to every connected client editing that store.
- The instant a step moves to *applied* or *failed*, its lock releases immediately — a multi-step plan unlocks section-by-section as steps land.
- A section-scoped operation locks exactly that section instance; every other section and panel stays fully editable. A global-scope operation locks only what its own declared target names (e.g. a `globalStyles.colors` write locks that category's Global Settings controls) — never wider.
- **On a locked instance:** the Structure panel row shows a spinner/"AI editing…" badge; the preview dims or outlines the section with the same indicator (a React overlay, §3); the Inspector, if selected, shows its fields disabled with an inline note. Blocked client-side first for immediate feedback; the server enforces the same lock as the authoritative backstop.
- This soft lock is a UX convenience, not the data-integrity mechanism — the compare-and-swap `lockVersion` (see [Versioning and Undo/Redo](18-versioning-and-undo-redo.md)) remains the actual backstop for cross-session conflicts (e.g. a second browser tab with no visibility into the first session's in-flight plan): already-applied steps are kept, remaining steps abort as `conflicted`, and the user is prompted to re-plan against the current configuration.
- **Undo mid-plan:** undo always targets the most recent already-*applied* `Diff` in the unified stream; a step still *applying* hasn't produced a `Diff` yet and isn't a candidate. If a later, not-yet-executed step targets the just-undone path, no special-casing is needed — the executor always reads current live state per step, never a plan-start snapshot.
- Nothing is locked during "Analyzing/streaming plan" or "Plan review" — those are read-only previews. Locking begins only once the user confirms and a step starts applying.

## 9. Open questions / TBD

- **State-management library.** The three-category client-state model (§2) is settled; the specific library implementing it is not — see [Technical Dependencies](22-technical-dependencies.md).
- **Preview render execution placement** for the live editing session (client-side vs. server-rendered per-section fragment) — see [Preview Architecture](06-preview-architecture.md) and [Technical Dependencies](22-technical-dependencies.md). A per-section server-rendered fragment is assumed for share-link/thumbnail rendering only; live-session placement is unresolved.
- **Drag-and-drop implementation/library** for section reordering (§5.4) — see [Technical Dependencies](22-technical-dependencies.md).
- **Exact `data-sf-*` attribute names** beyond the namespace itself — see [DOM Metadata and Selection](10-dom-metadata-and-selection.md).
- **Ambiguous click-target disambiguation** when a nested section and block both claim a click during click-to-select — see [DOM Metadata and Selection](10-dom-metadata-and-selection.md).
- **Keyboard-accessible selection** — click-to-select currently has no specified keyboard equivalent.
- **`contentEditable` mid-edit conflict behavior** when the user clicks a different selectable element while an active edit has unsaved changes (auto-commit vs. discard vs. block) — see [contentEditable](11-contenteditable.md).
- **Fetch/cache library** for read-only editor-adjacent data (Assets, Version history, AI Usage) — not finalized.
