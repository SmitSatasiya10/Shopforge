# Phase 05 — Base Theme Runtime

## Objective

Load and represent the real Base Theme — the one Shopify Online Store 2.0 theme Shopforge owns — so Phase 06
has real `.liquid` files to render, and define the Shopify-compatibility strategy the browser-side LiquidJS
runtime needs.

## Scope

- The Base Theme directory structure: `layout/`, `sections/`, `snippets/`, `assets/`, `templates/`, `config/`,
  `locales/`, matching
  [`docs/product-spec/02-base-theme-and-section-library.md`](../product-spec/02-base-theme-and-section-library.md)
  §1 and [`docs/product-spec/15-shopify-theme-structure.md`](../product-spec/15-shopify-theme-structure.md).
- A loader that reads these real files (not a copy, not a React reimplementation) for the renderer built in
  Phase 06.
- The Shopify compatibility layer: the runtime objects/filters/tags LiquidJS doesn't provide natively (`shop`,
  `product`, `routes`, `settings`, `localization`, `image_url`, `money`, `t`, `asset_url`, and whatever else the
  actual sections in Phase 08 turn out to need — confirmed, not guessed, per
  [`docs/product-spec/07-liquidjs-vs-shopify-liquid.md`](../product-spec/07-liquidjs-vs-shopify-liquid.md)).
- A small number of sections sufficient to prove the loader and compatibility layer work (the recommended
  starter set — announcement bar, header, product hero, rich text, image/text, footer — reused fully once
  Phase 08 formalizes the Section Library).

## Out of Scope

- Actually rendering anything through LiquidJS — that's Phase 06. This phase only loads and represents the
  theme; it does not execute Liquid.
- The full ~40-60 section catalog, or the production five-artifact section authoring pipeline
  (`contract.json`/`editor.meta.json`/`design-spec.md`/`thumbnail.png`) — Phase 08 owns the Section Library
  properly; this phase only needs enough sections to prove the loader works.
- Inventing Shopify functionality LiquidJS doesn't support natively without confirming the gap first. Per
  [`docs/product-spec/02-base-theme-and-section-library.md`](../product-spec/02-base-theme-and-section-library.md)
  §2.4, this is a controlled choice, not a limitation to work around by guessing: `{% content_for 'blocks' %}`
  has no native LiquidJS support and needs an explicit reason before use (the classic
  `{% for block in section.blocks %}` pattern is the default and needs no shim).

## Architecture

```text
Real Base Theme files (layout/sections/snippets/assets/config/locales)
  |
Base Theme Loader (reads real .liquid files, not a transformed copy)
  |
Shopify Compatibility Layer (stub objects + shimmed filters/tags)
  |
[ready for Phase 06's LiquidJS renderer]
```

Two runtimes exist side by side and must be told apart explicitly wherever this matters: the **real Shopify
runtime** (what the theme runs against in production, after Phase 12 publishes it) and the **prototype LiquidJS
runtime** (what this phase's compatibility layer approximates for preview). The compatibility layer's whole job
is closing the gap between them for exactly the Shopify objects/filters/tags the Base Theme's sections actually
use — not simulating Shopify in general.

## Inputs

The Base Theme's own source files (authored directly as part of this phase and Phase 08, not fetched or
generated).

## Outputs

A loader that can resolve `layout/theme.liquid`, any `sections/{type}.liquid`, and any `snippets/*.liquid` by
path, plus a Shopify compatibility layer (stub context objects + registered filters/tags) ready to hand to
LiquidJS.

## Dependencies

Phase 01 only (a place to run server or client code from). Does not depend on Phase 02/03/04 — the Base Theme
and its runtime can be built and tested in isolation, using a hand-authored fixture context instead of a real
Store Configuration, until Phase 06 wires the two together.

## Implementation Areas

- Base Theme directory scaffolding matching the real Shopify structure exactly (this is not a simplified
  stand-in shape — it is the actual directory shape Phase 12 eventually ships to Shopify's `themeCreate`).
- Template/section/snippet loader with a resolution strategy (file path from a type slug) that Phase 06's
  Section Resolver will call directly.
- Shopify compatibility layer: stub `shop`, `routes`, `settings`, `localization` objects; shimmed `image_url`,
  `money`, `t`, `asset_url` filters (and any others a real section turns out to need — confirm before adding,
  per the process in
  [`docs/product-spec/02-base-theme-and-section-library.md`](../product-spec/02-base-theme-and-section-library.md)
  §5: identify, document, implement the smallest compatible behavior, add a test).
- The starter section set (announcement bar, header, product hero, rich text, image/text, footer), each with an
  embedded `{% schema %}` block.

## Data Contracts

No new persisted entity. The relevant "contract" here is the Base Theme's own file-path convention (a
`SectionInstance.type` maps directly to `sections/{type}.liquid`) — see
[`docs/product-spec/15-shopify-theme-structure.md`](../product-spec/15-shopify-theme-structure.md) for the
authoritative mapping table between Store Configuration and Shopify's theme file structure, which this loader
must be able to satisfy in reverse (type slug → file) now and satisfy forward (Store Configuration → theme
files) once Phase 12 builds the publish-time converter.

## User Flow

None — this phase has no user-facing surface. Its output is consumed entirely by Phase 06.

## Error Handling

- An unresolvable section type (no matching `.liquid` file) is a validation failure, not a silent skip — this
  rule is established here because Phase 06's Section Resolver depends on it, and Phase 09 (AI) later depends
  on the same rule to guarantee AI can never reference a nonexistent section type.
- A Shopify object/filter/tag genuinely missing from the compatibility layer must fail loudly during
  development (a thrown error, caught by a test), never silently produce garbage output — see Phase 06's Error
  Handling for the specific silent-failure risk this guards against.

## Testing

- A loader test per starter section: the file resolves, parses as valid Liquid syntax (schema block
  extractable), and the embedded `{% schema %}` is well-formed JSON.
- A compatibility-layer unit test per shimmed filter/object, confirming it produces the expected output for a
  representative real usage (not just that it doesn't throw).
- A test enumerating every Shopify construct the starter sections actually use, cross-checked against the
  compatibility layer, so an unshimmed dependency is caught here rather than discovered as broken output in
  Phase 06.

## Completion Criteria

- The Base Theme directory exists in the real Shopify structure, containing the starter section set.
- The loader resolves every starter section and the layout by path.
- The compatibility layer covers every Shopify object/filter/tag the starter sections actually use, each with a
  passing test.
- No section in this phase silently depends on an unshimmed Shopify construct.

## Next Phase

[06 — LiquidJS Preview](06-liquidjs-preview.md) takes this phase's loader and compatibility layer, combines
them with a Store Configuration from Phase 04, and produces the first rendered HTML.
