# 06. Editor Specification

Status: proposed design
Depends on: doc 09 (Preview Rendering & Interaction Architecture — the LiquidJS Preview Renderer, the same-origin preview iframe, click-to-select DOM mapping, `contentEditable`); doc 14 (Diff schema, undo/redo); doc 15 (Validation); doc 18 (API/concurrency model)
Scope note: doc 19 (Frontend Architecture) specifies the Visual Editor's *layout* — panels, toolbar, canvas chrome, and the application-level state management that holds the Store Configuration and drives the preview. This document specifies the **editing operations themselves**: for every action a user can take, exactly which **Store Configuration** path it writes, how the operation is *triggered* (direct manipulation inside the live preview vs. a React panel control), how that write reaches the screen, and what validation runs before it lands. Where doc 19 already describes a UI surface (Structure panel, Inspector, AI panel, selection scoping), this doc references it rather than re-describing it. Doc 09 owns the mechanism every "triggered from the preview" operation below depends on — this document is that mechanism's *consumer*, not its author.

---

## 06.1 Purpose

The Visual Editor is a point-and-click surface over the exact same Store Configuration writes the AI Operation Executor produces. Nothing in this document introduces a new way to change a store — every operation below resolves to a write against a specific Store Configuration path, produces the same `Diff` shapes doc 14 defines, and passes through the same validation pipeline doc 15 defines. The Visual Editor's job is to make those writes discoverable and immediate, and to show their effect instantly by driving the same LiquidJS Preview Renderer (doc 09) that ultimately produces the live storefront; it has no private write path and no private render path.

**On Dropmagic (competitive context):** our research into Dropmagic's editor (`/tmp/.../research-dropmagic.md`) found only capability-level marketing claims — drag-and-drop reordering, text/image edits, adjustable spacing, 57+ section types — with no verifiable detail on its actual UI chrome, field-level controls, or state model (flagged NOT PUBLICLY VERIFIABLE in that research). This document does not borrow any editor-UI specifics from Dropmagic; the operation set and Store Configuration model below are derived entirely from Shopforge's own Base Theme / Section library / Store Configuration design.

---

## 06.2 How each operation is documented

Every subsection in §06.3 follows the same four-part structure:

- **User interaction** — what the user does, and *where*: either directly on the rendered preview (a click, a drag, typing into a `contentEditable` element inside the preview iframe) or through a React-rendered control panel (the Structure panel / Section Navigator, the Inspector, or Global Settings). Every operation below is explicit about which of these two it is, since the two paths are mechanically different (doc 09).
- **Store Configuration write** — the exact path(s) mutated, expressed against the shape below, and the value written.
- **Preview update** — what re-renders and how wide the blast radius is: a single section's LiquidJS rerender, every section that references a changed global token, or (rarely) a full-page rerender.
- **Diff & validation** — the `Diff` entry (or entries) the write produces (doc 14), and which validation layers (doc 15) run before the write is accepted.

**The Store Configuration shape referenced throughout this document:**

```
StoreConfiguration {
  pages: {
    [pageId]: {                      // e.g. "index", "product", "collection", "cart", "page.about-us"
      sections: SectionInstance[]     // ordered — array position is display order
    }
  },
  layout: {
    header: { sections: SectionInstance[] },   // shared across every page that renders the header
    footer: { sections: SectionInstance[] }
  },
  globalStyles: {
    colors:     { ... },   // named color schemes, or role-keyed colors — see §06.3.9
    typography: { headingFont, bodyFont, scaleRatio, baseSize },
    buttons:    { radius, borderWidth, shadow, style },
    spacing:    { sectionSpacing, containerWidth }
  },
  themeSettings: { [settingId]: value }   // raw passthrough for Base Theme settings not yet
                                           // promoted into a structured globalStyles field — see §06.4
}

SectionInstance {
  id: string,             // stable identity across reorders/edits
  type: string,            // resolves to a Section Definition — see below
  settings: { [settingId]: value },
  blocks: BlockInstance[],
  visibility?: { desktop: boolean, tablet: boolean, mobile: boolean },
  disabled?: boolean
}

BlockInstance {
  id: string,
  type: string,            // a block type declared by the parent Section's schema
  settings: { [settingId]: value }
}
```

Every path in this document is written against this shape using a bracketed-id notation for readability — `pages.index.sections[sec_9f2a].settings.heading` means "the `heading` key in the `settings` object of the section instance whose `id` is `sec_9f2a`, inside `pages.index.sections[]`." The underlying JSON is an ordered array, not a map, so "the section at path X" always also implies a position within that array; operations that change order (§06.3.4) mutate that position directly rather than any id.

**Section Definition vs. section instance.** A **Section** (capital S) is one entry in Shopforge's fixed, human-maintained library of roughly 40–60 Liquid templates — never AI-generated (this is a hard constraint of the architecture, see §06.3.1). Each Section Definition is a Liquid template plus a schema (settings, block types, `max_blocks`, presets) in the same shape Shopify's own section schema uses, which is precisely what lets the LiquidJS Preview Renderer produce production-parity HTML from it (doc 09). A **section instance** is the `{id, type, settings, blocks}` object that lives inside a Store Configuration's `sections[]` array and points at one Section Definition by `type`. Adding a section to a page never creates a new Section Definition — it only ever creates a new section instance referencing an existing one. This is the single biggest structural difference from the abandoned arbitrary-theme design this document previously specified: there is no "does this merchant's theme happen to have a section like this" question anymore, because the library is fixed and we wrote every entry in it.

### 06.2.1 Relationship to doc 09

This document specifies the **catalog of user-facing editing operations**: what a user can do, and which Store Configuration path each action writes. It does not specify *how* those operations are rendered live, or *how* the editor maps a click or a keystroke on the rendered preview back to a Store Configuration path — that is doc 09's subject in full (the LiquidJS Preview Renderer's render pipeline, the same-origin preview iframe, the click-to-select DOM-to-path mapping, and the rules governing `contentEditable`). Wherever an operation below is described as "triggered from the preview," assume the mechanism is doc 09's; this document only states *which* operations use that mechanism and what they write once triggered.

---

## 06.3 Editing Operations

### 06.3.1 Add Section

**User interaction:** "+ Add" affordance in the Structure panel / Section Navigator (at a specific insertion index, or at the top/bottom of a page), or a hover-triggered "+" between two sections shown as a React-drawn affordance layered over the preview (not an element inside the iframe itself — see doc 19 §19.4.4). Either entry point opens a **section picker**: a React panel listing every Section Definition valid for the current page's type, each shown with its declared presets as selectable variants (e.g. a "Featured collection" Section might offer "Grid" and "Carousel" presets). A second entry point exists from the AI panel: when an `add_section` step appears in a reviewed Operation Plan (doc 19 §19.4.7) and the user clicks "Apply," the identical write fires — the only difference is the Section type/position/preset were chosen by the Operation Planner (doc 11) rather than picked from the list. **This is always a React-panel-triggered operation, never an iframe-DOM-triggered one** — adding a section is a structural change to the page's section list, not an in-place edit of anything currently rendered.

**Store Configuration write:** appends a new `SectionInstance` to `pages.<pageId>.sections[]` (or `layout.header.sections[]` / `layout.footer.sections[]`, if added into a shared layout region) at the chosen index: `{ id: <new id>, type: <sectionType>, settings: <from preset, or the Section's own schema defaults if no preset chosen>, blocks: <from preset, or [] > }`.

**Because the Section library is fixed and human-authored, this operation has no generative counterpart.** Unlike the arbitrary-theme design this document previously specified, there is no path — manual or AI-driven — where "add a section" can result in new Liquid being written. If a user's (or the AI's) request needs a capability no existing Section Definition provides, that request is out of scope for this operation entirely; it is a product/engineering backlog concern for extending the Section library itself, not a runtime editing action. The section picker only ever lists Section Definitions that already exist.

**Preview update:** the newly-inserted section instance triggers a LiquidJS rerender scoped to just that one section (doc 09) — its Liquid template is resolved by `type`, rendered with the seeded settings/blocks, and the resulting HTML fragment is inserted into the preview iframe's DOM at the corresponding position. No other section on the page rerenders.

**Diff & validation:** produces one `Diff` entry (doc 14) at `pages.<pageId>.sections[<newId>]` (an `added` entry carrying the full new instance) plus one entry recording the position change to the containing `sections[]` array. Validation confirms `type` resolves to a real Section Definition and, if a preset was supplied, that the preset name is one the Section actually declares (doc 15's schema-conformance layer) — a hard block otherwise. Because no Liquid is ever generated by this operation, none of doc 15's Liquid-syntax, JSON, or asset-reference layers are exercised here; only the lightweight schema/structural check applies.

### 06.3.2 Remove Section

**User interaction:** delete icon on a Structure panel row, or a context-menu "Remove" reachable from a section's selection state (selection itself originates from clicking the section in the preview — see doc 09 — but the delete action fires from a React-rendered context menu or panel affordance, not from anything inside the iframe). **React-panel-triggered.** The client shows a **confirmation dialog** — not a silent delete — in either of two cases:
- **Shared in layout.** The instance lives in `layout.header.sections[]` or `layout.footer.sections[]`, which is rendered on every page that includes the header/footer. The dialog names the scope plainly ("This section appears in the header shown on every page — removing it will remove it everywhere").
- **Has content.** The instance has any non-default setting value or one or more blocks (i.e., it isn't sitting at its just-added defaults). This is judged client-side from the already-loaded Store Configuration, no extra round-trip needed.

A section with neither condition (plain page-body section, still at defaults, no blocks) deletes immediately without a dialog — the confirmation exists specifically to protect content a user would be upset to silently lose, not to add friction to every delete.

**Store Configuration write:** removes the matching `SectionInstance` from its containing `sections[]` array (`pages.<pageId>.sections` or `layout.header|footer.sections`).

**Preview update:** the removed section's HTML fragment is removed from the preview iframe's DOM (doc 09); nothing else rerenders. If the section was in `layout.header`/`layout.footer`, every page currently reflecting that shared layout in the open editor session updates, though only one page's iframe is actually mounted/visible at a time.

**Diff & validation:** one `Diff` entry (doc 14), a `removed` entry at `pages.<pageId>.sections[<id>]` with the full prior instance stored as `before` (this is what makes undo a clean re-insertion rather than a reconstruction), plus a position-change entry on the containing array. Validation (doc 15) confirms no block, preset, or downstream reference is left dangling after removal — for the fixed Section library this is a narrow check (there is no cross-file Liquid reference graph to walk the way there was for an arbitrary parsed theme), so it resolves quickly and is a hard block only in the pathological case of a malformed client-side removal request. No warning tier exists for "are you sure" — that judgment is made client-side by the confirmation dialog above, before the write is even issued.

### 06.3.3 Duplicate Section

**User interaction:** "Duplicate" on a Structure panel row or its context menu. **React-panel-triggered.** The copy is inserted immediately after the source instance in the same `sections[]` array.

**Store Configuration write:** deep-copies the source `SectionInstance`'s `settings` and `blocks`, mints a fresh `id` for the new instance and a fresh `id` for each copied block, and inserts the result into the same `sections[]` array immediately after the source.

**Preview update:** LiquidJS rerenders only the new instance (doc 09) — the source section and every other section on the page are untouched.

**Diff & validation:** one `added` entry at the new instance's path plus a position-change entry, identical shape to Add Section (§06.3.1); duplication is, mechanically, "add" with the new instance's initial content pre-populated from an existing instance instead of a preset or schema default. Validation re-checks the copied block count against the Section Definition's declared `max_blocks` — this can only fail if the source instance was already at its ceiling, which the duplicate path never exceeds (it copies exactly what the source has), so this check passes by construction.

### 06.3.4 Reorder Section

**User interaction:** drag a Structure panel row to a new position and drop. **React-panel-triggered, exclusively.** Unlike text or inline color edits, reordering is a structural change to a page's section list rather than an in-place edit of something currently rendered, so — per the same reasoning as Add/Remove/Duplicate — it is scoped to the Structure panel / Section Navigator, not to drag gestures on the preview itself. The drop target resolves to an index within the ordered `sections[]` array for the current page or layout region; dragging across regions (e.g. out of a page body and into the header list) is a client affordance offered only where it makes structural sense, and resolves to a move between two different `sections[]` arrays rather than just an index change within one.

**Store Configuration write:** removes the instance from its current position in its `sections[]` array and re-inserts it (unchanged — settings, blocks, visibility are untouched) at the new index, in the same array or a different one for a cross-region move. Because array position *is* order, this is purely a positional mutation; nothing about the instance's own content changes, which is exactly why `id` exists as stable identity independent of position — a "featured collection" instance keeps its identity, settings, and blocks no matter where it sits in the list.

**Preview update:** no section's HTML content changes, so no LiquidJS rerender of that section's own template is needed — but the preview iframe's DOM must reorder the already-rendered section fragments to match the new array order (doc 09), which is a DOM re-position, not a re-render.

**Diff & validation:** one `moved` `Diff` entry (doc 14) on the containing `sections[]` array, recording the before/after index (and, for a cross-region move, the before/after array). Validation bounds-checks the target index against the resulting array length — an out-of-range index is a hard block, though this should be unreachable from a UI that only ever offers valid drop targets.

### 06.3.5 Edit Text / Richtext Field

**User interaction:** clicking directly into rendered text inside the preview and typing. **This is the canonical iframe-DOM-triggered operation.** Per doc 09, the section's Liquid template emits the DOM elements that carry text-typed and richtext-typed settings with identifying attributes the editor uses to map that element back to a Store Configuration path; when the user clicks such an element, the editor toggles `contentEditable` on it (rather than opening a separate modal), and the user types directly into the live-rendered text. A `text`-typed setting behaves as plain single-line/multi-line editable content; a `richtext`-typed setting constrains the editable region's allowed formatting (bold/italic/link/list) via the browser's own contentEditable formatting commands scoped to that allowlist, so the value that eventually gets read back out never exceeds what the section's Liquid expects to render. The identical field is also editable from the Inspector panel (a plain text/richtext input bound to the same setting) for users who prefer the side panel or are editing a field not currently visible in the viewport — both paths write the same Store Configuration key.

**The critical rule (doc 09):** `contentEditable` is an *interaction mechanism only*. The Store Configuration remains the single source of truth at all times. Typing into the DOM does not, by itself, persist anything — on commit (blur, or a debounced interval during continuous typing), the current text content is **read back out of the DOM element** and written into the Store Configuration at the matching path. Arbitrary DOM mutations are never persisted directly; only the value read back through this defined path ever reaches the Store Configuration.

**Store Configuration write:** `pages.<pageId>.sections[<id>].settings.<settingId>` for a section-level field, or `pages.<pageId>.sections[<id>].blocks[<blockId>].settings.<settingId>` for a block-level field (e.g. one FAQ item's answer text within a blocks array).

**Preview update:** committing the read-back value triggers a LiquidJS rerender scoped to the owning section (doc 09) — in the common case this simply re-confirms what the user already sees (since they were typing directly into the live DOM), but the rerender is still the mechanism that keeps the Store Configuration and the rendered HTML from ever silently diverging, and it's what propagates the edit to any other place the same section instance might be reflected (there is none today, since a given instance renders exactly once, but the rerender-on-commit contract is uniform across every field type for this reason).

**Diff & validation:** one `modified` entry (doc 14) at the settings path above. Validation confirms `settingId` exists on that section/block's schema and the value's shape matches its declared type — a hard block if not, though this should be unreachable from the UI since only fields the schema declares are ever made `contentEditable` or shown in the Inspector to begin with. For `richtext` specifically, the value is sanitized against an allowlist of tags (`p`, `br`, `strong`, `em`, `a[href]`, `ul`/`ol`/`li`) on write — this applies identically whether the text originated from direct typing or from an AI-generated copy suggestion accepted into the field, since AI-produced content is untrusted input like any other (doc 20's content-sanitization posture).

### 06.3.6 Edit Image

Three distinct interactions, all landing on the same section field, distinguished by where the new image content comes from. All three are **React-panel-triggered** — image selection, upload, and generation all require UI (a file picker, an asset library grid, a generation prompt) that doesn't have a meaningful in-place DOM equivalent the way text does. Clicking an image in the preview selects its owning section/setting (doc 09's click-to-select mapping) and opens the Inspector to the relevant field; the actual replacement happens in the Inspector or a modal it opens, not by manipulating the `<img>` element in the iframe directly.

**(a) Upload new.** User drags a file onto an `image_picker`-typed field's Inspector control, or clicks "Replace image" and picks from a file dialog or the Assets library (doc 19 §19.3). **Store Configuration write:** two writes — one registering the uploaded file as an asset reference, and one pointing the field at it: `pages.<pageId>.sections[<id>].settings.<settingId> = <assetRef>`. Kept as two independently-reversible writes so undoing the setting swap alone leaves the uploaded asset in the library rather than deleting it.

**(b) AI-generate replacement.** User clicks "Generate with AI" on an image field (from the Inspector or a scoped AI-panel prompt, doc 19 §19.4.6). Unlike Section Liquid, **images are ordinary content assets** and remain fully within scope for AI generation — the "Sections are never AI-generated" constraint (§06.3.1) applies to Liquid templates, not to the media those templates render. This calls the image-generation endpoint, producing a generated asset; on acceptance, the same two-write pattern as (a) runs, tagging the asset's origin as AI-generated. This is a credit-consuming generative action even though it never touches Liquid.

**(c) Crop / focal point.** Offered **only if the section's own schema exposes a setting for it.** Because we author every Section Definition ourselves, whether a given Section supports focal-point adjustment is a deliberate authoring decision, not a discovery problem — a Section that supports it declares a companion setting (e.g. a `select`-typed "image position" field, or numeric offset settings) alongside its `image_picker` field. When such a companion setting exists, adjusting it is an ordinary field edit — write to that `settingId`, same as any other setting. When it doesn't exist, the Inspector does not synthesize a crop/focal-point control; the image simply isn't repositionable for that section. This is the direct application of the general rule stated in full in §06.3.11: the editor never shows a control a Section's own schema doesn't declare.

**Preview update:** LiquidJS rerenders the owning section (doc 09) with the new `settings.<settingId>` value once the asset write and the setting write both land.

**Diff & validation:** one `added`/`modified` `Diff` entry at the asset reference and one `modified` entry at the settings path — two entries from two writes. Validation enforces asset size/type limits before any file is written — an oversized or wrong-format upload/generation is a hard block. A separate check confirms the setting's new value resolves to a real, existing asset reference. AI-generated images run through the same untrusted-content handling as any AI output (doc 20) before being offered for acceptance.

### 06.3.7 Edit Button

**User interaction:** a "button" in a Section is, from the schema's point of view, a small cluster of independent settings — never a single monolithic field. Typically a `text` setting for the label, a `url` setting for the link target, and, only where the Section schema declares one, a `select`-typed setting for per-button style (e.g. solid/outline). The Inspector groups these visually into one "Button" control card, but each remains a distinct setting with its own `settingId` — the grouping is presentational only. **Mixed trigger:** the label is ordinary text content, so where the section's markup exposes it as an editable DOM element, it follows §06.3.5's `contentEditable` path directly in the preview; the link target and style are not naturally expressed as in-place DOM edits (a URL field and a style dropdown have no sensible "click the rendered thing and type" equivalent), so those are **React-panel-triggered** exclusively, through the Inspector's Button card.

**Store Configuration write:** one write per field edited — label, link, and style are three independent writes if all three change in one editing session, not one composite write. This matters for undo granularity: undoing "button style" doesn't also revert the label the user typed a minute earlier. Each writes `pages.<pageId>.sections[<id>].settings.<settingId>` (or the block-scoped equivalent, if the button lives inside a block — e.g. a slide's CTA button in a carousel block).

**Preview update:** each committed write triggers a LiquidJS rerender scoped to the owning section (doc 09); three edits in one session produce three scoped rerenders (or are coalesced into one rerender pass if they land within the same debounce window — an implementation optimization, not a change in what gets written).

**Diff & validation:** one `modified` `Diff` entry per edited setting — no new shape beyond §06.3.5's. Validation runs per setting independently (a `url`-typed field rejects a non-URL value, a `select`-typed style field rejects a value outside its declared options). If the Section has **no** per-instance style setting at all — style is purely a `globalStyles.buttons` token, not overridable per section — the Inspector's button card omits the style control entirely and shows a link into Global Settings > Buttons (§06.4) instead of a disabled/fake control, so the user isn't left wondering why a visible control doesn't do anything.

### 06.3.8 Edit Spacing / Padding

**User interaction:** a spacing/padding control in the Inspector, shown per-section only when that Section's schema declares its own spacing setting (commonly a `range`-typed `padding_top`/`padding_bottom`). **Primarily React-panel-triggered** via the Inspector slider. Where a Section is specifically authored to support it, a secondary direct-manipulation path exists: a drag handle drawn by React as an overlay positioned over the section's top/bottom edge in the preview (using the section's on-screen bounding box, synced from the mapped DOM element — doc 09; doc 19 §19.4.4 states this overlay-vs-iframe placement decision explicitly). This handle is a React-rendered element sitting on top of the iframe, not an element injected into the iframe's own DOM — dragging it still resolves to the same Inspector-equivalent write on release, it's simply a second, more direct affordance for the same underlying field. A Section only gets this handle if it explicitly opts in; most don't, and use the Inspector slider only.

**Two distinct scopes, and the Inspector must make the distinction explicit rather than presenting one generic "spacing" control:**

- **Section-level override:** the Section schema declares its own padding setting → writes `pages.<pageId>.sections[<id>].settings.<settingId>`. Affects only this one instance.
- **Global spacing:** the Section has no per-instance padding setting, and the only lever is the theme-wide token → writes `globalStyles.spacing.sectionSpacing`. Affects every section that doesn't itself override spacing.

When a section has no schema-declared spacing setting, the Inspector shows a passive note ("This section doesn't expose custom spacing — adjust the global section spacing") linking to Global Settings, rather than fabricating a per-section control that would silently do nothing.

**Preview update:** a section-level write rerenders only that section (doc 09); a global-spacing write potentially rerenders every section on the currently-open page that doesn't declare its own override, since the token is read by any such section's Liquid template.

**Diff & validation:** one `modified` entry at the section-level or global path — the path alone tells you, in the `Diff` history, which of the two scopes an edit landed in. Validation checks range/step conformance against the setting's declared `min`/`max`/`step` for section-level edits; for global spacing changes specifically, doc 15's responsive-validation layer runs a structurally-computable check — a spacing value that would compute to a negative or zero content width once combined with the Base Theme's existing responsive layout at a defined breakpoint is a hard block.

### 06.3.9 Edit Colors

Because we own the Base Theme and every Section Definition in the library, the color-scheme system every Section participates in is a deliberate design choice, not a contingent discovery about an unknown merchant theme — but the editor's behavior still differs by exactly what type a given setting declares, never a single "pick a color" UI regardless of type. **All color edits are React-panel-triggered** (Inspector or Global Settings) — color pickers and scheme dropdowns have no meaningful in-place DOM equivalent.

**Case A — the setting is scheme-typed.** The Inspector renders a **scheme picker** — a dropdown/swatch-grid of the Base Theme's named color schemes (`scheme-1`, `scheme-2`, …, defined in `globalStyles.colors`), not a hex input. Picking a different scheme writes `pages.<pageId>.sections[<id>].settings.<settingId> = "scheme-2"` — a single-value swap that changes *which* scheme this instance uses, not what any scheme's colors actually are. This is the default path for any setting the Section's schema models this way: **the editor always offers the existing-scheme picker over a raw hex input when the setting is scheme-typed** — introducing a one-off hex value there would fight the Base Theme's own design-token system and produce a section that no longer participates in a merchant's later scheme-wide color changes.

**Case B — editing what a scheme itself resolves to.** A separate, explicitly global action ("Edit scheme colors," reached from Global Settings > Colors, §06.4, not from any section's Inspector) changes the *colors a scheme name maps to* — writes `globalStyles.colors.<schemeName>.<role>`. This has a large blast radius — it changes every section anywhere in the store currently assigned to that scheme — so it is never reachable from a single section's Inspector; it always routes through Global Settings, where the "affects N sections across M pages" impact is shown before commit.

**Case C — the setting is a plain color field** (a one-off overlay tint some Sections deliberately expose alongside their scheme setting, rather than a scheme reference). Here a real hex/swatch picker is legitimate — writes `pages.<pageId>.sections[<id>].settings.<settingId> = <hex>` — because we authored the field as a raw color, not a scheme reference. The editor decides which of Case A/C to render purely from the setting's declared type; it never "upgrades" a plain color field into a scheme picker and never "downgrades" a scheme field into a hex input.

**Preview update:** Case A/C rerenders only the affected section (doc 09). Case B rerenders every section on the currently-open page assigned to the changed scheme — potentially most of the page, since scheme reuse across sections is the point of the token system.

**Diff & validation:** Case A/C — one `modified` entry at the setting path. Case B — one or more `modified` entries, one per changed role within the scheme. Validation confirms a Case A value is one of the Base Theme's actual declared scheme names and a Case C value is a well-formed color value. A resulting contrast concern is flagged as a warning, never a hard block, where automatable (e.g. a scheme change that drives text/background contrast below a basic computable threshold) — genuine visual-quality judgment on color choices is left to the user.

### 06.3.10 Edit Typography

**Default lever — global.** Typography is a theme-wide design token by default: `globalStyles.typography` (`headingFont`, `bodyFont`, `scaleRatio`, `baseSize`). Editing these writes `globalStyles.typography.<field>`, reached from Global Settings > Typography (§06.4) — this is the only lever for the majority of Sections, since most Section schemas don't declare their own font/size settings. **React-panel-triggered**, via Global Settings.

**Section-level override — only where the schema declares one.** Some Sections (typically hero/banner-style) expose their own `font_picker` or `range`-typed heading-size setting. Where present, editing it is an ordinary write to `pages.<pageId>.sections[<id>].settings.<settingId>` via the Inspector, exactly like any other field — shown directly on the section, in addition to (not instead of) the global lever. The two are independent: a section-level override wins for that instance; the global token still governs every section without its own override. **React-panel-triggered** via the Inspector.

**Preview update:** a section-level override rerenders only that section (doc 09). A global typography change rerenders every section on the currently-open page that doesn't declare its own font/size override — potentially the whole page.

**Diff & validation:** one `modified` entry at `globalStyles.typography.<field>` (global) or the settings path (section override). Validation checks `font_picker` values against the Base Theme's available font list, and `range`-typed size values against declared `min`/`max`/`step`. A global typography change additionally samples a representative set of page types (home, product, collection, cart) for rendering validation, since a font/scale change can affect layout broadly enough to be worth checking beyond just the section that was selected when the edit was made.

### 06.3.11 Edit Layout (columns, alignment)

**User interaction:** layout-shaped controls (column count, alignment, grid density) in the Inspector, rendered **strictly from `select`/`range`-typed settings the Section's own schema declares** — e.g. a `select` setting with options `["2", "3", "4"]` for column count, or `["left", "center", "right"]` for alignment. **React-panel-triggered**, via the Inspector.

**This is the sharpest statement of a rule that recurs throughout this document (§06.3.6c, §06.3.8): the editor is a faithful surface over exactly what a Section's own schema declares — never a superset.** If a Section's schema caps columns at 3, the Inspector's column control has three options, full stop; it does not add a "4" option because a 4-column layout is conceptually plausible for that kind of section. Because every Section Definition is ours, this rule has a cleaner justification than it did under the old arbitrary-theme design: it isn't merely "we can't be sure a 4th option would render correctly," it's "we know exactly what the Liquid template supports, because we wrote it, and the schema is the single declared contract between that template and the editor." What the user sees in the editor and what actually exists in the Section's Liquid can never drift apart.

**Store Configuration write:** `pages.<pageId>.sections[<id>].settings.<settingId>` — no different from any other field edit; layout settings aren't a distinct write category, only a distinct *UI grouping* in the Inspector.

**When a section genuinely doesn't support the layout change a user wants** (e.g. "make this a 4-column grid" on a Section schema-capped at 3): this is out of scope for the Visual Editor entirely, by design, and — because Sections are never AI-generated (§06.3.1) — it is equally out of scope for the AI operation system. It is not a degraded or disabled control; it's simply absent, with a link into the AI panel scoped to that instance (doc 19 §19.4.3's "ask AI about this" shortcut) so the user can at least ask whether a different existing Section or preset gets closer to what they want. The Operation Planner (doc 11) applies its normal reuse-before-refusal search across the fixed library; if nothing in it satisfies the request, that's the end of the line for this specific ask, surfaced honestly rather than routed into any kind of live code generation.

**Preview update:** LiquidJS rerenders only the affected section (doc 09).

**Diff & validation:** one `modified` entry, identical shape to any field edit. Validation enum-checks the value against the setting's declared options — a value outside them is a hard block, though this should be unreachable from the UI since the Inspector only ever offers declared options to begin with.

### 06.3.12 Toggle Visibility (per device)

**User interaction:** three small toggles (desktop / tablet / mobile, matching the toolbar's device-switcher iconography, doc 19 §19.4.2) on a Structure panel row or in the Inspector's section-level controls — present identically for every section instance regardless of Section type, since visibility is modeled independently of any Section's own schema, letting the editor render one universal visibility control regardless of type. **React-panel-triggered.**

**Store Configuration write:** `pages.<pageId>.sections[<id>].visibility.<breakpoint> = <boolean>` — one write per breakpoint toggled. Toggling all three off is a distinct action from `disabled` (§06.4's related "disable entirely" toggle) — a section hidden on every device via `visibility` is conceptually "hidden everywhere for now, reversible per device," while `disabled: true` is "fully off, one flag."

**Preview update:** the preview iframe shows/hides the section's rendered fragment for the currently-active device viewport (doc 09) — this can be a pure DOM show/hide against the already-rendered fragment for the device the user is currently looking at, without requiring a fresh LiquidJS render, since the underlying settings/blocks didn't change.

**Diff & validation:** one `modified` entry per toggle — each breakpoint's toggle is its own write and its own `Diff` entry, so undo can target exactly the breakpoint that was changed, not all three. Validation warns — never hard-blocks — if disabling a section on `mobile` would leave no equivalent for genuinely critical content (e.g. the only nav/cart-access section on the page) with nothing shown in its place on that device; deliberately hiding a section on a given device is a completely normal, common editing action.

### 06.3.13 Responsive Controls generally

Beyond the visibility toggles (§06.3.12), "responsive" editing in Shopforge is not a separate control category layered on top of the write path — it is the device switcher (doc 19 §19.4.2) changing **which settings the Inspector foregrounds**, against the same field-write mechanism as any other edit:

- Some Section schemas declare genuinely separate settings per breakpoint (e.g. `columns_desktop` and `columns_mobile` as two distinct settings) — both exist in the Store Configuration at all times regardless of which device the switcher shows; switching to "mobile" simply brings `columns_mobile`'s control forward in the Inspector (and greys or collapses `columns_desktop`'s), so the user is editing the field relevant to what they're currently looking at without the two ever being confused as one setting.
- Where a section has no such per-breakpoint split, there is no separate mobile-specific value to edit — the single setting applies at every breakpoint, and the Inspector doesn't fabricate a device-scoped variant that doesn't exist in the schema (same rule as §06.3.11).
- The device switcher itself never triggers a write on its own — switching from desktop to mobile view is a **local, ephemeral UI state change** (doc 19 §19.5), changing only the preview iframe's viewport width and which breakpoint's visibility/setting-split values are foregrounded. It does re-render the preview if a Section uses container-query-driven layout that genuinely differs at that width, but that's the LiquidJS-rendered HTML responding to a CSS viewport change the same way it would for a real visitor, not a new Store Configuration write.

**Diff & validation:** identical to whatever underlying field is being edited (§06.3.5–§06.3.11) — responsive editing has no separate `Diff` shape or validation layer of its own beyond the responsive-validation layer's breakpoint-consistency and overflow/clipping checks, which run on every write touching layout/spacing/visibility regardless of which device the editor happened to be showing when the edit was made.

---

## 06.4 Global Settings

Global Settings is what the Inspector shows when nothing is selected (doc 19 §19.4.5) — controls bound to `globalStyles` and, for anything `globalStyles` doesn't structurally model yet, directly to `themeSettings` (the Base Theme's own settings, in the raw-passthrough sense described in §06.2). **Entirely React-panel-triggered** — there is no iframe-DOM equivalent for a global control, since Global Settings by definition isn't scoped to any one rendered element. Every area below resolves to exactly one of two write paths, and the panel is honest about which:

| Area | Primary write path | Notes |
|---|---|---|
| **Colors** | `globalStyles.colors.<role>` or `.<schemeName>.<role>` for scheme-modeled stores | See §06.3.9 Case B for the scheme-editing flow specifically. |
| **Typography** | `globalStyles.typography.<field>` | `headingFont`/`bodyFont`/`scaleRatio`/`baseSize` — the full structured set. |
| **Buttons** | `globalStyles.buttons.<field>` | `radius`/`borderWidth`/`shadow`/`style` — structured. This is the site-wide button style §06.3.7 falls back to when a section has no per-instance override. |
| **Spacing / container widths** | `globalStyles.spacing.<field>` | `sectionSpacing`/`containerWidth` — structured. This is the fallback §06.3.8 falls back to when a section has no per-instance padding setting. |
| **Forms (inputs)** | `themeSettings.<settingId>` | Not a structured `globalStyles` field — the Base Theme models input styling (border radius, focus color) as a handful of raw settings, same shape as any Section schema's settings, just scoped globally rather than to one section. |
| **Cards** | `themeSettings.<settingId>` (raw) | Card style/corner-radius/image-ratio settings are Base Theme-specific raw entries, not a first-class `globalStyles` sub-object today — same passthrough path as Forms. |
| **Borders** | `globalStyles.buttons.borderWidth` where the border in question is a button border (structured); `themeSettings.<settingId>` (raw) for card/input/section-level border settings | Whether a given "border" control is structured or raw depends entirely on whether it's the specific button-border token `globalStyles.buttons` models, or one of the Base Theme's own additional border settings — the panel doesn't merge these into one generic "borders" concept, since they genuinely aren't unified in the Store Configuration. |
| **Shadows** | `globalStyles.buttons.shadow` (structured, buttons only) or `themeSettings.<settingId>` (raw, for card/section shadow settings) | Same split as Borders, for the same reason. |
| **Breakpoints** | Not exposed as a field edit at all | Breakpoints are fixed in the Base Theme's CSS rather than declared as a setting — there is no `settingId` to bind a control to. Global Settings does not fabricate a breakpoint editor. A genuine breakpoint change is an engineering change to the Base Theme itself, not a per-store customization, and is out of scope for both the manual editor and the AI operation system (Sections and the Base Theme are never AI-generated or AI-modified in place — §06.3.1). |

**The general rule this table encodes:** a Global Settings control is backed by a structured `globalStyles` write only for the four sub-objects it actually models (`colors`, `typography`, `buttons`, `spacing`); everything else the Base Theme declares — however visually similar it looks in the panel — is bound through `themeSettings`, and the panel groups these raw entries **by the Base Theme's own declared category headers**, so Global Settings renders one control per declared setting, grouped by whatever category the Base Theme's own schema already puts it in, regardless of whether that category also happens to have a structured `globalStyles` projection.

**Preview update:** the four structured `globalStyles` categories can each be read by any section on the currently-open page, so a global write potentially rerenders every section on that page that doesn't have its own override for the changed token (doc 09) — this is the widest-blast-radius write category in this document short of a page-wide operation. A `themeSettings` (raw) write rerenders only the sections whose Liquid templates actually reference that specific setting, which for most raw settings (forms, cards) is a smaller, predictable subset.

**Diff & validation:** one `modified` entry at `globalStyles.<path>` (structured) or `themeSettings.<settingId>` (raw) per edited field. Validation runs type/option/range conformance against the declared setting, same as any section-level field. Because a global write's blast radius spans every page, doc 15's runtime/rendering validation layer always samples a representative set of page types (home, product, collection, cart) rather than only the page the user happened to be viewing, and the responsive-validation layer's structural checks (e.g. negative computed width) apply with the same severity as a section-level spacing edit (§06.3.8).

---

## 06.5 Editor States

The editor exposes explicit, user-visible states beyond the layout-level table already given in doc 19 §19.4.8 — this section goes one layer deeper on triggers, what the user sees, and — the part doc 19 leaves open — exactly how each state behaves when an AI operation is executing concurrently.

### 06.5.1 State-by-state detail

| State | Trigger | What the user sees |
|---|---|---|
| **Loading** | Initial fetch of the current Store Configuration (doc 18), or switching to a different saved version | Skeleton canvas/panels; toolbar actions disabled; the preview iframe has nothing loaded yet. The `lockVersion` returned with this fetch (doc 18's concurrency model) becomes the client's baseline for every write until the next fetch. |
| **Saving — autosave** | A local write has been applied optimistically and no explicit "Save" action has been taken. Writes are batched: the client waits for a rolling ~2s idle window after the last write (capped at a ~10s max wait so a continuously-dragged slider still persists periodically rather than only on release) before issuing the persistence call. | Small unobtrusive "Saving…" near the version label; canvas/panels stay fully interactive. |
| **Saving — explicit** | User clicks "Save," or the editor forces a flush before Publish or before navigating away with pending changes. | Toolbar save control shows a spinner; Publish stays blocked until this resolves. |
| **Saved** | Persistence call confirms, returning the new `lockVersion` (doc 18). | "Saved" indicator with a timestamp, reverting to neutral after a few seconds. |
| **Unsaved changes** | A local write exists whose persistence call hasn't yet confirmed (mid-debounce, or a save attempt failed and hasn't retried). | Dot/asterisk on the version label; leaving the editor prompts a confirmation. |
| **Error** | A write is rejected (validation hard block, doc 15), a save fails (network, or a `409` stale-`lockVersion` conflict, doc 18), or the initial Store Configuration fetch fails. | Inline error scoped to the affected panel — a preview-iframe overlay for a render/apply error, toolbar banner for a save/network/conflict error — with a retry action. A `409` conflict specifically re-fetches the current Store Configuration/`lockVersion` and re-applies the user's still-pending local write against it rather than discarding the user's edit outright. |
| **Undo / Redo** | User action or keyboard shortcut, available whenever the local undo/redo stack (doc 14) is non-empty in that direction. | Toolbar buttons enable/disable to match stack state; hovering previews the target `Diff`'s human-readable summary. Undo/redo operate over the single unified `Diff` stream regardless of origin — the next undo targets whichever `Diff` is most recent in that stream, editor-originated or AI-originated. |
| **Preview** | User toggles "Preview." | Structure/Inspector/AI panels collapse; the preview iframe expands full-width, hover/selection affordances disabled, rendering exactly what a storefront visitor would see for the current device — because it *is* the same LiquidJS-rendered HTML a visitor's browser would receive (doc 09), this state requires no separate "visitor view" render path. |
| **Device switch (desktop/tablet/mobile)** | User selects a device in the toolbar. | Preview iframe viewport resizes; the active `visibility` breakpoint and any per-breakpoint setting split (§06.3.13) become what the Inspector foregrounds. Purely local UI state — no write, no `Diff`. |

### 06.5.2 Concurrency with an in-flight AI operation

**Decision: a user can keep manually editing while an AI plan is executing, with one exception — the specific section instances (or other Store Configuration paths) that plan's currently-applying step targets are soft-locked for the duration of that step, not the whole editor.**

**Mechanism.** Every AI-planned operation already declares its own scope — the Store Configuration path it targets, plus any narrow, allow-listed secondary paths a change of that type is permitted to also touch (doc 15's regression-validation layer defines and enforces this precisely, for validation purposes). The concurrency lock reuses that same notion of scope rather than inventing a second one:

- The instant an operation's execution status moves from *queued* to *applying* (doc 19 §19.4.7 step 4), the server marks every path in that operation's declared scope as locked, keyed by the current Store Configuration version plus path, with a short TTL matching expected execution time. This lock is broadcast to every connected client editing that store over the same live-sync channel that already propagates Store Configuration updates.
- The instant that operation's status moves to *applied* (its `Diff` has committed) or *failed*, its lock releases immediately — a multi-step plan therefore unlocks section-by-section as steps land, not all at once at the end of the whole plan. A four-step plan touching four different sections locks and unlocks each in turn; a plan whose steps repeatedly touch the same instance simply keeps that one instance locked across those consecutive steps.
- For a section-scoped operation (a setting update, a section move, a block add), the lock covers exactly that section instance's path — every other section on the page, and every other panel, stays fully editable.
- For a global-scope operation (a `globalStyles` or `themeSettings` write), the lock widens to whatever the operation's own declared target actually is — a `globalStyles.colors` write locks that category's Global Settings controls (§06.4) — but never wider than the target actually names. If a global write's true blast radius later turns out to be broader than declared, that is caught by regression validation as a hard block on that operation (doc 15) — the live lock does not need to pre-anticipate an out-of-scope side effect; the validation pipeline is what guarantees the operation never lands if it has one.

**What the user sees on a locked instance:** the Structure panel row shows a small spinner/"AI editing…" badge; the preview dims or outlines the section with the same indicator (a React overlay drawn on top of the preview iframe, consistent with how selection/hover indicators are drawn — doc 19 §19.4.4); the Inspector, if that instance is selected, shows its fields disabled with an inline note ("AI is currently updating this section — hold on") rather than silently accepting input that would be rejected. The block happens client-side, before a write is even issued, for immediate feedback; the server enforces the same lock as the authoritative backstop (a write against a currently-locked path is rejected) in case a client's view of the lock state is stale.

**Why instance-level locking rather than locking the whole editor:** a whole-editor lock would mean every AI-assisted turn — including the common case of a single narrowly-scoped, selection-driven request (doc 19 §19.4.6) — freezes the entire page for however long that operation takes to execute and validate. That directly undermines the product's central design commitment that the visual editor and the AI aren't two separate modes fighting for control of the same document, but one continuous surface over the same Store Configuration. Scoping the lock to exactly what validation already treats as "this operation's legitimate footprint" costs nothing new to compute, keeps the common case (one section touched) fully non-disruptive to the rest of the page, and only ever restricts the user from doing the one thing that would actually be unsafe: hand-editing the exact same path the AI is mid-write on.

**Both paths ultimately produce the same thing.** A concurrent AI operation and a manual edit are not two different kinds of change reconciled by some special-case logic — both resolve to a write against a Store Configuration path, and both produce a `Diff` entry in the same unified stream (doc 14). The locking scheme above exists purely to prevent the *ordinary but unhelpful* case of a user and the AI both trying to write the same path at the same moment; it is a UX-layer convenience, not a data-integrity mechanism. Doc 14 owns the actual diff/undo/conflict mechanics that make either kind of write safely reversible regardless of origin — this document does not re-derive them.

**Relationship to `lockVersion` (doc 18).** This section's soft lock is a UX-layer guard that prevents the common in-session conflict before it happens; it is not a replacement for the compare-and-swap `lockVersion` mechanism doc 18 already defines as the system's actual data-integrity backstop. The two operate at different layers and both remain in force: the soft lock stops *this session's* editor from racing *this session's* AI panel over the same section (the everyday case, since doc 19 §19.4 puts both in one screen); `lockVersion`'s per-operation compare-and-swap (doc 18 — re-validated before each step of a plan, not just once) is what still protects correctness if the soft lock is bypassed entirely — a second browser tab or a second collaborator with no visibility into the first session's in-flight plan. In that cross-session case, doc 18's existing behavior applies unchanged: already-applied steps are kept (each is independently valid and reversible), remaining steps abort as `conflicted`, and the user is prompted to re-plan against the now-current Store Configuration.

**Undo while a plan is mid-execution.** Undo always targets the most recent committed `Diff` in the unified stream (§06.5.1's Undo/Redo row), regardless of origin. A step that is still *applying* hasn't produced a `Diff` yet, so it isn't a candidate for undo until it lands — hitting undo mid-plan undoes the most recent already-*applied* step (AI or manual), and does not disturb whatever the executor is still working on. If a later, not-yet-executed step in the same plan targets the same path the user just undid, no special-casing is needed: the executor always reads current live Store Configuration state per step (never a snapshot taken at plan-start), so that later step simply computes against the just-undone value, exactly as if a manual edit had landed there between two AI steps for any other reason.

**Plan review vs. execution.** Nothing is locked during the "Analyzing/streaming plan" or "Plan review" states (doc 19 §19.4.7 steps 2–3) — those are read-only previews of what *would* happen. Locking begins only once the user confirms and a step actually starts applying; a plan the user never confirms never locks anything.

---

## 06.6 Cross-references

- Doc 09 (Preview Rendering & Interaction Architecture) defines the LiquidJS Preview Renderer, the same-origin preview iframe, and the click-to-select/`contentEditable` DOM-to-Store-Configuration mapping that every "triggered from the preview" operation in this document depends on.
- Doc 14 defines the `Diff` schema every "Diff & validation" subsection above instantiates, and the undo/redo/revert mechanics §06.5.1 and §06.5.2 build on.
- Doc 15 defines the validation layers referenced throughout §06.3–§06.4, and specifically the operation-scope concept §06.5.2 reuses for its concurrency lock.
- Doc 18 defines the `/editor/*` endpoint contracts and the `lockVersion` compare-and-swap concurrency model §06.5.2 sits on top of.
- Doc 19 defines the panel layout (Structure/Section Navigator, Canvas/preview, Inspector, AI panel), selection-driven AI scoping, and the plan/progress lifecycle (§19.4.7) this document's operations and states are triggered from and rendered into.
- Doc 11 defines how an AI-suggested operation is planned against the existing Section library — including how a request that no existing Section/preset can satisfy is surfaced honestly rather than routed into code generation, referenced in §06.3.1 and §06.3.11.
- Doc 20 covers sanitization of AI-produced content before it reaches an editable field, referenced in §06.3.5 and §06.3.6.
