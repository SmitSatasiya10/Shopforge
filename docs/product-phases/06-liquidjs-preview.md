# Phase 06 — LiquidJS Preview

This is one of the most important phases in the roadmap — it's the phase that proves the architecture's central
bet: that a real Shopify Liquid template, executed client-side through LiquidJS, can stand in for a live
storefront preview without React reimplementing anything.

## Objective

Render a Store Configuration (Phase 04) through the real Base Theme (Phase 05) into HTML, and display it inside
a same-origin sandboxed iframe.

## Scope

- The complete rendering pipeline: Store Configuration → Template Resolver → Section Resolver → Liquid Template
  → LiquidJS `render()` → HTML → preview iframe, matching
  [`docs/product-spec/06-preview-architecture.md`](../product-spec/06-preview-architecture.md).
- Context construction per render: `section` (id/settings/blocks), hydrated `product` (from a `ProductRef` in
  settings, resolved against Phase 03's normalized data), stubbed `shop`/`routes`/`settings`/`localization`
  (Phase 05's compatibility layer).
- Complete-page rendering: layout → header → announcement → product sections → footer as one coherent page, not
  isolated section fragments (per `prototype-phase-plan.md` §14's milestone requirement, restated here as this
  phase's own bar).
- The same-origin iframe itself: `sandbox="allow-same-origin"` and nothing else, set once at creation, never
  mutated — a binding decision
  ([`docs/product-spec/DECISIONS.md`](../product-spec/DECISIONS.md) #8), not a style choice. `allow-scripts`
  must never be added.
- Rerender strategy: always a fresh `render()` on every Store Configuration change, never a DOM patch.
- CSS and asset URL resolution so the rendered page actually looks like a storefront, not unstyled markup.

## Out of Scope

- Section selection, click-to-edit, settings panel, `contentEditable` — all Phase 07. This phase proves
  rendering, not editing.
- Server-side rendering for share links/thumbnails — a separately-settled concern per
  [`docs/product-spec/06-preview-architecture.md`](../product-spec/06-preview-architecture.md), out of scope
  for the live-editing preview this phase builds.
- Any React reimplementation of storefront markup, at all, under any circumstance — the single hardest
  constraint in this entire roadmap
  ([`docs/product-spec/DECISIONS.md`](../product-spec/DECISIONS.md) #6, #7).

## Architecture

```text
Store Configuration (04)
  |
Template Resolver / Section Resolver  (Phase 05's loader, by type -> file path)
  |
Liquid Template (real .liquid file, unmodified)
  |
Context construction (section settings + hydrated product + Shopify compatibility stubs)
  |
LiquidJS render()
  |
HTML string
  |
Preview iframe (sandbox="allow-same-origin", srcdoc)
  |
Browser renders HTML + CSS
```

`PreviewRuntime` conceptual boundary (names may follow repo convention, structure should not change):
`TemplateLoader`, `SectionResolver`, `SnippetResolver`, `AssetResolver`, `ShopifyContext`, `LiquidRenderer`.

## Inputs

A Store Configuration (Phase 04) and the Base Theme + compatibility layer (Phase 05).

## Outputs

A complete rendered HTML page, displayed inside a same-origin sandboxed iframe, visually matching what the Base
Theme's sections are designed to produce.

## Dependencies

Phase 04 (a configuration to render) and Phase 05 (a theme + compatibility layer to render it through).

## Implementation Areas

- `TemplateLoader`: resolves and caches `.liquid` source (layout, sections, snippets) — cached client-side
  since the templates themselves don't change between renders, only the configuration/context does.
- `SectionResolver`: `SectionInstance.type` → Section Library entry → template path, reusing Phase 05's loader;
  unresolved type is a validation failure (established in Phase 05, enforced here).
- `ShopifyContext`: builds the exact per-render context object, including the product-hydration step (any
  `ProductRef` in settings resolved to a full product object from Phase 03's normalized/cached import data).
- `LiquidRenderer`: configures the LiquidJS engine (compatibility filters registered per Phase 05), renders
  layout + every section in `configuration.pages.product.sections` order, assembles one complete HTML document.
- The preview iframe component: sandbox attribute set exactly once at creation; content updated via a fresh
  document write on every rerender, never DOM-patched.
- CSS delivery: the Base Theme's own `assets/*.css`, loaded into the iframe; the Base Theme's JavaScript is
  never loaded into the iframe (no script artifact exists per section by design — see Phase 07 for why
  `contentEditable`, not injected JS, drives in-preview interaction).

## Data Contracts

```text
RenderContext {
  section: { id: string, settings: object, blocks: object[] }
  product: NormalizedProduct | null   // hydrated from a ProductRef, or null if the section has none
  shop: { name: string, ... }         // stubbed
  routes: { root_url: string, ... }   // stubbed
  settings: object                    // theme-wide, stubbed
  localization: object                // stubbed
}
```

No new persisted entity — this phase is pure transformation (Store Configuration + Base Theme → HTML), nothing
here is written back to the database.

## User Flow

```text
User has a Store Configuration (from Phase 02-04's flow)
  |
Preview loads automatically
  |
Complete storefront page appears inside the iframe
```

No interaction yet — the milestone for this phase is a correct, complete, static-from-the-user's-perspective
render. Interaction is Phase 07.

## Error Handling

**The specific, documented risk to design against**: LiquidJS does not throw on a missing filter or an
unresolved object reference — it silently renders garbage (`[object Object]`, or the literal unresolved
`{{ ... }}` text) instead, per
[`docs/product-spec/07-liquidjs-vs-shopify-liquid.md`](../product-spec/07-liquidjs-vs-shopify-liquid.md)'s
confirmed spike finding. Error-driven testing alone will miss this — every section's render output must be
asserted against directly (no literal `[object Object]`, no unresolved `{{ }}`/`{% %}` text in the output), not
just checked for "did it throw." This is one of the non-negotiable release gates carried into Phase 13.

Beyond that specific risk:
- A missing/unresolvable section type is a hard validation failure surfaced clearly, not a blank gap in the
  page.
- A product-hydration failure (e.g., a `ProductRef` pointing at data that no longer exists) must degrade to a
  graceful empty/placeholder state in the affected section, not fail the whole-page render.
- Missing product fields (price, image, variants) must render a graceful fallback per section, not break
  rendering — the same missing-data tolerance Phase 03 established for normalization carries through to
  rendering.

## Testing

- A render test per section type asserting on real output content, not just "no exception thrown" — directly
  checking for the silent-failure garbage pattern above.
- A complete-page render test: layout + full starter section set together, asserting a coherent single HTML
  document.
- A missing-data render test: a sparse/partial normalized product (Phase 03's partial-import case) still
  produces a valid, gracefully-degraded render.
- A rerender test: two different Store Configurations for the same product produce visibly different output,
  proving the "always a fresh render" rule actually reflects configuration changes.
- Confirm the rendered iframe's `sandbox` attribute is exactly `allow-same-origin` in the actual DOM, not just
  in source — this exact check is also part of Phase 13's non-negotiable security gate.
- The structural (DOM) parity comparison against a real Shopify dev-store render, per
  [`docs/product-spec/16-preview-shopify-parity.md`](../product-spec/16-preview-shopify-parity.md), should
  start here, on the first section, not be deferred to Phase 13 — parity coverage is meant to accumulate
  section by section as Phase 08 grows the catalog.

## Completion Criteria

- A real imported product's Store Configuration renders as one complete, coherent storefront page (layout,
  header, announcement, product sections, footer) inside the iframe.
- No section's render output contains silent-failure garbage.
- The iframe's sandbox attribute is exactly `allow-same-origin`, verified in the rendered DOM.
- A configuration change produces a visibly different rerender.
- Structural parity comparison is wired up and passing for the starter section set.

## Next Phase

[07 — Preview Editor](07-preview-editor.md) adds interaction on top of this phase's static render: selection,
settings editing, and content editing, all still funneling back through the same Store Configuration → rerender
loop this phase established.
