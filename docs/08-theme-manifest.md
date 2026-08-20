# 08 — Theme Manifest

## 1. What the Manifest Is (and Isn't)

`ThemeManifest` is the flat, static, machine-readable summary of a theme's file tree, produced exclusively by the Theme Parser (doc 07). It answers "what does this theme *contain and support*" — section types, their settings/blocks/presets, template structure, theme-wide settings, assets, locales, and derived capability flags.

It is **not**:

- The editable, in-progress state of a merchant's storefront (that's `ThemeModel`, doc 09).
- Hand-edited or hand-editable — it is entirely derived, and any manual correction to it would be silently overwritten on the next re-parse.
- A copy of raw file contents — it holds structural/schema-level data extracted *from* files, not the files themselves (raw Liquid source is fetched on demand by the Theme Model builder, doc 09 §3).

Think of the Manifest as a compiled table-of-contents-plus-schema for the theme: cheap to read, safe to hand to an LLM as context, and rebuildable at any time from the source files with zero information loss versus re-parsing (it carries no state that doesn't come from the files).

---

## 2. Full Field Reference

### 2.1 Top-level `ThemeManifest`

| Field | Type | Description |
|---|---|---|
| `themeId` | `string` | Shopforge-internal `Theme` entity id (doc 17). Stable across re-parses and republishes. |
| `shopifyThemeId` | `string` | Shopify's own theme id (`GET /themes.json` id), used for all Admin API calls against this theme. |
| `themeName` | `string` | Theme's display name as set in Shopify (from the theme resource, not derived from files). |
| `shopifyRole` | `"main" \| "unpublished" \| "development" \| "demo"` | Shopify's theme role at parse time. `"main"` is the live storefront theme — mutations against it carry elevated risk framing in the UI (doc 06) even though the underlying Operation/Diff mechanics are identical. |
| `parsedAt` | `timestamp` | When this Manifest was produced. Informational only — cache validity is governed by `themeVersionHash`, not recency (doc 07 §7). |
| `themeVersionHash` | `string` | SHA-256 over all file paths + contents. Primary cache/invalidation key (doc 07 §7). Two Manifests with the same hash are guaranteed structurally identical and are never both materialized. |
| `layouts` | `LayoutEntry[]` | Parsed `layout/*.liquid` files and the section groups they wire in. |
| `templates` | `TemplateEntry[]` | One entry per file in `templates/`. |
| `sections` | `SectionEntry[]` | One entry per reusable section type in `sections/*.liquid`. |
| `snippets` | `SnippetEntry[]` | One entry per file in `snippets/`. |
| `themeSettings` | `ThemeSettingsBlock` | Global theme settings schema + resolved current values. |
| `assets` | `AssetEntry[]` | One entry per file in `assets/`. |
| `locales` | `LocaleEntry[]` | One entry per file in `locales/`. |
| `cssCustomProperties` | `CssCustomProperty[]` | CSS custom properties discovered in `assets/*.css`. |
| `capabilities` | `Capabilities` | Derived capability flags (tri-state, see §2.9). |
| `parseWarnings` | `ParseWarning[]` | Non-fatal issues encountered during parsing (doc 07 §8.1–8.2). Empty array when parse was clean. |

### 2.2 `LayoutEntry`

| Field | Type | Description |
|---|---|---|
| `file` | `string` | e.g. `"layout/theme.liquid"`. |
| `sections` | `SectionGroupRef[]` | Section groups rendered by this layout. |

`SectionGroupRef { groupFile: string, groupType: "header" \| "footer" \| "other", order: [{ type: "section" \| "block", ref: string }] }` — `ref` is a `sectionId` when `type === "section"`, or a block type string when `type === "block"` (section groups can directly place blocks, per OS 2.0 group JSON spec).

### 2.3 `TemplateEntry`

| Field | Type | Description |
|---|---|---|
| `file` | `string` | e.g. `"templates/product.json"`. |
| `type` | `"json" \| "liquid"` | JSON templates get full structural parsing; Liquid templates get best-effort scanning only (doc 07 §3.2). |
| `resourceType` | `"product" \| "collection" \| "page" \| "index" \| "cart" \| "blog" \| "article" \| "search" \| "404" \| "custom"` | Derived from filename stem. |
| `sectionsUsed` | `sectionId[]` | Deduplicated set of section types referenced anywhere in the template. |
| `sectionOrder` | `sectionId[] \| null` | Ordered instance sequence for JSON templates; `null` for `.liquid` templates (no declarative order to read). |

### 2.4 `SectionEntry`

| Field | Type | Description |
|---|---|---|
| `sectionId` | `string` | File basename without extension. Canonical identifier reused as `ThemeModel.SectionInstance.sectionType` (doc 09 §2). |
| `file` | `string` | e.g. `"sections/hero-banner.liquid"`. |
| `schemaName` | `string` | `schema.name` — the human label Shopify's own theme editor shows. |
| `settings` | `SettingDef[]` | See §2.7. |
| `blocks` | `BlockDef[]` | See §2.7. |
| `presets` | `PresetDef[]` | See §2.7. |
| `maxBlocks` | `number \| null` | `schema.max_blocks`; `null` = unlimited. |
| `usedInTemplates` | `string[]` | Template `file` values that reference this section (back-filled, doc 07 §3.3). |
| `isAppBlockCompatible` | `boolean` | Whether merchant-installed app blocks can be dropped into this section (doc 07 §3.3). |

### 2.5 `SnippetEntry`

| Field | Type | Description |
|---|---|---|
| `file` | `string` | e.g. `"snippets/price.liquid"`. |
| `renderedBySections` | `sectionId[]` | Sections that `{% render %}`/`{% include %}` this snippet. |

### 2.6 `ThemeSettingsBlock`

| Field | Type | Description |
|---|---|---|
| `schema` | `SettingDef[]` | Flattened `config/settings_schema.json` (group structure collapsed, `id`s preserved verbatim). |
| `currentValues` | `object` | Resolved `config/settings_data.json` `current` values (preset indirection already resolved by the Parser). |

### 2.7 Shared sub-schemas

```
SettingDef {
  id: string          // Liquid-accessible key, e.g. "heading"
  type: string         // Shopify setting type: "text" | "richtext" | "image_picker" | "color" |
                        // "color_scheme" | "color_scheme_group" | "range" | "select" | "checkbox" |
                        // "video" | "url" | "product" | "collection" | "blog" | "page" | "font_picker" | ...
  label: string
  default?: any
  options?: [{ value: string, label: string }]   // for "select"
  min?: number
  max?: number
  step?: number
  unit?: string
}

BlockDef {
  type: string          // "@app" for the app-block slot, or a custom block type
  name: string
  settings: SettingDef[]
  limit?: number
}

PresetDef {
  name: string
  settings: object                                   // section-level setting defaults for this preset
  blocks: [{ type: string, settings: object }]
}
```

These three sub-schemas are reused verbatim wherever a schema-shaped object appears in the Manifest (section settings, block settings, theme settings) — there is deliberately one `SettingDef` shape across the entire system rather than per-context variants, since the AI context layer (doc 12) and editor inspector (doc 06) both need to render/reason about settings identically regardless of where they came from.

### 2.8 `AssetEntry`, `LocaleEntry`, `CssCustomProperty`

```
AssetEntry { file: string, type: "css"|"js"|"image"|"font"|"other", sizeBytes: number }
LocaleEntry { code: string, isDefault: boolean, keys: string[] }
CssCustomProperty { name: string, value: string, definedIn: string }
```

### 2.9 `Capabilities` (tri-state)

Every field is `true | false | null`. `null` means "the Parser's static rules could not determine this" and is only ever resolved to `true`/`false` downstream by doc 12's embedding-match layer — never persisted back into the cached Manifest (doc 07 §5.2).

| Field | Meaning |
|---|---|
| `hasHeroSection` | A prominent image/video + text section exists near the top of the homepage. |
| `hasReviewsSection` | A reviews/testimonial/rating capability exists. |
| `hasFaqSection` | An FAQ/accordion-of-questions capability exists. |
| `hasProductRecommendations` | Native or custom "related products" capability exists. |
| `hasAnnouncementBar` | A top-of-page announcement/marquee capability exists. |
| `hasUpsellCapability` | Upsell/cross-sell/bundle capability exists (file-structural half only — see doc 07 §5.1). |
| `supportsColorSchemes` | Theme uses OS 2.0 `color_scheme`/`color_scheme_group` setting types. |
| `supportsSectionGroups` | Header/footer are declared as section groups rather than hardcoded layout markup. |

`capabilities` is explicitly documented as **extensible**: new flags are added over time as the AI planner's operation vocabulary grows (doc 07 §5, doc 12). Adding a flag is additive and non-breaking to stored Manifests — consumers must treat an absent key as equivalent to `null`, not as `false`.

### 2.10 `ParseWarning`

```
ParseWarning {
  path: string              // file the warning concerns
  code: "malformed_schema_json" | "malformed_settings_data" | "missing_settings_schema" | "unresolvable_snippet_ref"
  message: string
}
```

---

## 3. Example: Realistic 2-Section Homepage Manifest

The following illustrates a minimal-but-realistic Manifest for a theme whose homepage (`templates/index.json`) uses a hero section and a reviews section, in a theme that supports color schemes and section groups.

```json
{
  "themeId": "thm_9f3c2a",
  "shopifyThemeId": "138412495001",
  "themeName": "Refresh",
  "shopifyRole": "main",
  "parsedAt": "2026-08-19T14:02:11Z",
  "themeVersionHash": "sha256:7c1a9e4f2b...d0e3",
  "layouts": [
    {
      "file": "layout/theme.liquid",
      "sections": [
        {
          "groupFile": "sections/header-group.json",
          "groupType": "header",
          "order": [{ "type": "section", "ref": "header" }]
        },
        {
          "groupFile": "sections/footer-group.json",
          "groupType": "footer",
          "order": [{ "type": "section", "ref": "footer" }]
        }
      ]
    }
  ],
  "templates": [
    {
      "file": "templates/index.json",
      "type": "json",
      "resourceType": "index",
      "sectionsUsed": ["hero-banner", "reviews"],
      "sectionOrder": ["hero-banner", "reviews"]
    }
  ],
  "sections": [
    {
      "sectionId": "hero-banner",
      "file": "sections/hero-banner.liquid",
      "schemaName": "Hero Banner",
      "settings": [
        { "id": "heading", "type": "text", "label": "Heading", "default": "Welcome to our store" },
        { "id": "subheading", "type": "richtext", "label": "Subheading", "default": "<p>Great products, great prices.</p>" },
        { "id": "image", "type": "image_picker", "label": "Background image" },
        { "id": "color_scheme", "type": "color_scheme", "label": "Color scheme", "default": "scheme-1" }
      ],
      "blocks": [],
      "presets": [
        { "name": "Hero Banner", "settings": { "heading": "Welcome to our store" }, "blocks": [] }
      ],
      "maxBlocks": null,
      "usedInTemplates": ["templates/index.json"],
      "isAppBlockCompatible": false
    },
    {
      "sectionId": "reviews",
      "file": "sections/reviews.liquid",
      "schemaName": "Customer Reviews",
      "settings": [
        { "id": "heading", "type": "text", "label": "Heading", "default": "What our customers say" }
      ],
      "blocks": [
        {
          "type": "review",
          "name": "Review",
          "settings": [
            { "id": "quote", "type": "richtext", "label": "Quote" },
            { "id": "author", "type": "text", "label": "Author" },
            { "id": "rating", "type": "range", "label": "Rating", "min": 1, "max": 5, "step": 1, "default": 5 }
          ],
          "limit": 12
        }
      ],
      "presets": [
        { "name": "Customer Reviews", "settings": {}, "blocks": [
          { "type": "review", "settings": { "quote": "Amazing quality!", "author": "J. Smith", "rating": 5 } }
        ] }
      ],
      "maxBlocks": 12,
      "usedInTemplates": ["templates/index.json"],
      "isAppBlockCompatible": false
    }
  ],
  "snippets": [
    { "file": "snippets/icon-star.liquid", "renderedBySections": ["reviews"] }
  ],
  "themeSettings": {
    "schema": [
      { "id": "type_header_font", "type": "font_picker", "label": "Heading font", "default": "assistant_n4" },
      { "id": "type_body_font", "type": "font_picker", "label": "Body font", "default": "assistant_n4" }
    ],
    "currentValues": {
      "type_header_font": "assistant_n4",
      "type_body_font": "assistant_n4"
    }
  },
  "assets": [
    { "file": "assets/base.css", "type": "css", "sizeBytes": 48213 },
    { "file": "assets/theme.js", "type": "js", "sizeBytes": 21044 }
  ],
  "locales": [
    { "code": "en", "isDefault": true, "keys": ["general.search", "products.product.add_to_cart"] }
  ],
  "cssCustomProperties": [
    { "name": "--color-background", "value": "#ffffff", "definedIn": "assets/base.css" },
    { "name": "--color-accent", "value": "#1a73e8", "definedIn": "assets/base.css" }
  ],
  "capabilities": {
    "hasHeroSection": true,
    "hasReviewsSection": true,
    "hasFaqSection": null,
    "hasProductRecommendations": null,
    "hasAnnouncementBar": false,
    "hasUpsellCapability": null,
    "supportsColorSchemes": true,
    "supportsSectionGroups": true
  },
  "parseWarnings": []
}
```

---

## 4. Versioning and Storage Strategy

- **Persistence:** each `ThemeManifest` is stored as a single JSON document in the DB, on the `ThemeManifest` table/entity (doc 17's `ThemeManifest(cache)`), keyed by `(themeId, themeVersionHash)`. This is a natural-key composite: the same `themeId` accumulates one row per distinct hash ever seen, not one row overwritten in place. Storing JSON directly (rather than fully normalizing every nested array into relational tables) is a deliberate choice — the Manifest is read as a whole document far more often than it is queried by a specific nested field, and its shape evolves as capability flags are added, which JSON storage absorbs without migrations.
- **Retention:** old Manifests are not deleted on new-hash re-parse. They remain queryable for audit ("what did the theme look like when this AI operation ran") and to support diffing a Diff's `before` state (doc 14) against structural context, not just raw settings values.
- **Lookup:** the "current" Manifest for a theme is simply the row with the most recent `parsedAt` among rows for that `themeId` — there is no separate `isCurrent` flag to keep in sync, since `parsedAt` ordering is sufficient and avoids a second source of truth.
- **Size:** Manifests are small relative to raw theme files (they hold schema/structure, not Liquid source or asset bytes), typically tens of KB even for large themes — cheap to store per-version indefinitely, and cheap to load in full for every AI context assembly (doc 12) or Theme Model build (doc 09) without pagination.

---

## 5. Downstream Consumption

### 5.1 By the AI Context-Selection System (doc 12)

Doc 12 loads the current `ThemeManifest` as the primary structured-context source for grounding the AI's understanding of "what this store's theme can do" before any Operation Plan is drafted. Specifically:

- `capabilities` is consulted first, as the cheapest possible check for "does a structural answer exist" (Principle 3: minimal AI generation) — a `true` flag lets the planner propose a structural `Operation` (doc 06 in architecture-core §3) referencing the relevant `sectionId`/`SettingDef` directly, with zero AI-generation cost.
- `null` capability flags are what triggers doc 12's embedding-match resolution pass, comparing `sections[].schemaName` + `settings[].label` + `blocks[].name` text against a reference capability-description library.
- `sections[]`, `themeSettings.schema`, and `templates[].sectionOrder` are used to build the compact, token-budgeted context window handed to the LLM — the Manifest's flatness is what makes this cheap: doc 12 never needs to open raw Liquid files to know what settings a section exposes.
- `cssCustomProperties` and `themeSettings.currentValues` ground style-related requests ("make the buttons more rounded") in the theme's actual current design tokens rather than guessed values.

### 5.2 By the Theme Model Builder (doc 09)

Doc 09's build step uses the Manifest as its structural skeleton and schema authority, while pulling current *values* from raw file contents (`templates/*.json` current section-instance settings, `config/settings_data.json`) rather than from the Manifest itself (the Manifest only carries settings_data's `currentValues` at the theme-settings level, not per-section-instance values, since section instances don't exist yet at Manifest time — they're a Model-layer concept). Concretely:

- Every `TemplateNode` in `ThemeModel.templates` is seeded from a matching `ThemeManifest.templates[]` entry (`sectionOrder` becomes the initial `sectionInstances` order, `sectionGroups` from `layouts[].sections`).
- Every `SectionInstance.sectionType` is validated against `ThemeManifest.sections[].sectionId` — the Model builder refuses to materialize a section instance whose type isn't in the Manifest (a strong integrity check: it means the raw file and the Manifest have drifted, which should only be possible mid-re-parse, never at steady state).
- `SettingDef.default` values from the Manifest are used to fill in any section-instance setting missing from the raw JSON (Shopify allows omitting settings that equal their schema default).
- `GlobalStyles` (doc 09 §2) is constructed by mapping known `themeSettings.schema` ids (color/typography/button/spacing-shaped settings, identified by `SettingDef.type` and `id` naming convention) into the structured `GlobalStyles` shape, with everything else in `currentValues` passed through untouched into `GlobalStyles.raw`.

This division of labor is deliberate: the Manifest never holds live per-instance state, and the Model never re-derives schema/structure from raw files independently — it always trusts the Manifest for "what's possible" and raw files only for "what's currently set," which keeps exactly one source of truth for each kind of fact.
