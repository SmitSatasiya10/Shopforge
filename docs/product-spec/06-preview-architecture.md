# Preview Architecture

## 1. What the Preview Is

The preview is **not** a React recreation of the storefront. It is **LiquidJS rendering the real, production
`.liquid` Section templates** from the [Base Theme and Section Library](02-base-theme-and-section-library.md)
into an HTML string, which is written into a [same-origin iframe](08-preview-iframe.md).

There is exactly one implementation of a Section's markup — the Liquid template. LiquidJS renders it for the
preview; Shopify's own Liquid engine renders it for the real storefront (see
[LiquidJS vs. Shopify Liquid](07-liquidjs-vs-shopify-liquid.md)). Nothing about a Section's visual output is
hand-maintained twice. If a Section's Liquid changes, the preview changes with it automatically.

React/Next.js is the builder application's UI shell only — toolbar, sidebar, inspector, AI panel, and the
element that hosts the iframe (see [Visual Editor](09-visual-editor.md)). React never renders storefront
markup and never re-implements a Section's visual output.

## 2. The Rendering Pipeline

```
Store Configuration
        |
Section Resolver / Registry
        |
Liquid Template
        |
Inject Settings / Context
        |
LiquidJS
        |
HTML
        |
Same-Origin iframe
        |
Browser-rendered Store Preview
```

### 2.1 Pipeline steps

| Step | Stage | What happens |
|---|---|---|
| 1 | **Store Configuration** | The current page's `sections[]` array (each a `SectionInstance` with `id`, `type`, `settings`, `blocks`) is read from the [Store Configuration](03-store-configuration.md). Array order is render order. |
| 2 | **Section Resolver / Registry** | For each `SectionInstance`, its `type` is resolved against the Section Library catalog (`SectionDefinition`) to find the matching Liquid template path (`sections/{type}.liquid`). |
| 3 | **Liquid Template** | The resolved Section's Liquid source is loaded — fetched once and cached client-side, not re-fetched per render. |
| 4 | **Inject Settings / Context** | The render context for that instance is built: `settings`/`blocks` are injected as `section.settings.*` / `section.blocks[]`, matching Shopify's own Liquid object shape exactly (§4), plus the stubbed Shopify runtime context (§5). |
| 5 | **LiquidJS** | LiquidJS `render()`s the template against that context, producing an HTML string for that one Section. |
| 6 | **HTML** | Every Section's rendered HTML is concatenated, together with the Base Theme's shared layout chrome (`<head>`, global CSS, `<body>` wrapper — §7), into one full-page HTML string. |
| 7 | **Same-Origin iframe** | The HTML string is written into the [same-origin iframe](08-preview-iframe.md) — via `iframe.srcdoc` or an equivalent same-origin document write. |
| 8 | **Browser-rendered Store Preview** | The browser renders the written document like any other HTML document: real CSS cascade, real layout, real interactivity for anything that doesn't require a live Shopify backend. |

### 2.2 Worked example — `hero`

```
SectionInstance:
  type: "hero"
  settings: { heading: "Everyday Carry, Elevated", subheading: "...", image: {...}, cta_label: "Shop the Collection" }
        |
        v
Section Resolver: "hero" -> sections/hero.liquid
        |
        v
LiquidJS render(heroLiquidSource, { section: { settings: {...}, blocks: [] }, shop, cart, routes, ... })
        |
        v
"<section class=\"hero\" data-sf-section-id=\"sec_a1\" data-sf-section-type=\"hero\">
   <h1 data-sf-setting=\"heading\" data-sf-editable=\"text\">Everyday Carry, Elevated</h1>
   <p data-sf-setting=\"subheading\" data-sf-editable=\"richtext\">...</p>
   <a data-sf-setting=\"cta_label\" href=\"/collections/all\">Shop the Collection</a>
 </section>"
        |
        v
Written into the iframe's document -> browser renders it as real HTML
```

The `data-sf-*` attributes are emitted by the Section's own Liquid template as part of its authoring contract,
not injected by the Preview Renderer after the fact. See
[DOM Metadata and Selection](10-dom-metadata-and-selection.md) for the full attribute contract and how they
drive click-to-select.

## 3. LiquidJS's Responsibility

LiquidJS owns exactly one job in this architecture: given a Liquid template string and a render context, produce
an HTML string. It does not:

- Decide which Section to render (the Section Resolver does).
- Decide what settings/content go into a Section (the Store Configuration does).
- Own any part of the builder application's own UI (React does).

Everything that is "what the store looks like" is a pixel LiquidJS produced by rendering a real Section
template. Everything that is "the tool used to build the store" is owned by React.

## 4. Template and Section Resolution

Each `SectionInstance.type` in the Store Configuration maps 1:1 to a `SectionDefinition` in the Section Library
catalog. Resolution is a direct lookup — `type` string to catalog entry to `sections/{type}.liquid` path — not
a search or a fuzzy match. An instance whose `type` does not resolve to a known `SectionDefinition` is a
validation failure (see [Validation and Error Handling](17-validation-and-error-handling.md)), not a silent
skip.

Section Liquid source is fetched once per session (or served from a short-TTL client-side cache) rather than
re-fetched on every render, since the Section Library is fixed and known ahead of time — see
[Base Theme and Section Library](02-base-theme-and-section-library.md).

## 5. Settings and Context Injection

For each `SectionInstance`, the render context passed into LiquidJS is:

```
{
  section: {
    id: <SectionInstance.id>,
    settings: <SectionInstance.settings>,
    blocks: <SectionInstance.blocks[]>
  },
  shop: <stubbed>,
  cart: <stubbed>,
  routes: <stubbed>,
  settings: <theme-wide settings, stubbed>,
  localization: <stubbed>,
  ...
}
```

`section.settings` and `section.blocks` are injected exactly as they exist in the Store Configuration, matching
Shopify's own Liquid object shape so the same template renders correctly in both environments — see the
[Shared Section Contract](12-shared-section-contract.md).

### 5.1 Product data resolution

Sections that reference a `ProductRef` in their settings (`product-grid`, `featured-product`,
`product-information`, `product-gallery`, and similar) need hydrated product data — title, price, images,
variants — not just a `productId`/`handle`, to render meaningfully. Before context injection (step 4 of the
pipeline), the Preview Renderer resolves every `ProductRef` an instance's settings contain into a full product
object, sourced from:

- Cached Product Import/Scraper data (pre-publish), or
- A live Shopify product lookup (post-publish).

This resolution step is what lets a Section like `product-grid` render real-looking product cards in preview
before the store has ever touched the Shopify Admin API. See [Product Import](05-product-import.md).

## 6. Shopify Object / Context Mocks (Stubbing Strategy)

Section Liquid legitimately references Shopify-provided runtime objects that don't exist outside a real Shopify
request — `shop`, `cart`, `routes`, theme-wide `settings`, `localization`, and similar. The Preview Renderer
supplies a **stubbed runtime context** for these:

| Object | Stub strategy |
|---|---|
| `shop` | Populated with the store's real, known values (name, domain) where available; everything else representative-but-fake. |
| `cart` | An empty cart object — correct shape, no real line items. |
| `routes` | Plausible-looking paths (e.g. `/cart`, `/collections/all`) that are structurally correct but not backed by a live storefront. |
| `settings` (theme-wide) | Sourced from the theme-wide portion of the Store Configuration where defined; otherwise representative defaults. |
| `localization` | A representative default locale/currency, not the merchant's actual live localization setup. |

These stubs are good enough for layout and content to render correctly without a live Shopify backend behind
them. The stub context is maintained alongside the Section Library, since which globals a given Section's
Liquid might reference is a Section-authoring concern. This stub context is the first, most direct source of the
parity gaps described in [LiquidJS vs. Shopify Liquid](07-liquidjs-vs-shopify-liquid.md).

## 7. Snippets, Includes, and Layout

Section Liquid may reference shared snippets (`{% render %}` / `{% include %}`) — these resolve against the
same Base Theme `snippets/` directory the production theme uses, loaded through the same client-side fetch/cache
strategy as Section templates (§4). There is no separate preview-only snippet set.

The Base Theme's shared layout chrome — `<head>` contents, globally-loaded CSS, the `<body>` wrapper each
Section is rendered into — is applied once around the concatenated Section HTML (pipeline step 6, §2.1), the
same layout structure the production theme uses at publish time.

## 8. CSS Loading and Asset Resolution

The iframe loads the Base Theme's real stylesheet(s), so Sections render with their actual production styling,
not an approximation — see [Preview iframe](08-preview-iframe.md) for isolation details. Image and other static
assets referenced by a Section's settings (product images, uploaded/generated images) resolve to the same asset
URLs the published store will use; see [Assets](13-assets.md) for the asset lifecycle and storage strategy.

**Final storage provider for assets: TBD.** Not to be invented here — see [Assets](13-assets.md).

## 9. Error Handling

A render failure at any pipeline step (unresolvable `type`, a Liquid syntax/runtime error, a missing referenced
snippet) must not silently blank the entire preview. The affected Section's render failure is scoped and
surfaced distinctly from a healthy render of the surrounding Sections, consistent with how validation failures
are surfaced elsewhere in the product (see [Validation and Error Handling](17-validation-and-error-handling.md)).
Exact error-surface UX (inline placeholder vs. banner vs. Inspector-level messaging) is owned by
[Visual Editor](09-visual-editor.md), not by this document.

## 10. Rerendering and the Edit Loop

```
user edits a field (Inspector or in-preview contentEditable)
        |
        v
Store Configuration update  (a new settings value at a specific path)
        |
        v
LiquidJS rerender  (the affected Section(s), or the full page — either is a fresh render off the
                     current Store Configuration, never a DOM patch)
        |
        v
iframe content updated  (new HTML string written in)
```

Every rerender is a fresh `render()` off the current Store Configuration — the DOM is never patched in place by
the Preview Renderer itself. (Native browser `contentEditable` does momentarily mutate the DOM during typing,
but that mutation is read back into the Store Configuration on commit and then superseded by a real rerender —
see [contentEditable](11-contenteditable.md).) This loop never touches Shopify: no publish, no Admin API call,
no live theme write happens as part of ordinary editing. Shopify only enters the picture at explicit
[Publish](14-shopify-publishing.md).

## 11. Caching and Performance

To keep the edit-to-preview loop feeling instant:

- Section Liquid source and the stub runtime context (§6) are fetched once per session (or served from a
  short-TTL cache), not re-fetched on every keystroke or every rerender.
- A settings change re-renders only the affected Section(s) where possible, rather than unconditionally
  re-rendering every Section on the page.
- Rendering happens without a network round trip to a server or to Shopify for ordinary editing — see
  [LiquidJS vs. Shopify Liquid](07-liquidjs-vs-shopify-liquid.md) for the current TBD on exactly where LiquidJS
  execution is placed during a live editing session.

A separate, settled use case — rendering a single Section as a server-rendered fragment for share-link or
thumbnail generation — is out of scope for this document; see [Product Import](05-product-import.md) and
[Assets](13-assets.md) for adjacent asset-generation flows.

## 12. Responsive Viewport Behavior

Device-size toggling (desktop/tablet/mobile) in the editor resizes the iframe element itself (CSS width/height,
or the `<iframe>`'s `width`/`height` attributes) rather than swapping rendered content — the same HTML string
renders at whatever viewport width the iframe currently occupies, exercising the Base Theme's real responsive
CSS rather than a scaled approximation.

Visibility settings on a `SectionInstance` (per-breakpoint show/hide) are applied by the Preview Renderer
choosing whether to render a given instance at all for the simulated breakpoint — consistent with how the same
flags drive production visibility at publish time. See [Store Configuration](03-store-configuration.md).

## 13. Preview URL and Asset Strategy

The preview is not a hosted URL pointing at a deployed storefront. It is generated entirely client-side, from
the current in-memory/session Store Configuration, by the pipeline in §2, and exists only within an active
`PreviewSession`. There is no `iframe src="https://..."` pointing at any external or intermediate hosted page.
Image and other asset URLs referenced inside the rendered HTML resolve independently of the preview HTML itself
— see §8 and [Assets](13-assets.md).

## 14. Open Questions / TBD

- **Client-side vs. server-side LiquidJS execution for live editing.** A per-section server-rendered fragment
  is settled for share-link/thumbnail rendering only. Where LiquidJS executes during an active live-editing
  session is unresolved. See [LiquidJS vs. Shopify Liquid](07-liquidjs-vs-shopify-liquid.md) for the full
  statement of this TBD.
- **Final storage provider for assets** — not to be invented here. See [Assets](13-assets.md).
