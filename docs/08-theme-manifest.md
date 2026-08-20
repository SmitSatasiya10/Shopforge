# 08 — Store Configuration Schema

## 1. What the Store Configuration Is (and Isn't)

`StoreConfiguration` is the single, central, editable representation of one generated store. It is the thing AI generation writes to, the thing the Visual Editor reads from and writes to, the thing the LiquidJS Preview Renderer reads to render an iframe, and — via publish-time serialization into the base theme's own JSON templates (doc 16) — the thing Shopify's real Liquid engine ultimately reads too. Every other document in this rewrite that mentions "the store's content" or "the generated site" means this structure.

It is **not**:

- A theme file tree. There is no arbitrary Liquid to parse or infer structure from — every `type` a Store Configuration can reference comes from the fixed Section Library catalog (doc 07 §3), which already declares its own settings shape. `StoreConfiguration` is pure data: pages, section instances, and their settings.
- Derived/read-only data. Unlike the old, cancelled Theme Manifest (which was regenerated from a merchant's files and safe to discard), a `StoreConfiguration` is **authored** — by AI generation, then by the merchant in the editor — and is exactly as precious as any other piece of user-generated content. It is never silently regenerated or discarded.
- A copy of Liquid or rendered HTML. It holds structured settings values, keyed by the setting ids each Section's contract declares (doc 07 §2) — never markup, never Liquid source.

Think of the Store Configuration as the store's entire content and layout, expressed as data: which Sections appear on which pages, in what order, with what settings and content — everything needed to reconstruct the storefront by combining this document with the Section Library's Liquid.

```
Product Data (scraped)  +  AI Generation (doc 11)
                              |
                              v
                     StoreConfiguration  <---->  Visual Editor (doc 06/19)
                              |
              +---------------+----------------+
              v                                 v
   Preview Renderer / LiquidJS (doc 09)   Publish (doc 16) -> base theme
                                            templates/*.json -> Shopify Liquid
```

---

## 2. Full Field Reference

### 2.1 Top-level `StoreConfiguration`

| Field | Type | Description |
|---|---|---|
| `storeConfigId` | `string` | Shopforge-internal id for this configuration document (doc 17). |
| `projectId` | `string` | The Project this configuration belongs to. One Project has exactly one *current* configuration at any time (§6). |
| `version` | `integer` | Monotonically increasing version number, incremented on every save. Together with `projectId` this is the natural key for storage (§6). |
| `pages` | `{ [pageKey: string]: PageConfig }` | Every page in the store, keyed by a stable page key (§2.2). |
| `globalSettings` | `GlobalSettings` | Store-wide brand tokens (colors, typography, buttons) shared across Sections (§2.5). |
| `createdAt` | `timestamp` | When this version was created. |
| `updatedAt` | `timestamp` | Last write to this version (only meaningful pre-finalization; a saved version is otherwise immutable, §6). |

### 2.2 `PageConfig`

| Field | Type | Description |
|---|---|---|
| `pageType` | `"home" \| "product" \| "collection" \| "about" \| "custom" \| ...` | Which kind of page this is. Drives which base-theme template it serializes into at publish time (doc 16). |
| `slug` | `string?` | URL path segment. Required when `pageType === "custom"`; derived from the resource for built-in types (e.g. `product` pages are keyed per product, §2.2.1). |
| `sections` | `SectionInstance[]` | Ordered array of Section instances rendered on this page. **Array order is render order** — there is no separate order field to keep in sync, unlike the old Manifest's `sectionOrder`/`sectionsUsed` split, because a Store Configuration is authored fresh rather than reconciled against an existing file's declared order. |

**2.2.1 Page keying:** `home` and `about` are singleton keys under `pages`. `product` pages are represented as one `PageConfig` **template** (`pages.product`) whose `sections[]` describes the default product-page layout, applied to every product via product references inside individual Sections' settings (§2.4) — Shopforge's MVP does not support per-product page layout overrides; every product renders through the same `product` page template. `collection` follows the same single-template convention. Genuinely one-off pages (a landing page, a policy page written by AI) use `pageType: "custom"` with a unique key and `slug`.

### 2.3 `SectionInstance`

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Stable instance id (UUID), unique within the `StoreConfiguration`, assigned once at creation and never reused or reassigned, even after removal. |
| `type` | `string` | Section type slug. Must match an entry in the current Section Library catalog (doc 07 §3) — active or deprecated (doc 07 §7); never an arbitrary/unknown string. |
| `settings` | `{ [settingId: string]: SettingValue }` | Current values, keyed by `SettingDef.id` from the Section's Shared Settings Contract (§5, doc 07 §2). |
| `blocks` | `BlockInstance[]?` | Ordered block instances. Omitted or `[]` for a Section whose contract declares no `BlockDef[]`. |
| `visibility` | `Visibility?` | Per-device show/hide (§2.6). Omitted means visible on all devices. |
| `disabled` | `boolean?` | Default `false`. A disabled instance is excluded from render but retained in the configuration (mirrors Shopify's own disabled-section convention at publish time, doc 16). |

### 2.4 `BlockInstance`

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Stable instance id (UUID), unique within its parent `SectionInstance`. |
| `type` | `string` | Block type. Must match a `BlockDef.type` declared in the parent Section's contract. |
| `settings` | `{ [settingId: string]: SettingValue }` | Current values, keyed by `SettingDef.id` from that block's `BlockDef.settings`. |

### 2.5 `GlobalSettings`

| Field | Type | Description |
|---|---|---|
| `colors` | `{ primary, secondary, accent, background, text: string }` | Hex/CSS color values. |
| `typography` | `{ headingFont, bodyFont: string, scaleRatio, baseSize: number }` | Font family + type-scale tokens. |
| `buttons` | `{ radius: number, style: "solid" \| "outline" \| "soft" }` | Shared button treatment. |

`GlobalSettings` is intentionally small and fully structured — unlike the old Manifest's `GlobalStyles.raw` passthrough (which existed to avoid dropping unknown keys from an arbitrary theme's `settings_data.json`), the base theme's own `config/settings_schema.json` is ours and fixed, so every `GlobalSettings` field maps 1:1 onto a known base-theme setting id at publish time (doc 16). There is no passthrough/unknown-key bucket because there is no unknown theme to be defensive about.

### 2.6 `Visibility`

```
Visibility {
  desktop: boolean   // default true
  tablet: boolean    // default true
  mobile: boolean    // default true
}
```

Per-device visibility is currently the only responsive dimension a `SectionInstance`/`BlockInstance` supports. Per-setting responsive overrides (e.g. a different heading size on mobile vs. desktop) are **not** supported at MVP — a setting has exactly one value across all breakpoints, and any responsive behavior beyond show/hide is handled by the Section's own Liquid/CSS, not by the Store Configuration. This is a deliberate MVP scope cut, not an oversight.

### 2.7 Shared sub-schemas: `SettingDef`, `BlockDef`, `PresetDef`

These are authored once per Section, inside that Section's `contract.json` (doc 07 §2/§4), and are reused verbatim by every consumer (§5) — there is one settings-description shape across the entire system, not a per-context variant:

```
SettingDef {
  id: string            // e.g. "heading" — the key SectionInstance.settings/BlockInstance.settings use
  type: string           // "text" | "richtext" | "image_picker" | "color" | "color_scheme" |
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
  type: string           // e.g. "review", "faq-item"
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

### 2.8 `SettingValue` — primitives and reference shapes

Most `SettingValue`s are plain primitives (`string`, `number`, `boolean`) matching their `SettingDef.type`. Two `type`s resolve to structured reference shapes instead, because their content originates outside the Store Configuration itself:

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

A `SettingDef.type === "product"` value is a `ProductRef`. A `SettingDef.type === "image_picker"` or `"video"` value is an `AssetRef`. Both shapes carry `source` for the same reasons the old Model's `AssetRef.uploadedBy` did — provenance drives editor UI treatment (e.g. an AI-generated image gets a regenerate affordance) and downstream cost accounting (doc 22).

### 2.9 Section order, section ids, and section types — disambiguated

Three related-but-distinct things are easy to conflate; this table exists to pin them down precisely, since every other document in this rewrite references these names:

| Term | Where it lives | What it identifies |
|---|---|---|
| **Section order** | `PageConfig.sections` array position | Render order on that page. Implicit in array index — reordering a page is reordering this array, nothing else changes. |
| **Section id** | `SectionInstance.id` | *This specific placed instance* — stable across reorders, edits, and duplication of other instances. Two Sections of the same `type` on one page have different `id`s. |
| **Section type** | `SectionInstance.type` | *Which Section from the Library* this instance renders through (doc 07 §2) — shared by every instance of, say, `hero` across every store and every page. |

---

## 3. Example: Realistic Homepage Store Configuration

A homepage using a hero, a product grid, testimonials, and an FAQ — the same worked scenario doc 09 §2 renders through the Preview Renderer.

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
          "settings": {
            "heading": "Loved by commuters everywhere"
          },
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
          "settings": {
            "heading": "Questions, answered"
          },
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
    "buttons": {
      "radius": 4,
      "style": "solid"
    }
  },
  "createdAt": "2026-08-12T09:14:02Z",
  "updatedAt": "2026-08-20T11:03:47Z"
}
```

Note that the `product-grid` instance's `source: "collection"` + `collection_handle` settings are themselves just values of `SettingDef.type: "select"`/`"text"` — a "which products" selection strategy is modeled as ordinary settings, not a special-cased field, which is what lets AI generation (doc 11) write it the same way it writes any other setting.

---

## 4. Field Reference Summary Table

A flattened index of every field this schema defines, for quick lookup from other documents:

| Path | Type | Defined in |
|---|---|---|
| `pages` | `{ [pageKey]: PageConfig }` | §2.1 |
| `pages.{key}.pageType` | string enum | §2.2 |
| `pages.{key}.slug` | string? | §2.2 |
| `pages.{key}.sections` | `SectionInstance[]` | §2.2 |
| `pages.{key}.sections[].id` | string | §2.3 |
| `pages.{key}.sections[].type` | string | §2.3 |
| `pages.{key}.sections[].settings` | `{ [id]: SettingValue }` | §2.3 |
| `pages.{key}.sections[].blocks` | `BlockInstance[]?` | §2.3 |
| `pages.{key}.sections[].blocks[].id` | string | §2.4 |
| `pages.{key}.sections[].blocks[].type` | string | §2.4 |
| `pages.{key}.sections[].blocks[].settings` | `{ [id]: SettingValue }` | §2.4 |
| `pages.{key}.sections[].visibility` | `Visibility?` | §2.6 |
| `pages.{key}.sections[].disabled` | boolean? | §2.3 |
| `globalSettings.colors` | object | §2.5 |
| `globalSettings.typography` | object | §2.5 |
| `globalSettings.buttons` | object | §2.5 |

---

## 5. The Shared Section Contract

The **Shared Section Contract** is the mechanism that keeps preview and production in sync, and it is the single most important idea in this document. For a given Section `type`, its Shared Settings Contract (`SettingDef[]`/`BlockDef[]` from doc 07 §2/§4) is consumed **identically** by four systems:

| Consumer | Reads settings via | Writes settings via |
|---|---|---|
| **AI Generation** (doc 11) | The Section Library catalog's `contract.json` for the `type` it's about to place, to know which setting ids/types are valid | Produces `SectionInstance.settings`/`blocks[].settings` values (validated against `SettingDef.type` before being written into the `StoreConfiguration`) |
| **Visual Editor** (doc 06/19) | `StoreConfiguration` current values, rendered as inspector fields per `SettingDef` + that Section's `editor.meta.json` grouping/labels | Inspector field edits patch `StoreConfiguration.pages.{key}.sections[].settings` (or `.blocks[].settings`) directly |
| **LiquidJS Preview Renderer** (doc 09) | `StoreConfiguration` `settings`/`blocks` for the instance being rendered, injected into LiquidJS's render context as `section.settings.*` / `section.blocks[]`, mirroring Shopify's own Liquid object shape exactly | Never writes — pure reader |
| **Shopify Liquid** (production) | The *same* `settings`/`blocks` values, arrived at by publish-time serialization of `StoreConfiguration` into the base theme's `templates/{page}.json` section entries (doc 16), then read natively via Shopify's own `section.settings`/`section.blocks` Liquid objects | Never writes back automatically at MVP — production is a one-way publish target |

The reason this keeps preview and production in sync isn't convention, it's structural: the LiquidJS preview's `section.settings` object and Shopify's native `section.settings` object are populated from the **literal same JSON values** in the same `StoreConfiguration`, just read by two different Liquid execution engines against the same Liquid template file (doc 07's single Liquid file, never a preview-only copy). There is exactly one settings shape per `type`, one place it's defined (`contract.json`), and four consumers that all read/write against it without any per-consumer translation layer.

---

## 6. Versioning and Storage Strategy

- **Persistence:** each `StoreConfiguration` save produces a new row, keyed by the natural composite `(projectId, version)` — the same append-only-versions convention the old Manifest used, applied here to authored rather than derived data. The **current** configuration for a store is the row with the highest `version` for that `projectId`; there is no separate "is current" flag to keep in sync.
- **Draft vs. published:** doc 16 (Publishing) owns the precise mechanics of how a `version` transitions from "editor working state" to "live on Shopify," including whatever draft/published distinction it introduces on top of this versioning scheme — this document only guarantees that every save is an immutable, retrievable version, which is the primitive doc 16 needs to build that on top of.
- **Section-library-version interaction (coordinated with doc 07 §7):** because a Section type slug's contract shape is immutable once published — breaking changes always ship under a new type slug, never mutate an existing one (doc 07 §7) — a stored `StoreConfiguration` referencing `type: "hero"` remains structurally valid **forever**, regardless of how many Section Library releases happen after it was saved. No automatic migration of stored configurations is ever required in response to a library change. The one situation worth noting: a `StoreConfiguration` may reference a Section `type` that is later marked `status: "deprecated"` in the catalog (doc 07 §7) — this is expected and safe; deprecation stops that `type` from being offered for *new* placements, it does not stop existing instances from rendering, in preview or production.
- **Size and retention:** old versions are retained (not deleted) for audit/history purposes, consistent with doc 14's diff/undo needs at the editor-interaction level — this document's `version` field is coarser-grained (whole-configuration snapshots per save) than doc 14's fine-grained per-field diff stream, and the two are complementary, not competing representations.

---

## 7. Downstream Consumption

- **AI Generation (doc 11):** consumes the Section Library catalog (doc 07 §8) to select `type`s and populate valid `settings`/`blocks`, then writes the result into a new `StoreConfiguration` version. AI never reads or writes anything outside this schema — no Liquid, no raw HTML.
- **LiquidJS Preview Renderer (doc 09):** the primary read-only consumer. Doc 09 specifies the full rendering pipeline from a `StoreConfiguration` to an iframe; this document only guarantees the schema doc 09 renders against.
- **Publishing (doc 16, owned by another writer):** serializes a `StoreConfiguration` version into the base theme's real `templates/*.json` section entries and `config/settings_data.json` (for `globalSettings`), then pushes through the Shopify Admin API. This document notes the dependency without specifying doc 16's mechanics — the only contract doc 16 needs from here is that `StoreConfiguration` is a stable, versioned, fully-resolved (no dangling `ProductRef`/`AssetRef`) document at the moment it's handed off.

---

## 8. Future / Advanced Architecture

Most of the old Theme Manifest's content is superseded outright by this schema, not deferred — there is no arbitrary theme to summarize, so most of its machinery (directory-by-directory extraction, `themeVersionHash` cache invalidation, vintage-theme rejection) has no equivalent problem to solve here.

One idea is worth flagging rather than discarding: the old Manifest's **tri-state capability flags** (`true | false | null`, used to hand off from cheap static detection to expensive embedding-based semantic resolution, per doc 07 §11) don't map onto this architecture, because Section availability here is a simple boolean lookup against a catalog we control — there's no "maybe" to resolve when the question is just "does the Section Library contain a `type: "faq"` entry." If arbitrary-theme import ever returns (doc 07 §11), an analogous tri-state pattern would likely be needed again, to represent "this imported theme's own section might satisfy the `faq` capability, pending semantic confirmation" — worth reviving then, not designed here.
