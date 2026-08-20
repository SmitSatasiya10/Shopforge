# 06. Editor Specification

Status: proposed design
Depends on: architecture-core §2 (`ThemeModel`), §3 (`Operation` schema), §4 (`Diff` schema); doc 09 (Theme Model + mutation API, §4 in particular); doc 15 (Validation); doc 18 (API/concurrency model)
Scope note: doc 19 (Frontend Architecture) specifies the Visual Editor's *layout* — panels, toolbar, canvas chrome. This document specifies the **editing operations themselves**: for every action a user can take, exactly which `ThemeModel` mutation function it calls, what `Diff` it produces, and what validation runs before it lands. Where doc 19 already describes a UI surface (Structure panel, Inspector, AI panel, selection scoping), this doc references it rather than re-describing it.

---

## 06.1 Purpose

The Visual Editor is a point-and-click surface over the exact same mutation API the AI Operation Executor calls (Principle 7; doc 09 §4, §6). Nothing in this document introduces a new way to change a theme — every operation below resolves to one or more calls from doc 09 §4's mutation table, produces the same `DiffEntry` shapes doc 14 defines, and passes through the same validation pipeline doc 15 defines. The Visual Editor's job is to make that API discoverable and immediate; it has no private write path.

**On Dropmagic (competitive context):** our research into Dropmagic's editor (`/tmp/.../research-dropmagic.md`) found only capability-level marketing claims — drag-and-drop reordering, text/image edits, adjustable spacing, 57+ section types — with no verifiable detail on its actual UI chrome, field-level controls, or state model (flagged NOT PUBLICLY VERIFIABLE in that research). This document does not borrow any editor-UI specifics from Dropmagic; the operation set and mutation model below are derived entirely from Shopforge's own `ThemeModel`/`Operation` design (architecture-core §2–§3).

---

## 06.2 How each operation is documented

Every subsection in §06.3 follows the same four-part structure:

- **User interaction** — what the user does in the UI (doc 19 panels) to trigger the operation.
- **Mutation call** — the exact doc 09 §4 function(s) invoked, in call order if more than one.
- **Diff entries produced** — the `DiffEntry` `kind`/`path` shape(s) that result (doc 09 §4 table; architecture-core §4).
- **Validation triggered** — which doc 15 layers apply, and what a hard block vs. warning looks like for this specific operation.

A field edit is never applied by writing directly into client state and calling save later — every mutation call above is issued (optimistically applied locally, then confirmed by the server) the moment the user commits a value, per doc 19 §19.5's mutation flow. What autosave batches is the **persistence** of already-applied mutations, not the mutations themselves — see §06.5.

---

## 06.3 Editing Operations

### 06.3.1 Add Section

**User interaction:** "+ Add" affordance in the Structure panel (at a specific insertion index, or at the top/bottom of a template) or on hover between two sections on the canvas. Opens a section picker listing every `ThemeManifest.sections[]` entry valid for the current template's `resourceType`, each shown with its available `PresetDef`s as selectable variants (e.g. a "Featured collection" section might offer "Grid" and "Carousel" presets). A second entry point exists from the AI panel: when an `add_section` step appears in a reviewed Operation Plan (doc 19 §19.4.7) and the user clicks "Apply," the same mutation fires — the only difference is the section type/position/preset were chosen by the Operation Planner (doc 11) rather than picked from the UI list.

**Mutation call:** `addSectionInstance(themeVersionId, templateKey, sectionType, position, presetName?)`. If `presetName` is supplied (from-preset path), settings/blocks seed from that `PresetDef`; if omitted, the schema's own defaults seed the instance. If the AI-suggested section requires code that doesn't exist yet in the theme (Operation Planner determined no `sectionType` or block substitution satisfies the request — doc 11 §5), the plan instead runs `registerNewSectionType(themeVersionId, sectionType, liquidSource, schema)` first, then `addSectionInstance` referencing the newly-registered type. This generative path is never reachable from the plain "+ Add" picker — the picker only ever lists section types that already exist in the Manifest; a request for a section type the theme doesn't have is a chat/AI-panel-only path (Principle 3: minimal AI generation), never a manual editor button.

**Diff entries produced:** one `added` at `sections.{newInstanceId}` (the new `SectionInstance`), plus one `modified`/`moved` at `templates.{templateKey}.sectionInstances` reflecting the insertion index (doc 14 §2's example of `add_section` touching two paths in one operation). If the section was added into a section group instead of the template body, the second entry's path is `templates.{templateKey}.sectionGroups.{header|footer}` instead.

**Validation triggered:** doc 15 Layer 2 (theme-model) confirms `sectionType` exists in the Manifest and `presetName`, if given, matches a real `PresetDef` on that section — hard block otherwise. Layer 9 (regression) confirms the resulting Diff only touches the new instance and the declared template's ordering array — `add_section`'s allow-listed secondary effect is exactly that ordering array, per doc 15 §11. For the generative (AI-suggested, code-generating) path specifically, Layers 4–7 (Liquid syntax, JSON/schema conformance, asset-reference, runtime render) all run before the section is ever offered as applied, since `registerNewSectionType` writes new Liquid source (doc 15 §6–§9); the plain from-preset path skips all of these, since it never touches Liquid.

### 06.3.2 Remove Section

**User interaction:** delete icon on a Structure panel row, or a context-menu "Remove" on the canvas selection. The client shows a **confirmation dialog** — not a silent delete — in either of two cases:
- **Referenced elsewhere:** the instance lives in `TemplateNode.sectionGroups.header`/`.footer`, which per doc 09 §3 step 3 is *shared* across every template that references that layout. The dialog names every affected template ("This section appears in the header shown on 6 templates — removing it will remove it everywhere").
- **Has content:** the instance has any non-default setting value or one or more blocks (i.e., it isn't sitting at its just-added defaults). This is judged client-side from the already-loaded `ThemeModel`, no extra round-trip needed.

A section with neither condition (plain-template-body, still at defaults, no blocks) deletes immediately without a dialog — the confirmation exists specifically to protect content a user would be upset to silently lose, not to add friction to every delete.

**Mutation call:** `removeSectionInstance(themeVersionId, instanceId)`.

**Diff entries produced:** one `removed` at `sections.{instanceId}`, with the full prior `SectionInstance` stored as `before` (doc 09 §4 — this is what makes undo a clean re-insertion, not a reconstruction), plus one `modified` at the owning `templates.{templateKey}.sectionInstances` (or `.sectionGroups.{header|footer}`) reflecting removal from the ordering array — same paired-entry pattern as add (§06.3.1), the counterpart doc 15 §11 example that names `remove_section`'s allow-listed secondary effect explicitly.

**Validation triggered:** doc 15 Layer 2/Layer 6 (asset-reference) confirm no `templates/*.json` is left listing the removed section id after serialization — a dangling reference here is always a hard block (doc 15 §8's exact worked example). No warning tier exists for "are you sure" — that judgment is made client-side by the confirmation dialog above, before the mutation is even issued; the server-side pipeline only ever sees a decision the user already confirmed.

### 06.3.3 Duplicate Section

**User interaction:** "Duplicate" on a Structure panel row or canvas context menu. The copy is inserted immediately after the source instance in the same template/group.

**Mutation call:** `duplicateSectionInstance(themeVersionId, instanceId)` — deep-copies settings and blocks, minting a fresh `instanceId` and a fresh `blockInstanceId` per block (doc 09 §4: "`after` = deep copy of source instance with fresh `instanceId`/`blockInstanceId`s").

**Diff entries produced:** one `added` at `sections.{newInstanceId}`, plus one `modified` at the owning ordering array for the insertion — identical shape to Add Section (§06.3.1); duplication is, mechanically, "add" with the new instance's initial content pre-populated from an existing instance instead of a preset/default.

**Validation triggered:** Layer 2 re-checks `maxBlocks` is still respected for the duplicated block set against the section's Manifest-declared limit — this can only fail if the source instance was already at its `maxBlocks` ceiling and the duplicate is somehow asked to carry additional blocks, which the duplicate path never does (it copies exactly what the source has), so this check passes by construction for a straight duplicate. Layer 9 confirms no path outside the new instance and the ordering array was touched.

### 06.3.4 Reorder Section

**User interaction:** drag a Structure panel row (or, where the canvas supports direct manipulation, drag a section boundary on the canvas itself) to a new position and drop. The drop target resolves to an index within the current ordered list of `instanceId`s for that template body or section group — dragging across templates (e.g. into a header/footer slot from the body list) is a client affordance, not a default one; where offered, it resolves to a `toTemplateKey` change alongside `toIndex`.

**Mutation call:** `moveSectionInstance(themeVersionId, instanceId, toTemplateKey?, toIndex)`. Per doc 09 §2.2, this **never re-keys anything** — the `TemplateNode.sectionInstances` array is just an ordered list of stable `instanceId`s, so reordering is purely an array-position mutation; the `SectionInstance` record itself (settings, blocks, visibility) is untouched. This is exactly why `instanceId` exists as distinct from `sectionType`: two "featured-collection" instances can sit at any relative order without either one's identity or content changing.

**Diff entries produced:** one `moved`, path `templates.{templateKey}.sectionInstances`, `before`/`after` recorded as the index (and, for a cross-template/cross-group move, the template key or group name) — doc 09 §4's exact table entry for this function.

**Validation triggered:** Layer 2 bounds-checks `toIndex` against the resulting array length — an out-of-range index is a hard block (doc 15 §4's exact example category: "`move_section`/`reorder_block` target indices are within bounds"). If the drop target is a section group (header/footer) and the dragged section type isn't realistically renderable in that context (e.g. a section authored only for use in a page body being dropped into a header group it was never designed against), the client does not block this outright — Shopify's schema format has no standard "valid contexts" declaration for us to check structurally — but Layer 7 (runtime/rendering validation) will catch an actual render failure post-move, surfacing as a hard block with the concrete render error rather than a pre-emptive guess.

### 06.3.5 Edit Text / Richtext Field

**User interaction:** clicking a text/richtext `SettingDef`-backed field in the Inspector (or, where inline canvas editing is supported, clicking directly into the rendered text on the canvas) and typing. A `text`-typed setting is a plain single-line/multi-line input; a `richtext`-typed setting renders a constrained rich-text control (bold/italic/link/list — the same limited formatting subset Shopify's own richtext setting type supports, never a full HTML editor) so the stored value stays within what the section's Liquid expects to render.

**Mutation call:** `setSectionSetting(themeVersionId, instanceId, settingId, value)` for a section-level field, or `setBlockSetting(themeVersionId, instanceId, blockInstanceId, settingId, value)` for a block-level field (e.g. one FAQ item's answer text within a blocks array). Value commits on blur/debounced-keystroke, not on every keystroke individually — see §06.5 for the autosave debounce that batches the resulting persistence calls, though the local optimistic mutation itself is applied immediately so the canvas reflects typing live.

**Diff entries produced:** one `modified`, path `sections.{instanceId}.settings.{settingId}` (or `sections.{instanceId}.blocks.{blockInstanceId}.settings.{settingId}` for a block field) — doc 09 §4's table entries for these two functions.

**Validation triggered:** Layer 2 confirms `settingId` exists on that section/block's `SettingDef` list and that the value's shape matches the declared `type` — a hard block if the field doesn't exist (should be unreachable from the UI, since the Inspector only ever renders fields the schema declares, but the server-side check is the authoritative backstop regardless of client state). For `richtext` specifically, the value is sanitized against an allowlist of tags (`p`, `br`, `strong`, `em`, `a[href]`, `ul`/`ol`/`li`) before being written — this applies identically whether the text originated from direct typing or from an AI-generated copy suggestion accepted into the field, since AI-produced content is untrusted input like any other (Principle 10; doc 20's content-sanitization posture).

### 06.3.6 Edit Image

Three distinct interactions, all landing on the same section field, distinguished by where the new image content comes from:

**(a) Upload new.** User drags a file onto an `image_picker`-typed field (or clicks "Replace image" and picks from a file dialog / the Assets library, doc 19 §19.3). **Mutation call:** `setAsset(themeVersionId, file, newContentRef, "user")` to register the uploaded file as an `AssetRef`, followed by `setSectionSetting(themeVersionId, instanceId, settingId, file)` to point the section's `image_picker` setting at it. **Diff entries:** one `added`/`modified` at `assets.{file}` and one `modified` at `sections.{instanceId}.settings.{settingId}` — two separate calls, two separate entries, so either half is independently reversible (undoing the setting swap alone leaves the uploaded asset in the library rather than deleting it).

**(b) AI-generate replacement.** User clicks "Generate with AI" on an image field (from the Inspector or from a scoped AI-panel prompt, doc 19 §19.4.6). This calls `/ai/generate-image` (architecture-core §6), producing a `GeneratedAsset`; on acceptance, the same two-call pattern as (a) runs with `setAsset(themeVersionId, file, newContentRef, "ai", sourceGeneratedAssetId)`. This is a generative, credit-consuming action (architecture-core §3, §9) even though it never touches Liquid — cost accounting is per doc 22, not gated by `requiresNewCode`.

**(c) Crop / focal point.** Offered **only if the section's own schema exposes a setting for it** — Shopify's `image_picker` type has no built-in crop/focal-point sub-control of its own; a section that supports focal-point adjustment does so via a companion `SettingDef` (e.g. a `select`-typed "image position" field, or numeric offset settings) that the Manifest already lists alongside the `image_picker` field. When such a companion setting exists, it's an ordinary field edit — `setSectionSetting` against that `settingId`, same as any other setting. When it doesn't exist, the Inspector does not synthesize a crop/focal-point control; the image simply isn't repositionable for that section, which is the direct application of Principle 1/2 (never invent a capability the theme's own section doesn't declare) — see §06.3.11 for the general statement of this rule as it applies to layout controls.

**Validation triggered:** Layer 3 (Shopify) enforces asset size/type limits — an oversized or wrong-format upload/generation is a hard block before any file is written (doc 15 §5's exact worked example is an oversized generated image). Layer 6 (asset-reference) confirms the new `AssetRef` the setting now points at actually resolves. For AI-generated images specifically, the generation itself runs through the same untrusted-content handling as any AI output (doc 20) before being offered for acceptance.

### 06.3.7 Edit Button

**User interaction:** a "button" in a section is, from the schema's point of view, a small cluster of independent settings — never a single monolithic field. Typically a `text` setting for the label, a `url` setting for the link target, and, only where the section schema declares one, a `select`-typed setting for per-button style (e.g. solid/outline). The Inspector groups these visually into one "Button" control card, but each remains a distinct `SettingDef` with its own `settingId` — the grouping is presentational only.

**Mutation call:** one `setSectionSetting` (or `setBlockSetting`, if the button lives inside a block — e.g. a slide's CTA button in a carousel block) call **per field edited** — label, link, and style are three independent calls if all three change in one editing session, not one composite call. This matters for undo granularity: undoing "button style" doesn't also revert the label the user typed a minute earlier.

**Diff entries produced:** one `modified` per edited setting, each at `sections.{instanceId}.settings.{settingId}` (or the block-scoped equivalent) — no new Diff shape beyond §06.3.5's.

**Validation triggered:** Layer 2 for each setting independently (type/option conformance — a `url`-typed field rejects a non-URL value, a `select`-typed style field rejects a value outside its declared `options`). If the section has **no** per-instance style setting at all — style is purely a `GlobalStyles.buttons` token, not overridable per section — the Inspector's button card omits the style control entirely and shows a link into Global Settings > Buttons (§06.4) instead of a disabled/fake control, so the user isn't left wondering why a visible control doesn't do anything.

### 06.3.8 Edit Spacing / Padding

**User interaction:** a spacing/padding slider or numeric input in the Inspector, shown per-section only when that section's schema declares its own spacing-related `SettingDef` (commonly a `range`-typed setting like `padding_top`/`padding_bottom`).

**Two distinct scopes, and the Inspector must make the distinction explicit rather than presenting one generic "spacing" control:**

- **Section-level override:** the section schema declares its own padding setting → `setSectionSetting(themeVersionId, instanceId, settingId, value)`. This affects only this one instance.
- **Global spacing:** the theme has no per-section padding setting for the selected section, and the only lever is the theme-wide token → `setGlobalStyle(themeVersionId, "spacing.sectionSpacing", value)` (doc 09 §2.4's `GlobalStyles.spacing.sectionSpacing`). This affects every section that doesn't itself override spacing.

When a section has no schema-declared spacing setting, the Inspector shows a passive note ("This section doesn't expose custom spacing — adjust the global section spacing") linking to Global Settings, rather than fabricating a per-section control that would silently do nothing or, worse, write to a settingId that doesn't exist. This is the same "never invent a control the schema doesn't authorize" rule as §06.3.6(c) and §06.3.11.

**Diff entries produced:** one `modified` at `sections.{instanceId}.settings.{settingId}` (section-level) or `globalStyles.spacing.sectionSpacing` (global) — the path alone tells you, in the Diff history, which of the two scopes an edit landed in.

**Validation triggered:** Layer 2 range/step conformance against the `SettingDef`'s `min`/`max`/`step` for section-level edits. For global spacing changes specifically, Layer 8 (responsive) runs its structurally-computable check — a container/spacing value that would compute to a negative or zero content width once combined with the theme's existing responsive CSS custom properties at a defined breakpoint is a hard block (doc 15 §10's exact worked example uses this precise scenario).

### 06.3.9 Edit Colors

This is the operation most sensitive to Shopify's Online Store 2.0 color scheme system, and the editor's behavior differs by exactly what `SettingDef.type` the section declares — never a single "pick a color" UI regardless of type.

**Case A — section declares a `color_scheme`-typed setting (`capabilities.supportsColorSchemes: true` themes, the common OS 2.0 case).** The Inspector renders a **scheme picker** — a dropdown/swatch-grid of the theme's existing named color schemes (`scheme-1`, `scheme-2`, …, as defined in `config/settings_data.json`'s color-scheme group), not a hex input. Picking a different scheme is `setSectionSetting(themeVersionId, instanceId, settingId, "scheme-2")` — a single-value swap; it changes *which* scheme this instance uses, not any scheme's actual colors. This is the preferred, default path whenever the type is available: **the editor always offers the existing-scheme picker over a raw hex injection when the section models colors this way** — introducing a one-off hex value on a `color_scheme`-typed field would fight the theme's own design-token system and produce a section that no longer participates in a merchant's later scheme-wide color changes.

**Case B — editing what a scheme itself resolves to.** A separate, explicitly global action ("Edit scheme colors," reached from Global Settings > Colors, §06.4, not from a section's Inspector) changes the *colors a scheme name maps to* — `setGlobalStyle(themeVersionId, "colors.{schemeName}.{role}", value)` (doc 09 §2.4: `GlobalStyles.colors` is "keyed by role... or, for themes using `color_scheme_group`, by scheme name"). This has a large blast radius — it changes every section anywhere in the theme currently assigned to that scheme — so it is never reachable from a single section's Inspector panel; it always routes through Global Settings, where the "affects N sections across M templates" impact is shown before commit.

**Case C — section declares a plain `color`-typed setting (no scheme, or a scheme-independent override field like a one-off overlay tint some sections expose alongside their scheme setting).** Here a real hex/swatch picker is legitimate — `setSectionSetting(themeVersionId, instanceId, settingId, hexValue)` — because the schema itself modeled the field as a raw color, not a scheme reference. The editor decides which of Case A/C to render purely from the `SettingDef.type` the Manifest reports for that specific setting; it never "upgrades" a plain `color` field into a scheme picker (the theme doesn't model one there) and never "downgrades" a `color_scheme` field into a hex input (that would bypass the theme's own token system for no reason).

**Diff entries produced:** Case A/C — one `modified` at `sections.{instanceId}.settings.{settingId}`. Case B — one or more `modified` entries at `globalStyles.colors.{schemeName}.{role}` per changed role within the scheme.

**Validation triggered:** Layer 2 confirms a Case A value is one of the theme's actual declared scheme names (not an arbitrary string) and a Case C value is a well-formed color value. Layer 8 flags (warning, not hard block) a resulting contrast concern where automatable — e.g. a scheme-color change that drives text/background contrast below a basic computable threshold — but genuine visual-quality judgment on color choices is explicitly left to the user per doc 15 §10's automatable-vs-human-review split.

### 06.3.10 Edit Typography

**Default lever — global.** Typography is a theme-wide design token by default: `GlobalStyles.typography` (`headingFont`, `bodyFont`, `scaleRatio`, `baseSize`, doc 09 §2.4). Editing these is `setGlobalStyle(themeVersionId, "typography.{field}", value)`, reached from Global Settings > Typography (§06.4) — this is the only lever for the majority of sections, since most section schemas don't declare their own font/size settings.

**Section-level override — only where the schema declares one.** Some sections (typically hero/banner-style sections) expose their own `font_picker` or `range`-typed heading-size setting. Where present, editing it is an ordinary `setSectionSetting(themeVersionId, instanceId, settingId, value)` call, exactly like any other field — the Inspector shows this control directly on the section, in addition to (not instead of) the global lever, and the two are independent: a section-level override wins for that instance; the global token still governs every section without its own override.

**Diff entries produced:** one `modified` at `globalStyles.typography.{field}` (global) or `sections.{instanceId}.settings.{settingId}` (section override).

**Validation triggered:** Layer 2 for both — `font_picker` values checked against the theme's available font list, `range`-typed size values checked against declared `min`/`max`/`step`. A global typography change additionally runs Layer 7 (runtime/rendering) against a representative sample of template types (home, product, collection, cart — doc 15 §9's exact list for global-scope operations), since a font/scale change can affect render layout broadly enough to be worth checking beyond just the section that was selected when the edit was made.

### 06.3.11 Edit Layout (columns, alignment)

**User interaction:** layout-shaped controls (column count, alignment, grid density) in the Inspector, rendered **strictly from `select`/`range`-typed `SettingDef`s the section's own schema declares** — e.g. a `select` setting with options `["2", "3", "4"]` for column count, or a `select` with `["left", "center", "right"]` for alignment.

**This is the sharpest statement of a rule that recurs throughout this document (§06.3.6c, §06.3.8): the editor is a faithful surface over exactly what `ThemeManifest.sections[].settings` declares for the selected section — never a superset.** If a section's schema caps columns at 3, the Inspector's column control has three options, full stop; it does not add a "4" option because a 4-column layout is conceptually plausible for that kind of section. This is Principle 1 (preserve the existing theme) and Principle 2 (reuse existing capabilities) applied directly to editor UI: the Visual Editor's entire contract is that every control it shows corresponds to a real, already-declared lever in the actual theme file, so what the user sees in the editor and what actually exists in the section's Liquid/schema can never drift apart.

**Mutation call:** `setSectionSetting(themeVersionId, instanceId, settingId, value)` — no different from any other field edit; layout settings aren't a distinct mutation category, only a distinct *UI grouping* in the Inspector.

**When a section genuinely doesn't support the layout change a user wants** (e.g. "make this a 4-column grid" on a section schema-capped at 3): this is out of scope for the Visual Editor entirely, by design — it is not a degraded or disabled control, it's simply absent, with a link into the AI panel scoped to that instance (doc 19 §19.4.3's "ask AI about this" shortcut) as the path forward. From there, the Operation Planner (doc 11 §5) applies its normal reuse-before-generation search; if genuinely nothing in the theme can satisfy it, the request may resolve to a generative `modify_liquid` operation (`riskLevel: "review"`) — but that determination and its cost/risk tradeoff belongs to the AI planning flow (doc 11), never to a manual editor control silently exceeding what the schema authorizes.

**Diff entries produced:** one `modified` at `sections.{instanceId}.settings.{settingId}`, identical shape to any field edit.

**Validation triggered:** Layer 2 enum-conformance — a value outside the setting's declared `options` is a hard block (doc 15 §4's category explicitly names this: "Enum/option-constrained settings receive a value from the allowed option set"). Since the Inspector only ever offers declared options to begin with, this validation failure should be unreachable from the UI in practice — same "client can't construct an illegal request, server enforces it anyway" posture as every other operation in this document.

### 06.3.12 Toggle Visibility (per device)

**User interaction:** three small toggles (desktop / tablet / mobile, matching the toolbar's device-switcher iconography, doc 19 §19.4.2) on a Structure panel row or in the Inspector's section-level controls — present identically for every section instance regardless of section type, since visibility is modeled independently of any section's own schema (doc 09 §2.3: "modeled explicitly rather than left in `settings` so the editor can render one universal visibility control regardless of section type").

**Mutation call:** `setVisibility(themeVersionId, instanceId, breakpoint, value)` — one call per breakpoint toggled. Toggling all three off is a distinct action from `setDisabled` (§06.4 covers the related "disable entirely" toggle) — a section hidden on every device via `visibility` is conceptually "hidden everywhere for now, reversible per-device," while `disabled: true` is "fully off, one flag."

**Diff entries produced:** one `modified` per toggle, path `sections.{instanceId}.visibility.{breakpoint}` — each breakpoint's toggle is its own call and its own Diff entry (not batched into one three-value write), so undo can target exactly the breakpoint that was changed, not all three.

**Validation triggered:** Layer 8 (responsive) warns — never hard-blocks — if disabling a section on `mobile` would leave no equivalent for genuinely critical content (e.g. the only nav/cart-access section on the page) with nothing shown in its place on that device; this is explicitly a warning per doc 15 §10 ("hide on mobile can be intentional"), never a block, since deliberately hiding a section on a given device is a completely normal, common editing action.

### 06.3.13 Responsive Controls generally

Beyond the visibility toggles (§06.3.12), "responsive" editing in Shopforge is not a separate control category layered on top of the mutation API — it is the device switcher (doc 19 §19.4.2) changing **which settings the Inspector foregrounds**, against the same `setSectionSetting`/`setGlobalStyle` calls as any other edit:

- Some section schemas declare genuinely separate `settingId`s per breakpoint (e.g. `columns_desktop` and `columns_mobile` as two distinct `SettingDef`s) — both exist in the `ThemeModel` at all times regardless of which device the switcher shows; switching the device switcher to "mobile" simply brings `columns_mobile`'s control forward in the Inspector (and, symmetrically, greys or collapses `columns_desktop`'s), so the user is editing the field relevant to what they're currently looking at without the two ever being confused as one setting.
- Where a section has no such per-breakpoint setting split, there is no separate mobile-specific value to edit — the single setting applies at every breakpoint, and the Inspector doesn't fabricate a device-scoped variant that doesn't exist in the schema (same rule as §06.3.11).
- The device switcher itself never triggers a mutation on its own — switching from desktop to mobile view is a **local, ephemeral UI state change** (doc 19 §19.5: device-switcher state is cross-cutting client state, not part of `ThemeModel`), it only changes canvas viewport width and which breakpoint's `visibility`/setting-split values are foregrounded. Nothing is written to the server until the user actually edits a field.

**Diff entries produced / Validation triggered:** identical to whatever underlying field is being edited (§06.3.5–§06.3.11) — responsive editing has no separate Diff shape or validation layer of its own beyond Layer 8's breakpoint-consistency and overflow/clipping checks (doc 15 §10), which run on every operation touching layout/spacing/visibility regardless of which device the editor happened to be showing when the edit was made.

---

## 06.4 Global Settings

Global Settings is what the Inspector shows when nothing is selected (doc 19 §19.4.5) — controls bound to `GlobalStyles` and, for anything `GlobalStyles` doesn't structurally model yet, directly to `ThemeModel.themeSettings` (the theme's raw `settings_schema.json`-declared entries). Every area below resolves to exactly one of two mutation paths, and the panel is honest about which:

| Area | Primary mutation path | Notes |
|---|---|---|
| **Colors** | `setGlobalStyle(path: "colors.{role}")` or `"colors.{schemeName}.{role}"` for scheme-modeled themes | See §06.3.9 Case B for the scheme-editing flow specifically. Non-scheme themes use plain role keys (`"colors.accent"`, doc 09 §2.4's own example). |
| **Typography** | `setGlobalStyle(path: "typography.{field}")` | `headingFont`/`bodyFont`/`scaleRatio`/`baseSize` — the full structured set (doc 09 §2.4). |
| **Buttons** | `setGlobalStyle(path: "buttons.{field}")` | `radius`/`borderWidth`/`shadow`/`style` — structured (doc 09 §2.4). This is the site-wide button style §06.3.7 falls back to when a section has no per-instance override. |
| **Spacing / container widths** | `setGlobalStyle(path: "spacing.{field}")` | `sectionSpacing`/`containerWidth` — structured (doc 09 §2.4). This is the fallback §06.3.8 falls back to when a section has no per-instance padding setting. |
| **Forms (inputs)** | `setThemeSetting(themeVersionId, settingId, value)` against the theme's own `settings_schema.json` entries | Not a structured `GlobalStyles` field — most themes model input styling (border radius, focus color) as a handful of raw settings under an "Inputs" schema group. Written into `themeSettings.{settingId}` / `GlobalStyles.raw` passthrough (doc 09 §2.4). |
| **Cards** | `setThemeSetting` (raw) | Card style/corner-radius/image-ratio settings are theme-specific raw entries, not a first-class `GlobalStyles` sub-object today — same passthrough path as Forms. |
| **Borders** | `setGlobalStyle("buttons.borderWidth")` where the border in question is a button border (structured); `setThemeSetting` (raw) for card/input/section-level border settings the theme declares independently | Whether a given "border" control is structured or raw depends entirely on whether it's the specific button-border token `GlobalStyles.buttons` models, or one of the theme's own additional border settings — the panel doesn't merge these into one generic "borders" concept, since the underlying settings genuinely aren't unified in the Model. |
| **Shadows** | `setGlobalStyle("buttons.shadow")` (structured, buttons only) or `setThemeSetting` (raw, for card/section shadow settings) | Same split as Borders, for the same reason. |
| **Breakpoints** | Not exposed as a field edit at all | Most Shopify themes hardcode breakpoints in CSS/Liquid rather than declaring them in `settings_schema.json` — there is typically no `SettingDef` to bind a control to. Global Settings does not fabricate a breakpoint editor; a genuine breakpoint change is a `modify_css` generative operation (`riskLevel: "review"`), reachable only via the AI panel, never a manual Global Settings control. |

**The general rule this table encodes:** a Global Settings control is backed by `setGlobalStyle` only for the four sub-objects doc 09 §2.4 actually structures (`colors`, `typography`, `buttons`, `spacing`); everything else the theme's `settings_schema.json` declares — however visually similar it looks in the panel — is bound through `setThemeSetting` against `ThemeModel.themeSettings`/`GlobalStyles.raw`, and the panel groups these raw entries **by the schema's own declared category headers** (Shopify's `settings_schema.json` is itself organized into named groups like "Colors," "Typography," "Cards") so Global Settings never needs bespoke per-theme knowledge to render a sensible grouped panel — it renders one control per `SettingDef`, grouped by whatever category the theme's own schema already puts it in, regardless of whether that category also happens to have a structured `GlobalStyles` projection.

**Diff entries produced:** one `modified` at `globalStyles.{path}` (structured) or `themeSettings.{settingId}` (raw) per edited field — doc 09 §4's `setGlobalStyle`/`setThemeSetting` table rows.

**Validation triggered:** Layer 2 for type/option/range conformance against the raw `SettingDef`, same as any section-level field. Because a global edit's blast radius spans every template, Layer 7 (runtime/rendering) always samples a representative set of template types (home, product, collection, cart, per doc 15 §9) rather than only the template the user happened to be viewing, and Layer 8's structural checks (e.g. negative computed width) apply with the same severity as a section-level spacing edit (§06.3.8).

---

## 06.5 Editor States

The editor exposes explicit, user-visible states beyond the layout-level table already given in doc 19 §19.4.8 — this section goes one layer deeper on triggers, what the user sees, and — the part doc 19 leaves open — exactly how each state behaves when an AI operation is executing concurrently.

### 06.5.1 State-by-state detail

| State | Trigger | What the user sees |
|---|---|---|
| **Loading** | Initial `GET /editor/versions/:id/model` (doc 18), or switching `ThemeVersion` | Skeleton canvas/panels; toolbar actions disabled; the `lockVersion` returned with this fetch (doc 18 §"Concurrency model") becomes the client's baseline for every mutation until the next fetch. |
| **Saving — autosave** | A local mutation has been applied optimistically and no explicit "Save" action has been taken. Mutations are batched: the client waits for a rolling ~2s idle window after the last mutation (capped at a ~10s max wait so a continuously-dragged slider still persists periodically rather than only on release) before issuing the persistence call. | Small unobtrusive "Saving…" near the version label; canvas/panels stay fully interactive. |
| **Saving — explicit** | User clicks "Save," or the editor forces a flush before Publish or before navigating away with pending changes. | Toolbar save control shows a spinner; Publish stays blocked until this resolves. |
| **Saved** | Persistence call confirms, returning the new `lockVersion` (doc 18). | "Saved" indicator with a timestamp, reverting to neutral after a few seconds. |
| **Unsaved changes** | A local mutation exists whose persistence call hasn't yet confirmed (mid-debounce, or a save attempt failed and hasn't retried). | Dot/asterisk on the version label; leaving the editor prompts a confirmation. |
| **Error** | A mutation is rejected (validation hard block, doc 15), a save fails (network, or a `409` stale-`lockVersion` conflict, doc 18), or the initial model fetch fails. | Inline error scoped to the affected panel — canvas overlay for a render/apply error, toolbar banner for a save/network/conflict error — with a retry action. A `409` conflict specifically re-fetches the current model/`lockVersion` and re-applies the user's still-pending local mutation against it rather than discarding the user's edit outright. |
| **Undo / Redo** | User action or keyboard shortcut, available whenever the local undo/redo stack (doc 14) is non-empty in that direction. | Toolbar buttons enable/disable to match stack state; hovering previews the target `Diff`'s `humanSummary`. Undo/redo operate over the single unified Diff stream regardless of `causedBy` (doc 09 §6) — the next undo targets whichever Diff is most recent in that stream, editor-originated or AI-originated. |
| **Preview** | User toggles "Preview." | Structure/Inspector/AI panels collapse; canvas expands full-width, hover/selection affordances disabled, rendering exactly what a storefront visitor would see for the current device. |
| **Device switch (desktop/tablet/mobile)** | User selects a device in the toolbar. | Canvas viewport resizes; the active `visibility` breakpoint and any per-breakpoint setting split (§06.3.13) become what the Inspector foregrounds. Purely local UI state — no mutation, no Diff. |

### 06.5.2 Concurrency with an in-flight AI operation

**Decision: a user can keep manually editing while an AI plan is executing, with one exception — the specific section instances (or other model paths) that plan's currently-applying step targets are soft-locked for the duration of that step, not the whole editor.**

**Mechanism.** Every `Operation` already declares its own scope via `target` (architecture-core §3), and doc 15 §11 already defines a `scopeFor(operation.type, operation.target)` function — the target path plus its documented allow-listed secondary effects — as the authoritative notion of "what this operation is allowed to touch," used there for regression validation. The concurrency lock reuses this exact scope, rather than inventing a second scoping concept:

- The instant an `Operation`'s execution status moves from *queued* to *applying* (doc 19 §19.4.7 step 4), the server marks every path in `scopeFor(operation.type, operation.target)` as locked, keyed by `themeVersionId` + path, with a short TTL matching expected operation execution time. This lock is broadcast to every connected client for that `themeVersionId` over the same live-sync channel that already propagates model updates (doc 09 §6).
- The instant that operation's status moves to *applied* (its `Diff` has committed) or *failed*, its lock releases immediately — a multi-step plan therefore unlocks section-by-section as steps land, not all at once at the end of the whole plan. A four-step plan touching four different sections locks and unlocks each one in turn; a plan whose steps repeatedly touch the same instance simply keeps that one instance locked across those consecutive steps.
- For a section-scoped operation (`update_setting`, `move_section`, `add_block`, etc.), the lock covers exactly that `instanceId` — every other section on the page, and every other panel, stays fully editable.
- For a global-scope operation (`update_global_style`, `update_theme_setting`, or a `modify_css`/`modify_liquid` touching a shared file like `theme.liquid` or a widely-`render`ed snippet), the lock widens to whatever the operation's own declared target actually is — a `GlobalStyles` path locks that category's Global Settings controls (§06.4), an `assetFile` target locks that asset's entry — but never wider than the target actually names. If a generative operation's true blast radius later turns out to be broader than its declared target (e.g. a `modify_css` change that incidentally affects an unrelated class), that is caught by Layer 9 regression validation as a hard block on that operation (doc 15 §11) — the live lock does not need to pre-anticipate an out-of-scope side effect; the validation pipeline is what guarantees the operation never lands if it has one.

**What the user sees on a locked instance:** the Structure panel row shows a small spinner/"AI editing…" badge; the canvas dims or outlines the section with the same indicator; the Inspector, if that instance is selected, shows its fields disabled with an inline note ("AI is currently updating this section — hold on") rather than silently accepting input that would be rejected. The block happens client-side, before a mutation call is even issued, for immediate feedback; the server enforces the same lock as the authoritative backstop (mutation functions reject a call against a currently-locked path) in case a client's view of the lock state is stale.

**Why instance-level locking rather than locking the whole editor:** a whole-editor lock would mean every AI-assisted turn — including the common case of a single narrowly-scoped, selection-driven request (doc 19 §19.4.6) — freezes the entire page for however long that operation takes to execute and validate. That directly undermines the product's central claim (Principle 7) that the visual editor and the AI aren't two separate modes fighting for control of the same document, but one continuous surface. Scoping the lock to exactly what doc 15 §11 already treats as "this operation's legitimate footprint" costs nothing new to compute, keeps the common case (one section touched) fully non-disruptive to the rest of the page, and only ever restricts the user from doing the one thing that would actually be unsafe: hand-editing the exact same field the AI is mid-write on.

**Relationship to `ThemeVersion.lockVersion` (doc 18).** This section's soft lock is a UX-layer guard that prevents the common in-session conflict before it happens; it is not a replacement for the compare-and-swap `lockVersion` mechanism doc 18 already defines as the system's actual data-integrity backstop. The two operate at different layers and both remain in force: the soft lock stops *this session's* editor from racing *this session's* AI panel over the same section (the everyday case, since doc 19 §19.4 puts both in one screen); `lockVersion`'s per-operation compare-and-swap (doc 18 — re-validated before each step of a plan, not just once) is what still protects correctness if the soft lock is bypassed entirely — a second browser tab or a second collaborator with no visibility into the first session's in-flight plan. In that cross-session case, doc 18's existing behavior applies unchanged: already-applied steps are kept (each is independently valid and reversible), remaining steps abort as `conflicted`, and the user is prompted to re-plan against the now-current model.

**Undo while a plan is mid-execution.** Undo always targets the most recent committed `Diff` in the unified stream (§06.5.1's Undo/Redo row), regardless of origin. A step that is still *applying* hasn't produced a `Diff` yet, so it isn't a candidate for undo until it lands — hitting undo mid-plan undoes the most recent already-*applied* step (AI or manual), and does not disturb whatever the executor is still working on. If a later, not-yet-executed step in the same plan targets the same path the user just undid, no special-casing is needed: the executor always reads current live `ThemeModel` state per step (never a snapshot taken at plan-start), so that later step simply computes against the just-undone value, exactly as if a manual edit had landed there between two AI steps for any other reason.

**Plan review vs. execution.** Nothing is locked during the "Analyzing/streaming plan" or "Plan review" states (doc 19 §19.4.7 steps 2–3) — those are read-only previews of what *would* happen. Locking begins only once the user confirms and a step actually starts applying; a plan the user never confirms never locks anything.

---

## 06.6 Cross-references

- Doc 09 §4 defines every mutation function this document calls by name; this document is that API's user-facing surface.
- Doc 14 defines the `Diff`/`DiffEntry` shape every "Diff entries produced" subsection above instantiates, and the undo/redo/revert mechanics §06.5.1 and §06.5.2 build on.
- Doc 15 defines the nine validation layers referenced throughout §06.3–§06.4, and specifically the `scopeFor` target-scope concept §06.5.2 reuses for its concurrency lock.
- Doc 18 defines the `/editor/*` endpoint contracts and the `lockVersion` compare-and-swap concurrency model §06.5.2 sits on top of.
- Doc 19 defines the panel layout (Structure, Canvas, Inspector, AI panel), selection-driven AI scoping, and the plan/progress lifecycle (§19.4.7) this document's operations and states are triggered from and rendered into.
- Doc 11 defines how an AI-suggested `add_section`/generative operation is planned in the first place, referenced in §06.3.1 and §06.3.11.
- Doc 20 covers sanitization of AI-produced content before it reaches an editable field, referenced in §06.3.5 and §06.3.6.
