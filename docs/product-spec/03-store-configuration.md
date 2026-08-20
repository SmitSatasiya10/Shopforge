# Store Configuration

## 1. What It Is

The **Store Configuration** is the single, authoritative, editable representation of one generated store. AI
generation writes to it, the Visual Editor reads and writes it, the LiquidJS Preview Renderer reads it to render
the preview iframe, and Publish serializes it into the Base Theme's own Shopify JSON templates. Every reference
elsewhere in this specification to "the store's content" or "the generated site" means this document.

It is pure structured data — pages, section instances, and their settings — never Liquid source, rendered HTML,
or a theme file tree. Every `type` a Store Configuration can reference comes from the fixed
[Section Library](02-base-theme-and-section-library.md) catalog; there is no arbitrary section shape to infer.

It is **authored**, not derived: AI generation creates it, the user edits it, and it is never silently
regenerated or discarded. It persists exactly as any other piece of user-generated content does.

```
Product Data  +  AI Generation
                     |
                     v
             Store Configuration  <---->  Visual Editor
                     |
        +------------+-------------+
        v                          v
  LiquidJS Preview Renderer   Publish -> Base Theme
                                 templates/*.json -> Shopify Liquid
```

## 2. Top-Level Shape

```json
{
  "storeConfigId": "sc_7f2a91",
  "projectId": "project_4b1c02",
  "version": 6,
  "pages": {
    "home": {
      "pageType": "home",
      "sections": [
        {
          "id": "hero-1",
          "type": "hero",
          "settings": {
            "heading": "Premium Comfort",
            "description": "Designed for better sleep",
            "image": {
              "url": "...",
              "alt": "...",
              "source": "ai-generated"
            },
            "buttonText": "Shop Now",
            "buttonLink": "/products/example"
          },
          "blocks": [],
          "visibility": { "desktop": true, "tablet": true, "mobile": true },
          "disabled": false
        }
      ]
    }
  },
  "globalSettings": {
    "colors": { "primary": "#1a1a1a", "secondary": "#f5f3ef", "accent": "#c8552d", "background": "#ffffff", "text": "#1a1a1a" },
    "typography": { "headingFont": "Fraunces", "bodyFont": "Inter", "scaleRatio": 1.25, "baseSize": 16 },
    "buttons": { "radius": 4, "style": "solid" }
  },
  "createdAt": "2026-08-12T09:14:02Z",
  "updatedAt": "2026-08-20T11:03:47Z"
}
```

`pages -> sections[] -> {id, type, settings, blocks}` is the canonical shape referenced throughout this
folder. This document specifies every field on top of that shape.

## 3. Field Reference

### 3.1 `StoreConfiguration` (top level)

| Field | Type | Description |
|---|---|---|
| `storeConfigId` | `string` | Internal id for this configuration document. |
| `projectId` | `string` | The `Project` this configuration belongs to. A `Project` has exactly one *current* configuration at any time (§6). |
| `version` | `integer` | Monotonically increasing version number, incremented on every save. `(projectId, version)` is the natural storage key (§6). |
| `pages` | `{ [pageKey: string]: PageConfig }` | Every page in the store, keyed by a stable page key (§3.2). |
| `globalSettings` | `GlobalSettings` | Store-wide brand tokens shared across sections (§3.5). |
| `createdAt` | `timestamp` | When this version was created. |
| `updatedAt` | `timestamp` | Last write to this version (meaningful pre-save; a saved version is otherwise immutable, §6). |

### 3.2 `PageConfig`

| Field | Type | Description |
|---|---|---|
| `pageType` | `"home" \| "product" \| "collection" \| "about" \| "custom" \| ...` | Which kind of page this is. Determines which Base Theme template it serializes into at publish time. |
| `slug` | `string?` | URL path segment. Required when `pageType === "custom"`; derived from the resource for built-in types. |
| `sections` | `SectionInstance[]` | Ordered array of section instances rendered on this page. **Array order is render order** — there is no separate order field to keep in sync; reordering a page is reordering this array. |

**Page keying.** `home` and `about` are singleton keys under `pages`. `product` is represented as one
`PageConfig` **template** whose `sections[]` describes the default product-page layout, applied to every
product via product references inside individual sections' settings (§3.8) — MVP does not support per-product
page layout overrides; every product renders through the same `product` page template. `collection` follows the
same single-template convention. One-off pages (a landing page, a policy page authored by AI) use
`pageType: "custom"` with a unique key and `slug`.

### 3.3 `SectionInstance`

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Stable instance id (UUID), unique within the Store Configuration, assigned once at creation and never reused or reassigned, even after removal. |
| `type` | `string` | Section type slug. Must match an entry in the current [Section Library](02-base-theme-and-section-library.md) catalog — active or deprecated — never an arbitrary or unknown string. |
| `settings` | `{ [settingId: string]: SettingValue }` | Current values, keyed by `SettingDef.id` from the section's [Shared Section Contract](12-shared-section-contract.md). |
| `blocks` | `BlockInstance[]?` | Ordered block instances. Omitted or `[]` for a section whose contract declares no `BlockDef[]`. |
| `visibility` | `Visibility?` | Per-device show/hide (§3.6). Omitted means visible on all devices. |
| `disabled` | `boolean?` | Default `false`. A disabled instance is excluded from render but retained in the configuration, mirroring Shopify's own disabled-section convention at publish time. |

### 3.4 `BlockInstance`

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Stable instance id (UUID), unique within its parent `SectionInstance`. |
| `type` | `string` | Block type. Must match a `BlockDef.type` declared in the parent section's contract. |
| `settings` | `{ [settingId: string]: SettingValue }` | Current values, keyed by `SettingDef.id` from that block's `BlockDef.settings`. |

### 3.5 `GlobalSettings`

| Field | Type | Description |
|---|---|---|
| `colors` | `{ primary, secondary, accent, background, text: string }` | Hex/CSS color values. |
| `typography` | `{ headingFont, bodyFont: string, scaleRatio, baseSize: number }` | Font family and type-scale tokens. |
| `buttons` | `{ radius: number, style: "solid" \| "outline" \| "soft" }` | Shared button treatment. |

`GlobalSettings` is small and fully structured. Because the Base Theme's own `config/settings_schema.json` is
first-party and fixed, every `GlobalSettings` field maps 1:1 onto a known Base Theme setting id at publish time.
There is no unknown-key passthrough bucket, because there is no unknown theme to be defensive about.

### 3.6 `Visibility`

```
Visibility {
  desktop: boolean   // default true
  tablet: boolean    // default true
  mobile: boolean    // default true
}
```

Per-device visibility is the only responsive dimension a `SectionInstance`/`BlockInstance` supports. Per-setting
responsive overrides (e.g. a different heading size on mobile vs. desktop) are **not** supported at MVP — a
setting has exactly one value across all breakpoints, and any responsive behavior beyond show/hide is handled by
the section's own Liquid/CSS, not by the Store Configuration. This is a deliberate MVP scope cut.

### 3.7 Shared sub-schemas: `SettingDef`, `BlockDef`, `PresetDef`

These are authored once per section, inside that section's `contract.json` (see
[Shared Section Contract](12-shared-section-contract.md)), and are reused verbatim by every consumer — one
settings-description shape across the entire system, not a per-context variant:

```
SettingDef {
  id: string             // e.g. "heading" — the key SectionInstance.settings/BlockInstance.settings use
  type: string            // "text" | "richtext" | "image_picker" | "color" | "color_scheme" |
                           // "range" | "select" | "checkbox" | "video" | "url" | "product" |
                           // "collection" | "blog" | "page" | "font_picker" | ...
  label: string
  default?: any
  options?: [{ value: string, label: string }]   // for "select"
  min?: number
  max?: number
  step?: number
  unit?: string
}

BlockDef {
  type: string            // e.g. "review", "faq-item"
  name: string
  settings: SettingDef[]
  limit?: number
}

PresetDef {
  name: string
  settings: object                                    // section-level defaults for this preset
  blocks: [{ type: string, settings: object }]
}
```

### 3.8 `SettingValue` — primitives and reference shapes

Most `SettingValue`s are plain primitives (`string`, `number`, `boolean`) matching their `SettingDef.type`. Two
`type`s resolve to structured reference shapes instead, because their content originates outside the Store
Configuration itself:

```
ProductRef {
  productId: string
  handle: string
  source: "scraped" | "shopify"     // "scraped" before first publish (from Product Import), "shopify"
                                     // once resolved against a live Shopify product id post-publish
}

AssetRef {
  url: string
  alt?: string
  source: "ai-generated" | "scraped" | "stock" | "user-uploaded"
}
```

A `SettingDef.type === "product"` value is a `ProductRef`. A `SettingDef.type === "image_picker"` or `"video"`
value is an `AssetRef`. Both shapes carry `source` — provenance drives editor UI treatment (e.g. an
AI-generated image gets a regenerate affordance) and downstream cost accounting.

### 3.9 Section order, section ids, and section types — disambiguated

| Term | Where it lives | What it identifies |
|---|---|---|
| **Section order** | `PageConfig.sections` array position | Render order on that page. Implicit in array index — reordering a page is reordering this array, nothing else changes. |
| **Section id** | `SectionInstance.id` | *This specific placed instance* — stable across reorders, edits, and duplication of other instances. Two sections of the same `type` on one page have different `id`s. |
| **Section type** | `SectionInstance.type` | *Which section from the library* this instance renders through — shared by every instance of, say, `hero`, across every store and every page. |

## 4. Example: Homepage Store Configuration

A homepage using a hero, a product grid, testimonials, and an FAQ, plus a shared product-page template:

```json
{
  "storeConfigId": "sc_7f2a91",
  "projectId": "project_4b1c02",
  "version": 6,
  "pages": {
    "home": {
      "pageType": "home",
      "sections": [
        {
          "id": "sec_a1",
          "type": "hero",
          "settings": {
            "heading": "Everyday Carry, Elevated",
            "subheading": "Minimal bags built for how you actually move.",
            "image": {
              "url": "https://cdn.shopforge.app/assets/sc_7f2a91/hero-bg.jpg",
              "alt": "Model wearing the Field Sling in charcoal",
              "source": "ai-generated"
            },
            "color_scheme": "scheme-1",
            "cta_label": "Shop the Collection",
            "cta_url": "/collections/all"
          },
          "blocks": [],
          "visibility": { "desktop": true, "tablet": true, "mobile": true },
          "disabled": false
        },
        {
          "id": "sec_a2",
          "type": "product-grid",
          "settings": {
            "heading": "Best Sellers",
            "source": "collection",
            "collection_handle": "best-sellers",
            "products_per_row": 4,
            "max_products": 8
          },
          "blocks": [],
          "visibility": { "desktop": true, "tablet": true, "mobile": true }
        },
        {
          "id": "sec_a3",
          "type": "testimonials",
          "settings": { "heading": "Loved by commuters everywhere" },
          "blocks": [
            {
              "id": "blk_t1",
              "type": "testimonial",
              "settings": {
                "quote": "Fits my laptop and still looks sharp with a suit.",
                "author": "D. Okafor",
                "rating": 5
              }
            },
            {
              "id": "blk_t2",
              "type": "testimonial",
              "settings": {
                "quote": "Best bag I've owned. The magnetic clasp is genius.",
                "author": "R. Alvarez",
                "rating": 5
              }
            }
          ],
          "visibility": { "desktop": true, "tablet": true, "mobile": true }
        },
        {
          "id": "sec_a4",
          "type": "faq",
          "settings": { "heading": "Questions, answered" },
          "blocks": [
            {
              "id": "blk_f1",
              "type": "faq-item",
              "settings": {
                "question": "What's your return policy?",
                "answer": "Free returns within 30 days, no questions asked."
              }
            },
            {
              "id": "blk_f2",
              "type": "faq-item",
              "settings": {
                "question": "How long does shipping take?",
                "answer": "3-5 business days within the continental US."
              }
            }
          ],
          "visibility": { "desktop": true, "tablet": true, "mobile": true }
        }
      ]
    },
    "product": {
      "pageType": "product",
      "sections": [
        {
          "id": "sec_p1",
          "type": "product-gallery",
          "settings": {},
          "visibility": { "desktop": true, "tablet": true, "mobile": true }
        },
        {
          "id": "sec_p2",
          "type": "product-information",
          "settings": { "show_reviews_badge": true },
          "visibility": { "desktop": true, "tablet": true, "mobile": true }
        }
      ]
    }
  },
  "globalSettings": {
    "colors": {
      "primary": "#1a1a1a",
      "secondary": "#f5f3ef",
      "accent": "#c8552d",
      "background": "#ffffff",
      "text": "#1a1a1a"
    },
    "typography": {
      "headingFont": "Fraunces",
      "bodyFont": "Inter",
      "scaleRatio": 1.25,
      "baseSize": 16
    },
    "buttons": { "radius": 4, "style": "solid" }
  },
  "createdAt": "2026-08-12T09:14:02Z",
  "updatedAt": "2026-08-20T11:03:47Z"
}
```

The `product-grid` instance's `source: "collection"` + `collection_handle` settings are themselves just values
of `SettingDef.type: "select"`/`"text"` — a "which products" selection strategy is modeled as ordinary settings,
not a special-cased field, which is what lets AI generation write it the same way it writes any other setting.

## 5. Field Index

| Path | Type | Defined in |
|---|---|---|
| `pages` | `{ [pageKey]: PageConfig }` | §3.1 |
| `pages.{key}.pageType` | string enum | §3.2 |
| `pages.{key}.slug` | string? | §3.2 |
| `pages.{key}.sections` | `SectionInstance[]` | §3.2 |
| `pages.{key}.sections[].id` | string | §3.3 |
| `pages.{key}.sections[].type` | string | §3.3 |
| `pages.{key}.sections[].settings` | `{ [id]: SettingValue }` | §3.3 |
| `pages.{key}.sections[].blocks` | `BlockInstance[]?` | §3.3 |
| `pages.{key}.sections[].blocks[].id` | string | §3.4 |
| `pages.{key}.sections[].blocks[].type` | string | §3.4 |
| `pages.{key}.sections[].blocks[].settings` | `{ [id]: SettingValue }` | §3.4 |
| `pages.{key}.sections[].visibility` | `Visibility?` | §3.6 |
| `pages.{key}.sections[].disabled` | boolean? | §3.3 |
| `globalSettings.colors` | object | §3.5 |
| `globalSettings.typography` | object | §3.5 |
| `globalSettings.buttons` | object | §3.5 |

## 6. Versioning and Storage

- **Persistence.** Each Store Configuration save produces a new row, keyed by the natural composite
  `(projectId, version)`. The **current** configuration for a project is the row with the highest `version` for
  that `projectId`; there is no separate "is current" flag to keep in sync.
- **Draft vs. published.** [Shopify Publishing](14-shopify-publishing.md) owns the precise mechanics of how a
  `version` transitions from editor working state to live on Shopify. This document only guarantees that every
  save is an immutable, retrievable version — the primitive publishing builds on top of.
- **Section-library-version interaction.** Because a section type slug's contract shape is immutable once
  published — breaking changes always ship under a new type slug, never mutate an existing one (see
  [Base Theme and Section Library](02-base-theme-and-section-library.md)) — a stored Store Configuration
  referencing `type: "hero"` remains structurally valid **forever**, regardless of how many Section Library
  releases happen after it was saved. No automatic migration of stored configurations is ever required in
  response to a library change. A Store Configuration may reference a section `type` that is later marked
  `status: "deprecated"` in the catalog — this is expected and safe; deprecation stops that `type` from being
  offered for *new* placements, it does not stop existing instances from rendering, in preview or production.
- **Retention.** Old versions are retained, not deleted, for audit/history purposes. This document's `version`
  field is coarser-grained (whole-configuration snapshots per save) than the [Diff](18-versioning-and-undo-redo.md)
  stream's fine-grained per-field history; the two are complementary representations, not competing ones.

## 7. Downstream Consumption

- **AI Generation** consumes the Section Library catalog to select `type`s and populate valid `settings`/
  `blocks`, then writes the result into a new Store Configuration version. AI never reads or writes anything
  outside this schema — no Liquid, no raw HTML. See [AI Architecture](04-ai-architecture.md).
- **LiquidJS Preview Renderer** is the primary read-only consumer, rendering a Store Configuration into the
  preview iframe. See [Preview Architecture](06-preview-architecture.md).
- **Publishing** serializes a Store Configuration version into the Base Theme's real `templates/*.json` section
  entries and `config/settings_data.json` (for `globalSettings`), then pushes through the Shopify Admin API. The
  only contract publishing needs from this document is that a Store Configuration is a stable, versioned,
  fully-resolved (no dangling `ProductRef`/`AssetRef`) document at the moment it's handed off. See
  [Shopify Publishing](14-shopify-publishing.md).

## 8. Open Questions / TBD

- **Section settings-schema migration path across Base Theme versions for already-published stores** — TBD.
  Migration is not designed at this layer beyond the immutable-per-type-slug guarantee in §6.
- **Client-side vs. server-side LiquidJS execution for the live editing preview** — Decision Required. A
  per-section server-rendered fragment is settled for share-link/thumbnail rendering only; where rendering
  happens during an active live-editing session is unresolved.
