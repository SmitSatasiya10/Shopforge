# Shared Section Contract

## 1. What It Is

The **Shared Section Contract** is the mechanism that keeps the AI, the Visual Editor, the LiquidJS preview, and
Shopify's own Liquid engine in sync. For a given section `type`, its settings/blocks shape is defined **once**,
in that section's `contract.json`, and consumed **identically** by all four systems — there is no per-consumer
translation layer, and no second place where a section's settings shape is redefined.

```
                      contract.json  (SettingDef[] / BlockDef[] / PresetDef[])
                            |
        +-------------------+-------------------+--------------------+
        v                   v                   v                    v
  AI Generation      Visual Editor     LiquidJS Preview       Shopify Liquid
  (reads catalog,    (renders          Renderer               (production;
   writes settings)   inspector        (injects settings       reads section
                       fields)          into render context)    .settings/.blocks)
```

This is structural, not conventional: the LiquidJS preview's `section.settings` object and Shopify's native
`section.settings` object are populated from the **literal same JSON values** in the same
[Store Configuration](03-store-configuration.md), read by two different Liquid execution engines against the
same Liquid template file — never a preview-only copy. One settings shape per `type`, one place it's defined,
four consumers reading/writing against it directly.

## 2. Where the Contract Lives: the Section Registry

Every section in the [Section Library](02-base-theme-and-section-library.md) is a self-contained directory of
five sibling artifacts, reviewed and versioned together:

```
section-library/
  sections/
    hero/
      hero.liquid            # Liquid template (schema block generated into this file at build time)
      contract.json           # Shared Section Contract — SettingDef[]/BlockDef[]/PresetDef[]
      editor.meta.json        # Inspector metadata: field groups, icon, category, help text
      design-spec.md          # Visual/brand guidelines (human-reviewed, not machine-consumed)
      thumbnail.png           # Editor "add section" picker preview image
    product-grid/
      product-grid.liquid
      contract.json
      editor.meta.json
      design-spec.md
      thumbnail.png
    ...
  catalog.json                 # Generated: every section's type, category, status, contractVersion, contract
  build/
    generate-schema.ts         # Compiles each contract.json into its section's {% schema %} block
    generate-catalog.ts        # Rebuilds catalog.json from every sections/*/contract.json + editor.meta.json
```

`catalog.json` is the **section registry**: the one artifact most systems need. AI context assembly reads it to
ground the AI's understanding of which sections exist and what settings each accepts. The Visual Editor reads it
to populate the "add section" picker and, together with each section's `editor.meta.json`, to drive inspector
field rendering. Neither AI nor the editor ever reads a `.liquid` file directly.

## 3. Section Type Identifiers

A section's canonical identifier is its **type slug** — a short, kebab-case string (`hero`, `product-grid`,
`faq`) that is simultaneously:

- The Liquid filename stem (`sections/hero.liquid`).
- The `type` value every `SectionInstance` in a Store Configuration uses to reference it.
- The key the LiquidJS Preview Renderer uses to resolve which Liquid template to load.

This one identifier is threaded through every consumer in §1. It is treated as an immutable primary key once a
section is published (§7) — getting it wrong anywhere means preview and production diverge.

## 4. Why a Separate Contract, Not Just Shopify's `{% schema %}`

Shopify's native `{% schema %}` JSON block and `contract.json` describe the same settings, but they are not
maintained by hand twice. `contract.json` is the single source of truth for a section's settings/blocks shape.
The `{% schema %}` block embedded in the `.liquid` file is **generated from** `contract.json` at build time
(`generate-schema.ts`), never hand-written. This guarantees the two can never drift: there is exactly one place
a section author edits settings shape, and the Liquid-native schema Shopify reads is always a mechanical
projection of it. `contract.json` additionally carries a `contractVersion` (§7) that has no equivalent field in
Shopify's own schema format.

## 5. Contract Schema

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

`SettingDef.default` is the value a setting resolves to when a `SectionInstance`/`BlockInstance` does not
explicitly set it — the same default Shopify's generated `{% schema %}` block declares, so an unset value
renders identically in preview and production.

## 6. Worked Example: the Hero Contract

```json
{
  "type": "hero",
  "name": "Hero",
  "category": "content",
  "settings": [
    { "id": "heading", "type": "text", "label": "Heading", "default": "Your headline here" },
    { "id": "description", "type": "richtext", "label": "Description", "default": "" },
    { "id": "image", "type": "image_picker", "label": "Background image" },
    { "id": "buttonText", "type": "text", "label": "Button label", "default": "Shop Now" },
    { "id": "buttonLink", "type": "url", "label": "Button link" },
    { "id": "buttonColor", "type": "color", "label": "Button color", "default": "#1a1a1a" },
    { "id": "backgroundColor", "type": "color", "label": "Background color", "default": "#ffffff" },
    { "id": "textColor", "type": "color", "label": "Text color", "default": "#1a1a1a" }
  ],
  "blocks": [],
  "presets": [
    {
      "name": "Hero",
      "settings": {
        "heading": "Premium Comfort",
        "description": "Designed for better sleep",
        "buttonText": "Shop Now",
        "buttonColor": "#1a1a1a",
        "backgroundColor": "#ffffff",
        "textColor": "#1a1a1a"
      },
      "blocks": []
    }
  ]
}
```

The same eight settings flow through every consumer without translation:

**Store Configuration** — a `SectionInstance` of `type: "hero"` holds current values keyed by `SettingDef.id`:

```json
{
  "id": "hero-1",
  "type": "hero",
  "settings": {
    "heading": "Premium Comfort",
    "description": "Designed for better sleep",
    "image": { "url": "https://cdn.shopforge.app/assets/.../hero-bg.jpg", "alt": "...", "source": "ai-generated" },
    "buttonText": "Shop Now",
    "buttonLink": "/products/example",
    "buttonColor": "#1a1a1a",
    "backgroundColor": "#ffffff",
    "textColor": "#1a1a1a"
  },
  "blocks": []
}
```

**Editor controls** — `editor.meta.json` groups the same `SettingDef` ids into inspector tabs/sections and maps
each `SettingDef.type` onto a concrete inspector control:

```json
{
  "type": "hero",
  "groups": [
    { "label": "Content", "fields": ["heading", "description", "buttonText", "buttonLink"] },
    { "label": "Style", "fields": ["image", "buttonColor", "backgroundColor", "textColor"] }
  ],
  "icon": "hero.svg",
  "category": "content",
  "helpText": {
    "heading": "The primary headline shown above the fold."
  }
}
```

| `SettingDef.type` | Editor control |
|---|---|
| `text` | Single-line text input |
| `richtext` | Rich text editor |
| `image_picker` | Asset picker (upload / AI-generate / stock) |
| `color` | Color swatch + hex input |
| `color_scheme` | Theme color-scheme selector |
| `range` | Slider (uses `min`/`max`/`step`/`unit`) |
| `select` | Dropdown (uses `options[]`) |
| `checkbox` | Toggle |
| `video` | Video picker |
| `url` | URL input, internal-link aware |
| `product` | Product picker (resolves to `ProductRef`) |
| `collection` / `blog` / `page` | Resource picker for the respective Shopify resource type |
| `font_picker` | Font family selector |

**Liquid `{% schema %}`** — generated from the same `contract.json`, embedded in `hero.liquid`:

```liquid
{% schema %}
{
  "name": "Hero",
  "settings": [
    { "id": "heading", "type": "text", "label": "Heading", "default": "Your headline here" },
    { "id": "description", "type": "richtext", "label": "Description" },
    { "id": "image", "type": "image_picker", "label": "Background image" },
    { "id": "buttonText", "type": "text", "label": "Button label", "default": "Shop Now" },
    { "id": "buttonLink", "type": "url", "label": "Button link" },
    { "id": "buttonColor", "type": "color", "label": "Button color", "default": "#1a1a1a" },
    { "id": "backgroundColor", "type": "color", "label": "Background color", "default": "#ffffff" },
    { "id": "textColor", "type": "color", "label": "Text color", "default": "#1a1a1a" }
  ],
  "presets": [
    { "name": "Hero" }
  ]
}
{% endschema %}
```

**Preview and production read identically.** Inside `hero.liquid`, both the LiquidJS Preview Renderer and
Shopify's own Liquid engine read the same object shape:

```liquid
<section class="hero" style="background-color: {{ section.settings.backgroundColor }}; color: {{ section.settings.textColor }};" data-sf-section-id="{{ section.id }}" data-sf-section-type="hero">
  <h1 data-sf-setting="heading">{{ section.settings.heading }}</h1>
  <div data-sf-setting="description">{{ section.settings.description }}</div>
  <a href="{{ section.settings.buttonLink }}" style="background-color: {{ section.settings.buttonColor }};" data-sf-setting="buttonText">
    {{ section.settings.buttonText }}
  </a>
</section>
```

The LiquidJS Preview Renderer injects `SectionInstance.settings`/`blocks` from the Store Configuration into
`section.settings`/`section.blocks[]` in its render context, mirroring Shopify's own Liquid object shape
exactly. Shopify reads the same values natively, arrived at by publish-time serialization of the Store
Configuration into the Base Theme's `templates/{page}.json` section entries. Neither engine ever reads a
preview-only copy of the template or the settings.

## 7. Preview and Editor Metadata

Beyond the settings values themselves, each section's Liquid template emits `data-sf-*` DOM attributes (shown
above as `data-sf-section-id`, `data-sf-section-type`, `data-sf-setting`) so the Visual Editor's click-to-select
and in-preview editing can map a clicked DOM node back to a specific section, block, or setting. Authoring these
attributes is a section-authoring responsibility, reviewed alongside the rest of the section's five artifacts.
The full attribute contract and the click-to-select mapping mechanism are specified in
[DOM Metadata and Selection](10-dom-metadata-and-selection.md); this document only records that the `data-sf-*`
namespace is emitted per-instance from the same contract.

`editor.meta.json` additionally carries a `category` and `thumbnail.png` used by the editor's "add section"
picker, and richer inspector groupings than Shopify's own theme editor supports natively.

## 8. Defaults and Validation

- **Defaults.** `SettingDef.default` (and `PresetDef.settings`/`blocks` for a full preset) supplies the value
  used when a `SectionInstance`/`BlockInstance` omits a setting. The same default is compiled into the
  generated `{% schema %}` block, so an unset value resolves identically in preview and production.
- **Validation.** Every value AI or the editor writes into a `SectionInstance`/`BlockInstance` is validated
  against the target `SettingDef.type` (and `options`/`min`/`max`/`step` where declared) before being written
  into the Store Configuration. This is one instance of the multi-category validation pipeline that gates every
  write; see [Validation and Error Handling](17-validation-and-error-handling.md) for the full pipeline.

## 9. Consumers, Precisely

| Consumer | Reads settings via | Writes settings via |
|---|---|---|
| **AI Generation** | The section registry's `catalog.json` (aggregated `contract.json` per active `type`), to know which setting ids/types are valid for the section it's about to place. | Produces `SectionInstance.settings`/`blocks[].settings` values, validated against `SettingDef.type` before being written into the Store Configuration. See [AI Architecture](04-ai-architecture.md). |
| **Visual Editor** | Store Configuration current values, rendered as inspector fields per `SettingDef` plus that section's `editor.meta.json` grouping/labels. | Inspector field edits patch `StoreConfiguration.pages.{key}.sections[].settings` (or `.blocks[].settings`) directly. See [Visual Editor](09-visual-editor.md). |
| **LiquidJS Preview Renderer** | Store Configuration `settings`/`blocks` for the instance being rendered, injected into the LiquidJS render context as `section.settings.*`/`section.blocks[]`. | Never writes — pure reader. See [Preview Architecture](06-preview-architecture.md). |
| **Shopify Liquid (production)** | The same `settings`/`blocks` values, arrived at by publish-time serialization of the Store Configuration into the Base Theme's `templates/{page}.json` section entries, read natively via Shopify's own `section.settings`/`section.blocks` objects. | Never writes back automatically at MVP — production is a one-way publish target. See [Shopify Publishing](14-shopify-publishing.md). |

## 10. Contract Stability and Versioning

**A section type slug's contract never changes shape once published. Type identity is contract identity.**

- Every `contract.json` carries a `contractVersion` (semver-style string, e.g. `"1.4.0"`), bumped on every
  change, tracked for audit/changelog purposes.
- **Backward-compatible changes** — adding a new optional setting or block with a schema-level default,
  adjusting a label/help-text string, internal Liquid refactors that don't touch any `SettingDef.id`/`type` or
  `BlockDef.type` — publish **in place**, as a MINOR or PATCH `contractVersion` bump. The `type` slug is
  unchanged. Every existing `SectionInstance` of that `type`, in every store, continues to render exactly as
  before, and immediately becomes eligible to use the new optional field (at its schema default until explicitly
  set).
- **Breaking changes** — removing a setting, renaming a `SettingDef.id`, changing a setting's `type`
  incompatibly, removing or renaming a `BlockDef.type` — are **never** made in place. They publish as a **new
  type slug** (e.g. `hero` -> `hero-v2`), with its own full five-artifact directory, cataloged *alongside*, not
  instead of, the original, starting again at `contractVersion: "1.0.0"`.
- The original slug is marked `status: "deprecated"` in `catalog.json`. Its Liquid, contract, and schema are
  **never deleted** — a deprecated section remains fully renderable, in both preview and production,
  indefinitely. Deprecation only changes two things: it's excluded from the AI's section-catalog context for new
  placements, and excluded from the editor's "add section" picker for new placements. A Store Configuration may
  reference a mix of active and deprecated types at once; this is an expected, safe steady state.

Because contract shape is immutable per type slug, a stored Store Configuration is never invalidated by a
Section Library release, and no automatic migration step is ever required when the library changes.

## 11. Open Questions / TBD

- **Final DOM metadata attribute names beyond the `data-sf-*` namespace** — TBD. The namespace is settled;
  exact attribute names beyond section/block/setting identity are specified in
  [DOM Metadata and Selection](10-dom-metadata-and-selection.md).
- **Offering an in-editor upgrade path from a deprecated section type to its replacement** (e.g. surfacing "a
  newer version of this Hero section is available") — Needs Investigation. No mechanism exists today;
  deprecation only stops new placements, it does not prompt migration.
