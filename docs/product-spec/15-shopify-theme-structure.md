# Shopify Theme Structure

This document specifies the actual Shopify (Online Store 2.0) theme structure the Base Theme uses, and the
conversion boundary between the Store Configuration and Shopify's native file representation. See
[Shopify Publishing](14-shopify-publishing.md) for when and how this conversion runs.

## 1. The installed theme's file tree

Every merchant's installed copy of the Base Theme follows Shopify's standard OS 2.0 theme directory structure:

```
<installed theme>/
  layout/
    theme.liquid            # root HTML shell every template renders inside
  templates/
    index.json               # home page — references sections by type + instance settings
    product.json
    collection.json
    ...                       # one JSON template per page type the Base Theme supports
  sections/
    hero.liquid
    product-grid.liquid
    header.liquid
    footer.liquid
    ...                       # every Section Library entry's .liquid file (doc 02)
  snippets/
    *.liquid                  # shared partials referenced by sections/layout
  assets/
    *.css / *.js / *.svg      # theme-level static assets Shopforge authored
  config/
    settings_schema.json      # theme-level settings definitions (Base Theme-authored)
    settings_data.json        # theme-level settings values (store-specific, written at publish)
  locales/
    en.default.json
    ...
```

This is the same tree described in [Base Theme and Section Library §1](02-base-theme-and-section-library.md);
this document covers what lives inside `templates/` and `config/` in more detail, since those are what publish
actually writes on every run.

### 1.1 JSON templates

Each page type (`index`, `product`, `collection`, and any others the Base Theme ships) has a corresponding
`templates/<type>.json` file. A JSON template lists, for that page, which section instances render and in what
order, plus each instance's settings and block values:

```json
{
  "sections": {
    "hero-1": {
      "type": "hero",
      "settings": {
        "heading": "Premium Comfort",
        "description": "Designed for better sleep",
        "image": "shopify://shop_images/hero.jpg",
        "buttonText": "Shop Now",
        "buttonLink": "/products/example"
      },
      "blocks": {}
    },
    "product-grid-1": {
      "type": "product-grid",
      "settings": { "collection": "best-sellers", "columns": 4 },
      "blocks": {}
    }
  },
  "order": ["hero-1", "product-grid-1"]
}
```

Shopify resolves each entry's `type` to the matching `sections/<type>.liquid` file and renders it with
`settings`/`blocks` bound into `section.settings` / `section.blocks` inside that Liquid template — the same
binding model the LiquidJS Preview Renderer uses against the identical Liquid file (see
[Preview Architecture](06-preview-architecture.md)).

### 1.2 Section groups and layout-level sections

Shopify's OS 2.0 model additionally supports **section groups** (e.g. a `header`/`footer` group rendered by
`layout/theme.liquid` outside any page-specific JSON template) for site-wide sections that appear on every page.
Where the Base Theme uses this mechanism for `header`/`footer`-style Sections, the same conversion rule applies:
the Store Configuration's representation of that Section maps onto the section group's JSON entry the same way
a page-level Section maps onto a page template's entry (§2).

### 1.3 Theme settings

`config/settings_schema.json` defines theme-wide settings (color palette, typography choices, global layout
options) the Base Theme itself declares; `config/settings_data.json` holds the store-specific values for those
settings. Where the Store Configuration carries theme-level (not section-level) settings, they map onto
`settings_data.json` the same way section settings map onto a JSON template (§2).

## 2. How the Store Configuration maps onto this structure

The Store Configuration's shape (`pages -> sections[] -> {id, type, settings, blocks}`, see
[Store Configuration](03-store-configuration.md)) and Shopify's JSON template shape
(`sections: { <id>: {type, settings, blocks} }, order: [...]`) are close but not identical — the conversion at
publish time (see [Shopify Publishing §1](14-shopify-publishing.md)) is a deliberate, explicit mapping, not an
assumption that the two are byte-identical:

| Store Configuration | Shopify representation | Notes |
|---|---|---|
| `pages.<page>.sections[]` (ordered array) | `templates/<page>.json` → `sections: {...}` (keyed object) + `order: []` (array of ids) | Array order becomes the explicit `order` array; each array entry becomes a keyed object entry. |
| `SectionInstance.id` | JSON template section key, and the `id` referenced in `order` | Same identifier, different position in the surrounding structure. |
| `SectionInstance.type` | JSON template section entry's `type` | Identical value — the same type slug used to resolve `sections/<type>.liquid` in both the LiquidJS preview and Shopify (doc 02 §2.1). |
| `SectionInstance.settings` | JSON template section entry's `settings` | Same key/value shape per the Shared Section Contract (doc 12); values pass through, with asset references resolved to Shopify-hosted URLs (doc 13). |
| `SectionInstance.blocks[]` | JSON template section entry's `blocks` (keyed object) + a `block_order` array | Same array-to-keyed-object-plus-order transform as top-level sections. |
| Theme-level settings (if present in the Store Configuration) | `config/settings_data.json` | Only applies where the Base Theme exposes theme-wide (not per-section) settings. |

## 3. The conversion boundary

The Store Configuration is Shopforge's internal source of truth and is not required to be a native Shopify file
format at rest — it only needs to convert cleanly into one at publish time. Several things exist in the Store
Configuration (and the wider Section Library/editor system) with **no** Shopify-native equivalent, and are never
written to a merchant's theme:

| Shopforge-internal, never written to Shopify | Why it doesn't cross the boundary |
|---|---|
| Field-level `ai`/`user` provenance tags | Provenance is Shopforge's own regeneration bookkeeping (see [AI Architecture](04-ai-architecture.md)); Shopify has no concept of who authored a setting value. |
| `contract.json` / `contractVersion` | The Shared Section Contract is Shopforge's canonical settings definition, from which the Liquid `{% schema %}` block is generated at build time (doc 02 §2.2) — it is a build-time input to controlled code, not a per-store publish artifact. |
| `editor.meta.json` | Inspector-only metadata (field grouping, icons, help text) with no Shopify-side consumer. |
| `data-sf-*` DOM attributes | Emitted by the Liquid templates themselves as ordinary HTML attributes (doc 02 §7) — present in both rendered outputs, but not a distinct "conversion" concern; they are part of the controlled Liquid, not the JSON conversion. |
| `ConfigurationVersion` / `Diff` / version history | Shopforge's own versioning system (see [Versioning and Undo/Redo](18-versioning-and-undo-redo.md)); `PublishHistory` records which version was converted and published, but intermediate versions and diffs are never sent to Shopify. |
| `PreviewSession` / `GenerationJob` state | Editor/AI process bookkeeping with no publish-time output at all. |

Conversely, the reverse direction — reading a Shopify-native file back into the Store Configuration — is not
part of this flow at all. Shopforge never reads a theme's `templates/*.json` back out of Shopify to reconstruct
a Store Configuration; the Store Configuration is authored once (by AI/the editor) and only ever pushed forward
onto Shopify, never pulled back from it (see [DECISIONS.md](DECISIONS.md)).

**Consequence**: the conversion step in [Shopify Publishing §1](14-shopify-publishing.md) is a one-directional,
lossy-by-design projection — it emits exactly the fields Shopify's JSON template/settings-data format needs, and
nothing else. Extending the Store Configuration schema with a new Shopforge-internal field never requires a
corresponding Shopify-side representation unless that field is meant to affect rendered output.

## Open Questions / TBD

| Item | Blocking question |
|---|---|
| Section settings-schema migration across Base Theme versions | See [Shopify Publishing §4.2](14-shopify-publishing.md) and [Base Theme and Section Library §5](02-base-theme-and-section-library.md). |
| Exact `themeCreate` source artifact packaging | Whether the on-disk tree in §1 is packaged as a ZIP served over HTTPS, or some other staging mechanism, is not finalized — see [Shopify Publishing §4.1](14-shopify-publishing.md). |

See [DECISIONS.md](DECISIONS.md) for the settled decisions this document assumes.
