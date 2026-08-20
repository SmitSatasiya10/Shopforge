# 07 — Theme Parser

## 1. Purpose and Scope

The Theme Parser is the ingestion boundary between an arbitrary Shopify Online Store 2.0 (OS 2.0) theme file tree and everything Shopforge does afterward. It performs one job: **read the theme's files and produce a `ThemeManifest`** — a flat, static, read-only summary of what the theme *is* (its sections, settings, blocks, presets, templates, and derived capabilities).

The Parser does not mutate anything. It does not build the `ThemeModel` (that is doc 09's Theme Model builder, which consumes the Manifest). It does not talk to the AI. It is a pure, deterministic (for a given file tree) transform:

```
file tree (theme.zip / Shopify Theme API pull) --> Theme Parser --> ThemeManifest
```

Because the Manifest is derived data, it is always safe to throw away and regenerate. The Parser is the only component permitted to write a `ThemeManifest` record.

---

## 2. Input

The Parser's input is the theme's full file tree, obtained either by:

- Pulling all theme files via the Shopify Admin API / Theme Access API (`GET /themes/{id}/assets.json` enumerated per file), or
- Receiving an uploaded `.zip` export of a theme (manual import path, e.g. a theme the merchant purchased but hasn't published).

Both paths normalize to the same in-memory file tree shape before parsing begins: a flat map of `{ relativePath: rawContentBuffer }`, e.g. `"sections/hero-banner.liquid" -> Buffer`. This normalization step is what lets the rest of the Parser be agnostic to source (live store vs. uploaded zip).

---

## 3. Directory-by-Directory Extraction

The Parser walks the standard OS 2.0 directory layout. Each directory maps to a specific extraction responsibility and a specific slice of the `ThemeManifest`.

### 3.1 `layout/`

- Reads `layout/theme.liquid` (and any alternate layouts referenced by templates, e.g. `layout/checkout.liquid` if present, though checkout.liquid is largely irrelevant post-Plus-checkout-extensibility and is recorded but not deeply parsed).
- Extracts `{% section %}` and `{% sections %}` (section group) calls to identify which section groups (`header-group.json`, `footer-group.json`, etc. under `sections/`) are wired into the layout.
- Populates `ThemeManifest.layouts[]` with `{ file, sections: [sectionGroupRef] }`.

### 3.2 `templates/`

- Enumerates every file in `templates/`. OS 2.0 templates are JSON (`product.json`, `index.json`, `collection.json`, custom variants like `product.deluxe.json`); legacy `.liquid` templates may still be present alongside JSON ones during a partial migration.
- For each `*.json` template: parses the JSON directly. Extracts the ordered `sections` object keys as `sectionOrder`, cross-references each entry's `type` field against the parsed `sections/` directory to build `sectionsUsed`.
- Derives `resourceType` from the filename stem (`product`, `collection`, `page`, `index`, `cart`, `blog`, `article`, `search`, `404`), with dotted-suffix custom templates (`product.deluxe.json`) still mapping to their base `resourceType` (`product`) so the AI system knows what resource they render.
- For each `*.liquid` template (vintage-style template even inside an otherwise OS 2.0 theme — this does happen for templates a developer never migrated): records `type: "liquid"`, and attempts a best-effort regex scan for `{% section '...' %}` calls to populate `sectionsUsed`, but `sectionOrder` is left as `null` since Liquid templates don't declare a manifest-legible order — reordering such a template is out of scope for structural `move_section` operations and is flagged via `capabilities` (see §5).
- Populates `ThemeManifest.templates[]`.

### 3.3 `sections/`

This is the richest extraction target.

- For every `sections/*.liquid` file, the Parser extracts the `{% schema %} ... {% endschema %}` block via a Liquid-tag-aware scanner (not a naive regex — it must correctly handle nested `{% %}` inside string literals within the JSON, and files with zero or malformed schema blocks, see §7).
- The extracted string is parsed as JSON. From it:
  - `schema.name` -> `schemaName`
  - `schema.settings[]` -> `settings: [SettingDef]` (mapped field-for-field: `id, type, label, default, options?, min?, max?, step?, unit?`)
  - `schema.blocks[]` -> `blocks: [BlockDef]` (`type, name, settings, limit?`)
  - `schema.presets[]` -> `presets: [PresetDef]` (`name, settings, blocks`)
  - `schema.max_blocks` -> `maxBlocks` (null if absent, meaning unlimited)
- `sectionId` is the file basename without extension (e.g. `hero-banner.liquid` -> `hero-banner`), matching the canonical `sectionId` field used throughout the Manifest and later by `ThemeModel.SectionInstance.sectionType`.
- `usedInTemplates` is back-filled after all templates are parsed (§3.2), by inverting `templates[].sectionsUsed`.
- `isAppBlockCompatible` is derived by checking for `{% content_for "blocks" %}` (current syntax) or the legacy `"@app"` entry inside `schema.blocks[].type` (older convention) — either signals the section accepts merchant-installed app blocks, which matters to the AI planner when it's deciding whether an upsell/review app's block can be dropped in without new code.
- `sections/*.json` files (section **groups**, e.g. `header-group.json`) are parsed separately: their `type: "header" | "footer" | ...`, ordered `order[]` of block/section references, and per-entry settings are captured and folded into the relevant `layouts[].sections` entry rather than the flat `sections[]` array, since a section group is a layout concern, not a reusable section type.

### 3.4 `snippets/`

- Enumerates `snippets/*.liquid`. For each, the Parser does a static scan of every OTHER file (primarily `sections/`) for `{% render 'snippet-name' %}` / `{% include 'snippet-name' %}` calls to build the inverse map `renderedBySections: [sectionId]`.
- Snippets have no schema of their own (Liquid gives them none), so no settings are extracted — they're recorded purely for dependency-graph purposes. This matters later: if the AI wants to `modify_liquid` a section, the Operation Planner consults this graph to know which snippets that edit might transitively touch.

### 3.5 `config/`

- `config/settings_schema.json`: theme-wide settings schema (color/typography/layout groups). Parsed into `themeSettings.schema: [SettingDef]`, flattening Shopify's grouping structure (each group is an object with a `name` and `settings[]`; the Parser flattens groups into one list but retains group membership in each `SettingDef`'s `id` namespace where Shopify uses one, e.g. `id` values are kept exactly as declared — no renaming).
- `config/settings_data.json`: parsed into `themeSettings.currentValues`, taking specifically the `current` key's resolved object (Shopify's settings_data supports named presets plus a `current` pointer/object — the Parser resolves `current` to its concrete value object regardless of whether `current` is a string preset-name reference or an inline object, so downstream consumers always see resolved values, never a preset indirection).

### 3.6 `assets/`

- Enumerates every file in `assets/`. Classifies `type` by extension: `css`/`css.liquid` -> `"css"`, `js` -> `"js"`, image extensions (`png`, `jpg`, `jpeg`, `webp`, `svg`, `gif`) -> `"image"`, font extensions (`woff`, `woff2`, `ttf`, `otf`) -> `"font"`, everything else -> `"other"`.
- Records `sizeBytes` from the raw content length.
- For `.css` and `.css.liquid` files specifically, the Parser additionally scans for top-level custom property declarations (`--name: value;` inside a `:root` or similar broad selector) to populate `cssCustomProperties[]`, tagging each with `definedIn` (the asset file path). This is what lets the AI/editor discover theme-wide design tokens that live outside `settings_schema.json` (increasingly common in OS 2.0 themes that use CSS variables driven by Liquid for color scheme application).

### 3.7 `locales/`

- Enumerates `locales/*.json`. `isDefault` is true for the file matching the shop's primary locale suffix convention (`en.default.json` pattern) or, absent that convention, the locale declared in the theme's own config. `keys` records the flattened dot-path key list (not values — values aren't needed for the Manifest; the Model layer reads them on demand) so the AI can know translation coverage exists for a given string reference without pulling the entire, sometimes very large, locale file into every context window.

---

## 4. Manifest Assembly Order

Because several fields depend on cross-referencing other directories (`usedInTemplates` needs `templates/` parsed first; section-group layout refs need `sections/*.json` parsed before `layout/`), the Parser runs in a fixed two-pass order:

1. **Pass 1 (independent extraction):** `config/`, `assets/`, `locales/`, `sections/*.liquid` (schema + settings only), `snippets/` inventory.
2. **Pass 2 (cross-referencing):** `templates/` (needs Pass 1 section list to resolve `sectionsUsed`), `layout/` + `sections/*.json` groups (needs Pass 1 section list), back-fill `usedInTemplates` on each section, back-fill `renderedBySections` on each snippet.
3. **Pass 3 (derivation):** compute `capabilities` (§5) using the fully assembled Manifest from Passes 1–2 as input, since capability rules read across sections + templates + theme settings jointly.

---

## 5. Deriving `capabilities`

`capabilities` is the single most product-critical output of the Parser: it's the flag set the AI planner consults first, before ever considering a generative operation (Principle 2: reuse existing capabilities; Principle 3: minimal AI generation). Getting this wrong in either direction is costly — a false negative causes the AI to needlessly regenerate code the theme already supports; a false positive causes the AI to point the user at a capability that doesn't actually do what they asked.

Each capability flag is computed by one of two mechanisms, and each flag's derivation method is a static, documented property of that flag (not a runtime choice):

### 5.1 Static rule-based flags

These are computed by exact/structural matching against schema fields — no fuzzy logic, fully deterministic and explainable.

| Flag | Rule |
|---|---|
| `hasHeroSection` | A section exists whose settings include an `image_picker`- or `video`-typed setting AND a `richtext`/`text`-typed setting AND is referenced in `sectionOrder[0]` or `[1]` of the `index` template. (Position matters — a text+image section buried at the bottom of the homepage is not a hero.) |
| `hasAnnouncementBar` | A section or section-group entry whose `sectionId`/`schemaName` matches `/announce|announcement|marquee|topbar|utility-bar/i`, OR whose parsed section group `type` is a group rendered inside `layout/theme.liquid` above the header render call. |
| `supportsColorSchemes` | `themeSettings.schema` contains a `SettingDef` of `type === "color_scheme"` or `type === "color_scheme_group"` (the OS 2.0 marker types Shopify introduced for shared color scheme pickers). |
| `supportsSectionGroups` | At least one `layouts[].sections` entry resolves to a `sections/*.json` group file (as opposed to a bare `{% section %}` call), for both a header-equivalent and footer-equivalent slot. |
| `hasUpsellCapability` | A section's `blocks[]` contains a block `type` matching `/upsell|cross-sell|bundle|frequently-bought/i` in its `type` or `name`, OR a section is `isAppBlockCompatible: true` AND the store's installed-apps list (fetched separately, not part of the Manifest itself) includes a known upsell app — this half of the check is why `hasUpsellCapability` is documented as a *hybrid* flag: the Parser can only set the file-structural half; the full resolved value is finalized by doc 12's context-assembly step, which has access to the live app list the Parser does not. |

Static rules are intentionally narrow and keyword/structure-based because they must be cheap (computed synchronously on every parse, no LLM call) and fully explainable in the UI ("we detected this because your theme has a section with an image and rich text at the top of your homepage").

### 5.2 Semantic / embedding-matched flags

Some capabilities can't be reliably named by keyword because theme authors use wildly inconsistent naming (`schemaName` values like "Trust Block", "Social Proof Grid", "Customer Love Wall" may all be the same underlying capability as a section literally named "Reviews"). For these, the Parser does NOT do the matching itself — it only prepares the input. The actual embedding-similarity comparison against a canonical capability-description library is performed by the AI Context system (doc 12), because it requires a model/embedding call and the Parser is deliberately kept LLM-free (fast, deterministic, runs on every webhook-triggered re-sync without incurring AI cost).

| Flag | Why it's semantic, not rule-based |
|---|---|
| `hasReviewsSection` | Review sections vary hugely in naming and shape (star widgets, testimonial grids, third-party app embeds). The Parser flags `hasReviewsSection` as `null` (meaning "undetermined by static rule") whenever no exact keyword match (`/review|testimonial|rating/i` in `schemaName`, `sectionId`, or any block/setting label) is found, and doc 12's embedding pass resolves the `null` to `true`/`false` using semantic similarity of the section's full extracted schema (settings labels, block names) against a reference "reviews section" description. |
| `hasFaqSection` | Same pattern: keyword rule (`/faq|frequently asked|question/i`) covers the obvious case and sets the flag directly; ambiguous cases (a generic "Accordion" section that's actually used for FAQs) are left `null` for embedding resolution. |
| `hasProductRecommendations` | Keyword rule checks for Shopify's own `{% recommendations %}` Liquid tag or `product-recommendations` section handle (very reliable signal, Shopify-provided primitive) — when found, set `true` directly, no embedding needed. When absent, set `null` and defer to embedding match against custom "you may also like" style sections, since third-party/custom-built recommendation UIs don't use the native tag. |

**Contract with the Manifest schema:** any `capabilities` flag may legitimately be `null` at Parser-output time, meaning "the Parser could not determine this statically." The Manifest's `capabilities` object is documented (doc 08 §2) as tri-state (`true | false | null`) precisely to support this handoff — doc 12 never has to guess whether the Parser tried and failed vs. simply doesn't cover that flag. `null` is only ever resolved into `true`/`false` in the context-assembly layer, never persisted back into the cached `ThemeManifest` itself, since embedding results can depend on the reference-library version and shouldn't silently invalidate a manifest cache keyed purely on theme file content (`themeVersionHash`).

---

## 6. Re-parsing Triggers

The Manifest must never silently go stale relative to the actual theme files, since AI decisions and editor state both trust it as ground truth for "what capabilities exist." Two triggers cause a re-parse:

1. **Webhook-driven:** Shopify's `themes/publish` and asset-update-adjacent activity is not granularly webhook-covered per-file, so Shopforge polls theme asset checksums via the Admin API on a short interval (see doc 18 for the exact `/theme/*` contract) whenever a `ShopifyInstallation` is active, AND explicitly re-parses immediately after any Shopforge-initiated publish (our own Theme Serializer writing files back triggers a parse of what was just written, both to refresh the cache and as a self-check that serialization round-trips cleanly).
2. **Explicit re-sync:** user-triggered "Re-sync from Shopify" action (surfaced when a merchant edits the theme directly in Shopify's native theme editor outside Shopforge, which our system cannot observe in real time) — exposed via `/theme/parse` (doc 18).

In both cases, the Parser re-reads the full file tree (it does not attempt incremental/partial re-parsing — theme trees are small enough, typically low hundreds of files totaling a few MB, that full re-parse is cheap and correctness from a clean read is worth more than the complexity of incremental diffing at this layer). Incremental *comparison* happens one level up, via `themeVersionHash` (§7).

---

## 7. Manifest Caching and Invalidation via `themeVersionHash`

- `themeVersionHash` is computed as a stable hash (e.g. SHA-256) over the sorted concatenation of every file's relative path + content bytes in the theme tree. Any single-byte change anywhere in the tree changes the hash.
- Before running a full parse, the Parser computes `themeVersionHash` cheaply (hash-only pass, no schema parsing) and checks it against the `themeVersionHash` stored on the most recent cached `ThemeManifest` (DB entity, doc 17) for that `Theme`.
- **Cache hit** (hash unchanged): the cached Manifest is returned as-is; no re-parse. This is the common case for the polling trigger (§6.1) when the merchant hasn't touched the theme since the last check.
- **Cache miss** (hash changed or no prior Manifest exists): full parse runs, producing a new `ThemeManifest` row, and the previous Manifest is retained (not deleted) for diffing/audit purposes — `ThemeManifest` is itself a cache entity per theme *version*, not a singleton per theme, matching doc 17's `ThemeManifest(cache)` entity being keyed by version.
- Manifest invalidation is therefore purely content-driven, never time-based (no TTL expiry) — a Manifest is valid forever for the exact file content it was computed from, and only ever superseded by a new hash.

---

## 8. Error Handling

### 8.1 Malformed section schema

If a `{% schema %}` block fails JSON parsing (trailing commas, unescaped quotes, truncated block — all observed in the wild from hand-edited themes), the Parser:

- Does not fail the entire parse.
- Records that section with `settings: [], blocks: [], presets: []` and an entry in a Manifest-adjacent `parseWarnings[]` list (surfaced to doc 15's validation layer and to the user as "we couldn't fully read section X — AI edits to it will be treated as higher-risk").
- The section still gets a `sectionId` and `file` entry (from the filename, independent of schema parse success) so template `sectionsUsed` references don't dangle.

### 8.2 Missing `config/settings_schema.json` or `settings_data.json`

Both files are required by the OS 2.0 spec; their absence is one of the strongest signals of a non-OS-2.0 (vintage) theme (see §8.3). If present but malformed JSON, same partial-failure treatment as §8.1: `themeSettings.schema`/`currentValues` default to empty, warning recorded.

### 8.3 Vintage (pre-2.0) theme detection — explicit rejection, not degraded support

**Decision: vintage themes are explicitly rejected in v1, not supported in any degraded mode.**

Detection rule: a theme is classified vintage if `templates/` contains zero `*.json` files (i.e., every template is legacy `.liquid`) OR `config/settings_schema.json` is absent. Either condition alone is sufficient — real-world vintage themes reliably fail both, but requiring only one keeps the check robust against partially-migrated edge cases.

When detected, the Parser aborts before Pass 2 and returns a structured rejection result (not a partial `ThemeManifest`):

```
ThemeParseResult {
  status: "rejected"
  reason: "vintage_theme_unsupported"
  message: "This theme predates Shopify's Online Store 2.0 architecture (no JSON templates / no settings_schema.json found). Shopforge requires an OS 2.0 theme to safely map sections and settings. Please upgrade to an OS 2.0-compatible theme (Shopify's free Dawn-based themes, or your current theme's 2.0 version if the developer has published one) and re-import."
}
```

**Justification for outright rejection over degraded support:**

- The entire Shopforge value proposition rests on structural reuse: parsing real `settings_schema` + JSON template section order to make targeted, reversible edits. Vintage themes have no declared section schema (sections aren't first-class — the whole page is often one monolithic `index.liquid`), no ordered/reorderable section list, and no per-section settings contract. Every field in `ThemeManifest.sections[]` and `TemplateNode.sectionOrder` (doc 08/09) simply has no source of truth to read from.
- A "best-effort" vintage parser would have to fall back to regex-scraping arbitrary Liquid for guessed section-like `{% include %}` boundaries, which produces a Manifest whose `capabilities` flags and `settings` are unreliable in exactly the way that undermines Principle 4 (ask instead of guessing) and Principle 1 (preserve the existing theme) — presenting a merchant with an editable capability list built on guesses is worse than clearly declining and directing them to upgrade, since Shopify itself actively steers all merchants toward OS 2.0 and free 2.0-compatible themes are readily available.
- Silently degrading (e.g., treating a vintage theme as "OS 2.0 with zero sections detected") would produce a Manifest that looks structurally valid but is functionally empty, causing every downstream capability check to false-negative and every user request to fall through to `create_section_file`/`modify_liquid` — i.e., Shopforge would behave exactly like Dropmagic's blind-regeneration approach for these merchants, which is the specific failure mode this product exists to avoid.
- Rejecting with a clear, actionable message costs the merchant one theme-upgrade step (usually free) versus Shopforge silently offering a degraded, generation-heavy experience under the same "targeted edit" marketing promise.

This is recorded as a v1 constraint, not a permanent one: a future vintage-adapter Parser mode is a plausible v2 investment if usage data shows meaningful demand from merchants unwilling/unable to upgrade, but it is out of scope here and must not be implicitly half-supported by weakening the detection rule above.

### 8.4 Partial/corrupt file tree (network/zip errors)

If the source file tree itself is incomplete (failed download, truncated zip, Admin API pagination error mid-fetch), the Parser refuses to run at all and returns `status: "rejected", reason: "incomplete_file_tree"` — it never produces a Manifest from a file set it cannot confirm is complete, since a Manifest silently missing files is strictly more dangerous than one that's never created (silent capability false-negatives again). The caller (import flow) is expected to retry the fetch.
