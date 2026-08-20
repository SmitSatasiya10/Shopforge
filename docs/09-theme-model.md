# 09 — Theme Model

## 1. What the Theme Model Is

`ThemeModel` is the live, mutable, semantic representation of one `ThemeVersion`'s working copy — the single in-memory-and-DB-persisted structure that the Visual Editor and the AI both read from and write to. Where `ThemeManifest` (doc 08) answers "what does this theme support," `ThemeModel` answers "what does this specific working copy currently look like, right now, including every unsaved edit."

Every section on every page, every setting value, every block, every global style token exists in exactly one place: the `ThemeModel`. This document specifies its shape, the mutation functions that are the *only* sanctioned way to change it, how it's built, how it's serialized back to real theme files, and how this design satisfies Principle 7.

---

## 2. Full Field Reference

### 2.1 Top-level `ThemeModel`

| Field | Type | Description |
|---|---|---|
| `themeVersionId` | `string` | The `ThemeVersion` (doc 17) this Model is the working copy of. One `ThemeModel` per `ThemeVersion`. |
| `templates` | `{ [templateKey]: TemplateNode }` | Every template in the theme, keyed by a stable template key. |
| `sections` | `{ [instanceId]: SectionInstance }` | Every section *instance* across the whole theme (all templates + section groups), keyed by a stable UUID independent of position. |
| `globalStyles` | `GlobalStyles` | Structured theme-wide design tokens. |
| `themeSettings` | `object` | Current `settings_data.json`-equivalent values, keyed by schema id — the full resolved set, including keys `globalStyles` doesn't structurally model yet. |
| `assets` | `{ [file]: AssetRef }` | Asset references, including AI-generated replacements. |

### 2.2 `TemplateNode`

| Field | Type | Description |
|---|---|---|
| `key` | `string` | Template identity, e.g. `"product"`, `"index"`, `"collection.summer-sale"` (dotted suffix for named alternate templates, mirroring Shopify's own `product.suffix.json` convention). |
| `file` | `string` | Source file path this node serializes back to, e.g. `"templates/product.json"`. |
| `sectionInstances` | `instanceId[]` | Ordered list of section instances rendered in the template body (excludes header/footer groups). |
| `sectionGroups` | `{ header: instanceId[], footer: instanceId[] }` | Section-group-slotted instances, ordered. |

**Why `instanceId` and not `sectionId` in the order arrays:** a `sectionId` (e.g. `"hero-banner"`) names a section *type*; the same type can appear multiple times in one template (two "featured-collection" sections stacked), or the same instance conceptually never appears in two templates at once. `instanceId` is what makes reordering, duplicating, and moving sections between templates unambiguous and stable — drag-reordering in the editor mutates an array of `instanceId`s, never re-keys anything.

### 2.3 `SectionInstance`

| Field | Type | Description |
|---|---|---|
| `instanceId` | `string` | Stable UUID, assigned once at creation (Model build or `add_section`), persists across every subsequent edit/move/reorder for the life of the instance. |
| `sectionType` | `string` | References `ThemeManifest.sections[].sectionId` — identifies which section schema/Liquid file this instance renders through. |
| `settings` | `object` | Current values, keyed by `SettingDef.id` from the section's schema. |
| `blocks` | `{ blockInstanceId: string, blockType: string, settings: object }[]` | Ordered block instances. `blockInstanceId` is likewise a stable UUID independent of block position. |
| `visibility` | `{ desktop: boolean, tablet: boolean, mobile: boolean }` | Per-breakpoint show/hide (Shopify's `[data-breakpoint-visibility]`-style responsive controls, modeled explicitly rather than left in `settings` so the editor can render one universal visibility control regardless of section type). |
| `disabled` | `boolean` | Whether the instance is fully disabled (excluded from render but retained in the Model/file — Shopify keeps disabled sections in template JSON, just excluded from `sectionOrder` rendering; the Model mirrors this by keeping the instance present with `disabled: true` rather than removing it, which is what makes re-enabling a simple flag flip instead of a reconstruction). |

### 2.4 `GlobalStyles`

| Field | Type | Description |
|---|---|---|
| `colors` | `{ [role: string]: string }` | Resolved color values keyed by role (`"background"`, `"text"`, `"accent"`) or, for themes using `color_scheme_group`, by scheme name. |
| `typography` | `{ headingFont, bodyFont, scaleRatio, baseSize }` | Structured font/scale tokens. |
| `buttons` | `{ radius, borderWidth, shadow, style: "solid" \| "outline" \| "soft" }` | Structured button style tokens. |
| `spacing` | `{ sectionSpacing, containerWidth }` | Structured layout spacing tokens. |
| `raw` | `object` | Passthrough of every `themeSettings` key not yet mapped into a structured field above — guarantees no `settings_data.json` key is ever silently dropped, even for design-token shapes the Model hasn't been taught to structure yet. |

### 2.5 `AssetRef`

| Field | Type | Description |
|---|---|---|
| `file` | `string` | Path within `assets/`. |
| `url` | `string` | Resolvable URL (CDN-hosted Shopify asset URL, or Shopforge-hosted staging URL pre-publish). |
| `uploadedBy` | `"user" \| "ai" \| "theme-default"` | Provenance — drives UI treatment (AI-generated assets get an attribution/regenerate affordance) and cost accounting (doc 22). |
| `sourceGeneratedAssetId` | `string?` | Present when `uploadedBy === "ai"`; links back to the `GeneratedAsset` DB entity (doc 17) that produced it. |

---

## 3. Building the Model from Manifest + Raw File Contents

The Theme Model Builder runs once per `ThemeVersion` creation (theme import, or branching a new working version off an existing one) and produces the initial `ThemeModel`. It is a distinct step from the Theme Parser (doc 07): the Parser never touches per-instance state, and the Builder never re-derives schema/structure — it strictly consumes `ThemeManifest` for "what's possible" and raw file contents for "what's currently set" (doc 08 §5.2).

Build sequence:

1. **Load** the current `ThemeManifest` for the theme (doc 08 §4 lookup) and the raw contents of every `templates/*.json`, `sections/*.json` (groups), and `config/settings_data.json` file.
2. **For each `ThemeManifest.templates[]` entry:** create a `TemplateNode` keyed by the template's resource-derived key. For each entry in the raw template JSON's `sections` object, create a `SectionInstance`:
   - Generate a new `instanceId` (UUID) — the raw Shopify template JSON keys section entries by an arbitrary string id of Shopify's own choosing, which the Builder does *not* reuse as `instanceId` (Shopify's own ids are not guaranteed stable across the merchant re-saving in Shopify's native editor); a fresh stable UUID is minted at build time and a `{ shopifyBlockKey -> instanceId }` mapping is retained internally by the Serializer (§4) for round-tripping.
   - Validate `sectionType` against `ThemeManifest.sections[].sectionId`; abort the build for that instance (log + flag, do not silently drop) if no match — this indicates raw-file/Manifest drift, which should only occur if a re-parse is needed first.
   - Populate `settings` from the raw JSON's `settings` object, filling any key absent there with `SettingDef.default` from the Manifest (doc 08 §5.2).
   - Populate `blocks[]` similarly from the raw JSON's `blocks` object, generating a `blockInstanceId` per block.
   - `sectionInstances` order is taken directly from the raw JSON's `order` array (which is the true current order — `ThemeManifest.sectionOrder` reflects the state at last parse and could theoretically differ if this build is happening mid-drift-detection, so raw file order always wins for the Model).
3. **For each `layouts[].sections` group ref:** same instance-construction logic, populating `TemplateNode.sectionGroups.header`/`.footer` — but section groups are shared across all templates that reference that layout, so their instances are built once and referenced by `instanceId` from every relevant `TemplateNode`.
4. **`themeSettings`** is populated directly from raw `config/settings_data.json`'s resolved `current` object (same resolution the Parser did — Builder re-reads raw rather than trusting the Manifest's cached `currentValues`, since `settings_data.json` can change independently of a re-parse being triggered, e.g. mid-build during a fresh import).
5. **`globalStyles`** is derived from `themeSettings` by mapping recognized `SettingDef.type`/`id` patterns (font pickers -> `typography`, `color`/`color_scheme` settings whose id matches known role-naming conventions -> `colors`, etc.) into the structured sub-objects, with every other key passed into `globalStyles.raw` verbatim (doc 08 §5.2).
6. **`assets`** is populated from `ThemeManifest.assets[]`, with `uploadedBy: "theme-default"` for every entry (no AI-generated assets exist yet in a freshly built Model).

The resulting `ThemeModel` is persisted (JSON, doc 17) keyed by `themeVersionId`, and from this point forward **all further changes to it happen exclusively through the mutation API in §4** — the Builder is never invoked again for an existing `ThemeVersion`; a fresh build only happens for a new version.

---

## 4. Mutation API Surface

This is the complete, exhaustive set of functions permitted to change a `ThemeModel`. Both the Visual Editor (doc 06, via `/editor/*` doc 18) and the AI Operation Executor (doc 11, executing an `Operation` from architecture-core §3) call these same functions — there is no second mutation path for either caller. Every mutation function:

- Takes `themeVersionId` plus the operation-specific arguments.
- Validates the target exists and the new value/shape is legal against the relevant `SettingDef`/schema from the Manifest.
- Applies the change to the in-memory/persisted `ThemeModel`.
- Emits one or more `DiffEntry` records (architecture-core §4) capturing `before`/`after`, appended to a `Diff` tagged with `causedBy: { type: "ai_operation" | "editor_edit", ... }`.
- Returns the updated `SectionInstance`/`TemplateNode`/`GlobalStyles` slice (not the whole Model) so callers can apply an optimistic local update without re-fetching everything.

| Function | Signature | Diff entries produced |
|---|---|---|
| `setSectionSetting` | `(themeVersionId, instanceId, settingId, value) -> SectionInstance` | one `modified`, path `sections.{instanceId}.settings.{settingId}` |
| `setBlockSetting` | `(themeVersionId, instanceId, blockInstanceId, settingId, value) -> SectionInstance` | one `modified`, path `sections.{instanceId}.blocks.{blockInstanceId}.settings.{settingId}` |
| `addSectionInstance` | `(themeVersionId, templateKey, sectionType, position, presetName?) -> SectionInstance` | one `added`, path `sections.{newInstanceId}`; settings/blocks seeded from `PresetDef` if `presetName` given, else schema defaults |
| `removeSectionInstance` | `(themeVersionId, instanceId) -> void` | one `removed`, path `sections.{instanceId}` (full prior instance stored as `before` for reversibility) |
| `moveSectionInstance` | `(themeVersionId, instanceId, toTemplateKey?, toIndex) -> TemplateNode` | one `moved`, path `templates.{templateKey}.sectionInstances`, `before`/`after` = index (and template key, if cross-template) |
| `duplicateSectionInstance` | `(themeVersionId, instanceId) -> SectionInstance` | one `added`, path `sections.{newInstanceId}`, `after` = deep copy of source instance with fresh `instanceId`/`blockInstanceId`s |
| `addBlock` | `(themeVersionId, instanceId, blockType, position) -> SectionInstance` | one `added`, path `sections.{instanceId}.blocks.{newBlockInstanceId}` |
| `removeBlock` | `(themeVersionId, instanceId, blockInstanceId) -> SectionInstance` | one `removed`, path `sections.{instanceId}.blocks.{blockInstanceId}` |
| `reorderBlock` | `(themeVersionId, instanceId, blockInstanceId, toIndex) -> SectionInstance` | one `moved`, path `sections.{instanceId}.blocks` |
| `setVisibility` | `(themeVersionId, instanceId, breakpoint: "desktop"\|"tablet"\|"mobile", value: boolean) -> SectionInstance` | one `modified`, path `sections.{instanceId}.visibility.{breakpoint}` |
| `setDisabled` | `(themeVersionId, instanceId, disabled: boolean) -> SectionInstance` | one `modified`, path `sections.{instanceId}.disabled` |
| `setGlobalStyle` | `(themeVersionId, path, value) -> GlobalStyles` | one `modified`, path `globalStyles.{path}` (e.g. `"colors.accent"`) — mirrors `update_global_style`'s `path` payload shape verbatim |
| `setThemeSetting` | `(themeVersionId, settingId, value) -> object` | one `modified`, path `themeSettings.{settingId}` |
| `setAsset` | `(themeVersionId, file, newContentRef, uploadedBy, sourceGeneratedAssetId?) -> AssetRef` | one `modified` (or `added` if `file` is new), path `assets.{file}` |

Two additional functions exist outside the per-field list above because they don't correspond 1:1 to a single `OperationType` but are required for AI generative operations (architecture-core §3) to have somewhere to land their output in the Model:

| Function | Signature | Notes |
|---|---|---|
| `registerNewSectionType` | `(themeVersionId, sectionType, liquidSource, schema) -> void` | Backing function for `create_section_file`. Writes the new section's schema into a Model-local "pending new section types" set (not yet in `ThemeManifest` — that only updates on next Parser re-sync post-publish) so `addSectionInstance` can immediately reference the new `sectionType` within the same session, and stages `liquidSource` for the Serializer (§5) to write out. |
| `applyRawFileEdit` | `(themeVersionId, file, unifiedDiff) -> void` | Backing function for `modify_liquid`/`modify_css`/`modify_js`. Applies a unified diff to a raw file staged for the Serializer; does not touch `ThemeModel`'s structured fields directly, since a raw Liquid/CSS/JS edit isn't necessarily setting-shaped — the affected `SectionInstance.settings`, if any, are re-derived from the new raw source right after via `setSectionSetting` calls as needed, keeping raw-edit consequences visible in the structured Model too rather than only in the file. |

**Contract every mutation function shares:** none of them ever write directly to a Liquid/JSON file. They only ever touch the in-memory/DB-persisted `ThemeModel` and emit a `Diff`. File writes happen exclusively in the Theme Serializer (§5), on an explicit save/publish action — this separation is what makes every edit (editor or AI) cheap, instant-feeling, and safely batchable before anything touches the merchant's actual theme files.

---

## 5. The Theme Serializer

The Serializer is the inverse of the Model Builder: it takes the current `ThemeModel` (plus the staged raw-file edits from `registerNewSectionType`/`applyRawFileEdit`) and writes real Liquid/JSON files back out, ready to push to Shopify via the Admin API.

It runs on explicit save (`/editor/save`, doc 18) or as part of AI plan execution finalization (doc 11) — never automatically on every mutation call, so many mutations can be batched into one file-write pass.

Serializer steps:

1. **For each `TemplateNode`:** reconstruct the template JSON. For every `instanceId` in `sectionInstances` (and `sectionGroups.header`/`.footer`, written to their respective group JSON files instead), look up the `SectionInstance`, and:
   - Resolve `instanceId` back to a Shopify-legal section key using the `{ instanceId -> shopifyBlockKey }` map retained since Build time (§3 step 2) for pre-existing instances, or mint a new Shopify-legal key (handle-safe string) for instances created via `addSectionInstance`/`duplicateSectionInstance` since the last serialize.
   - Write `settings` and `blocks` (each block similarly resolved to a stable block key) into that section's JSON entry.
   - Write the `order` array from `sectionInstances`, **omitting** instances where `disabled: true` from `order` while still including their full entry in `sections` (matching Shopify's own disabled-section convention, so re-enabling round-trips cleanly — this is exactly why `SectionInstance.disabled` is modeled as a flag rather than instance removal, §2.3).
   - `visibility` per-breakpoint flags are written into that section's settings block using Shopify's standard responsive-visibility setting keys.
2. **For `globalStyles` and `themeSettings`:** merge changed values back into `config/settings_data.json`'s `current` object. This is a targeted merge, not a full overwrite — only keys the Model actually changed (tracked via the accumulated Diff entries since last serialize) are written, so any settings_data.json content Shopforge doesn't model (arbitrary future keys landing in `globalStyles.raw`/passthrough `themeSettings` entries) is preserved untouched rather than clobbered by a stale in-memory copy.
3. **For staged `registerNewSectionType` entries:** write a new `sections/{sectionType}.liquid` file containing the provided Liquid source with the schema JSON embedded in a `{% schema %} %}` block matching the provided `schema` object exactly (byte-for-byte JSON serialization of what was validated, so what the AI proposed is what ships).
4. **For staged `applyRawFileEdit` entries:** apply the unified diff to the named file's last-known content and write the patched result.
5. **For new/moved `AssetRef` entries with `uploadedBy: "ai"`:** upload the referenced generated asset content to `assets/{file}` (or a Shopify CDN-eligible path per Admin API asset upload conventions).
6. **Post-write:** trigger a Theme Parser re-parse (doc 07 §6, "Shopforge-initiated publish" trigger) against exactly what was just written, both to refresh the `ThemeManifest` cache and as a self-check — if the fresh parse's derived structure disagrees with what the Model *thought* it wrote (e.g. a hand-crafted `liquidSource` from a generative operation produced schema JSON that doesn't parse the way the Model assumed), that's surfaced as a validation failure (doc 15) before the write is confirmed to the user as successful, not after.

The Serializer never needs to reason about *why* a value changed (AI vs. editor) — it only reads the current `ThemeModel` state, making it fully agnostic to origin. Provenance (`causedBy`) lives on the `Diff` records, not on the Model or the Serializer's output.

---

## 6. Principle 7 — One Model, No Disconnected Representations

Principle 7 states: visual editor and AI must never maintain two disconnected representations. The design above satisfies this structurally, not by convention:

```
                     ┌─────────────────────────┐
                     │   ThemeModel (per        │
                     │   themeVersionId)         │
                     │   — single source of      │
                     │     truth, DB-persisted   │
                     └────────────┬──────────────┘
                                  │
                     mutation API (§4) — the ONLY write path
                                  │
              ┌───────────────────┴───────────────────┐
              │                                         │
   Visual Editor (doc 06)                    AI Operation Executor (doc 11)
   drag/drop, inspector field edit           executes Operation[] from an
   -> calls e.g. moveSectionInstance,        approved Operation Plan
      setSectionSetting directly              -> calls the SAME functions,
      from UI event handlers                     e.g. moveSectionInstance,
                                                  setSectionSetting, driven by
                                                  each Operation's `type`/`target`/
                                                  `payload`
              │                                         │
              └───────────────────┬───────────────────┘
                                  │
                     every call emits a Diff (architecture-core §4)
                     tagged causedBy.type = "editor_edit" | "ai_operation"
                                  │
                     both paths read back from the SAME ThemeModel
                     (editor re-render + AI's next-turn context both
                      query current ThemeModel state — never a cached
                      or forked copy)
                                  │
                     Theme Serializer (§5) — single write-back path
                     to real Liquid/JSON files, origin-agnostic
```

Concretely, this means:

- There is exactly one `OperationType` -> mutation-function mapping (architecture-core §3's `OperationType` list maps 1:1 onto §4's function table above: `update_setting` -> `setSectionSetting`, `move_section` -> `moveSectionInstance`, `add_block` -> `addBlock`, etc.). The AI Operation Executor is, mechanically, just another caller of the editor's own mutation functions — it has no private mutation logic, no shadow copy of section state, and no ability to bypass Manifest-schema validation that the editor's UI wouldn't also be subject to.
- If a user is looking at the Visual Editor and asks the AI chat to "make the hero heading bigger" in the same session, the AI's `setGlobalStyle`/`setSectionSetting` call updates the exact same `ThemeModel` row the editor is rendering from — the editor reflects the change on its next state read (live-sync via the same `/editor/get-model` + mutation-broadcast path used for the editor's own optimistic-update reconciliation, doc 18), not via a separate "AI changes" merge step.
- Undo/redo and the Diff/Snapshot system (doc 14) operate over one unified Diff stream regardless of `causedBy` — an AI operation can be undone from the editor's undo stack and vice versa, because both produced identical `DiffEntry` shapes against the identical Model.
- There is only one serialization path to real files (§5): the AI never writes Liquid/JSON directly, and the editor never writes Liquid/JSON directly — both changes accumulate in `ThemeModel` and are flushed by the same Serializer, which is what guarantees the file output is always self-consistent regardless of how many alternating editor/AI edits preceded the save.
