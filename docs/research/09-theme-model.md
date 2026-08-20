# 09 — Preview Rendering & Interaction Architecture

## 1. What the Preview Is (and Isn't)

State this plainly up front, because it's the load-bearing decision this whole document exists to specify: **the preview is not React rendering the storefront.** It is **LiquidJS rendering our actual Liquid Section templates into an HTML string, written into a same-origin iframe.**

This is intentional, and it's intentional for one reason above all others: **preview/production parity.** LiquidJS renders the exact same `.liquid` files (doc 07 §2) that Shopify's own Liquid engine will run at publish time, fed the exact same `settings`/`blocks` values from the exact same `StoreConfiguration` (doc 08). There is no second implementation of a Hero section's markup living in React, no hand-maintained visual approximation that can drift from what actually ships. If a Section's Liquid changes, the preview changes with it automatically, because there's only one place that Liquid lives.

This document specifies, precisely enough for the editor/frontend teams (doc 06, doc 19) to build against: the LiquidJS rendering pipeline, why every plausible alternative was ruled out, the division of labor between React and LiquidJS, why the iframe is same-origin, how click-to-select and `contentEditable` work, the full edit-to-preview loop, and the bounded, honest scope of "parity" this approach actually buys.

---

## 2. The LiquidJS Rendering Pipeline

### 2.1 Pipeline steps

| Step | What happens |
|---|---|
| 1 | **Store Configuration** (doc 08) holds the current page's `sections[]`, each a `SectionInstance` with a `type` and `settings`/`blocks`. |
| 2 | **Preview Renderer** iterates the page's `sections[]` in array order (doc 08 §2.2 — array order is render order). |
| 3 | For each instance, **resolve `type`** against the Section Library catalog (doc 07 §3) to find its Liquid template path. |
| 4 | **Load that Section's Liquid template** (`sections/{type}.liquid`, doc 07 §4) — fetched once and cached client-side; not re-fetched per render. |
| 5 | **Build the render context** for that instance: inject `settings`/`blocks` (doc 08 §2.3/§2.4) as `section.settings.*` / `section.blocks[]`, matching Shopify's own Liquid object shape exactly, plus stubbed Shopify runtime globals (§2.3). |
| 6 | **LiquidJS `render()`** the template against that context, producing an HTML string for that one Section. |
| 7 | Concatenate every Section's rendered HTML (plus the base theme's shared layout chrome — `<head>`, global CSS, `<body>` wrapper) into one full-page HTML string. |
| 8 | **Write the HTML string into the same-origin iframe** (§5) — via `iframe.srcdoc` or an equivalent same-origin document write. |
| 9 | The browser renders it like any other HTML document — real CSS cascade, real layout, real interactivity for anything that doesn't require a live Shopify backend. |

### 2.2 Worked example: `hero`

```
SectionInstance:
  type: "hero"
  settings: { heading: "Everyday Carry, Elevated", subheading: "...", image: {...}, cta_label: "Shop the Collection" }
        |
        v
Resolve "hero" -> sections/hero.liquid  (doc 07 §3.2)
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

The `data-sf-*` attributes are what make click-to-select and `contentEditable` possible (§6) — they are emitted by the Section's own Liquid template, per doc 07 §10's authoring obligation, not injected by the Preview Renderer after the fact.

### 2.3 Preview Runtime Context: stubbing Shopify's own Liquid objects

Section Liquid legitimately references Shopify-provided runtime objects that don't exist outside a real Shopify request — `shop`, `cart`, `routes`, `settings` (theme-wide), `localization`, and similar. The Preview Renderer supplies a **stubbed runtime context** for these: representative-but-fake values (a `shop` object with the store's real name/domain, an empty `cart`, `routes` pointing at plausible-looking paths) good enough for layout and content to render correctly, without a live Shopify backend behind them. This stub context is maintained alongside the Section Library, since which globals a Liquid template might reference is a Section-authoring concern (doc 07), and is the first, most direct source of the parity gaps documented in §9.

### 2.4 Product data resolution

Sections that reference a `ProductRef` (doc 08 §2.8) — `product-grid`, `featured-product`, `product-information`, `product-gallery`, and similar — need hydrated product data (title, price, images, variants) to render meaningfully, not just a `productId`/`handle`. Before step 5 above, the Preview Renderer resolves every `ProductRef` an instance's settings contain into a full product object, sourced from the cached Product Import/Scraper data (pre-publish) or a live Shopify product lookup (post-publish). This resolution step is what lets `product-grid` render real-looking product cards in preview before the store has ever touched Shopify's Admin API.

### 2.5 Where LiquidJS runs

LiquidJS executes **client-side, in the browser**, inside the builder application — not server-side per edit. Section Liquid source and the stub runtime context (§2.3) are fetched once (or served from a short-TTL cache) rather than re-fetched on every keystroke. This is what makes the edit → preview loop (§8) feel instant: a settings change re-renders entirely in-browser, with no network round trip to a server or to Shopify.

---

## 3. Explicitly Ruled Out Alternatives

| Alternative | Why it was rejected |
|---|---|
| **Screenshot / static image** | Not interactive — no click-to-select, no `contentEditable`, no responsive viewport simulation. A screenshot is also stale the instant a setting changes; it would require a server round-trip per edit to regenerate, defeating the instant-feedback goal (§8). |
| **Static mockup (design-tool-style rendering)** | Same interactivity problem as a screenshot, plus it's a second, hand-maintained visual representation of every Section — the exact drift risk this architecture exists to avoid (§1). |
| **React recreation of the storefront** | Would require re-implementing every Section's markup/behavior twice: once in Liquid (for production) and once in React (for preview) — any divergence between the two silently breaks preview/production parity, and every future Section addition doubles the implementation cost. This is the single most important alternative ruled out, since it's the most tempting one to reach for as a "modern frontend" default. |
| **Shopify API round-trip per edit** | Pushing every edit to a real (draft) Shopify theme and re-fetching a rendered page per keystroke would be accurate but far too slow for interactive editing, would require every store to have a live Shopify connection before a single preview could render, and would burn API rate limits on every field edit rather than on publish. |

---

## 4. Role of React vs. LiquidJS

React (via Next.js) owns the **builder application chrome only**: toolbar, sidebar, section navigator, AI chat panel, inspector (settings form for the selected instance), editor controls (undo/redo, device-size toggle, publish button), and the iframe **host element** itself. React never renders storefront markup, never re-implements a Section's visual output, and never reaches inside the iframe's document to render anything — its job stops at owning the `<iframe>` tag and reacting to messages/events that cross the iframe boundary (§6).

LiquidJS owns **all storefront rendering**, exclusively inside the iframe, as specified in §2. This split is deliberate and total: if a pixel is part of "what the store looks like," it came from LiquidJS rendering a real Section template; if a pixel is part of "the tool used to build the store," it came from React.

---

## 5. The Same-Origin Iframe

The preview iframe is **same-origin** with the builder application — not a separate remote website, not a sandboxed `srcdoc` with a different effective origin, not an embed of any external URL. This is a deliberate choice, made for one reason: **same-origin is what lets the editor's React chrome reach into the iframe's DOM** to attach hover/click listeners, read computed styles, and detect selected elements (§6). A cross-origin iframe would block exactly the DOM access this entire interaction model depends on.

The iframe is responsible for:

- **Isolating storefront CSS from editor UI CSS** — the base theme's stylesheet applies only inside the iframe's document, so a Section's styles can never leak out and corrupt the builder chrome's own styling, and vice versa.
- **Rendering independently of the host page's layout** — its own scroll, its own viewport-relative units, so responsive viewport simulation (§5.1) behaves like a real browser viewport, not a scaled `<div>`.
- **Supporting click-to-select and hover detection** (§6) via same-origin DOM access from the host React app.
- **Supporting in-preview editing** via `contentEditable` (§7) on eligible elements.
- **Accurately reflecting storefront styling** — because it's rendering the real Liquid + real base-theme CSS, not an approximation.

### 5.1 Responsive viewport simulation

Device-size toggling (desktop/tablet/mobile) in the editor resizes the iframe element itself (its CSS width/height, or an actual `<iframe>` `width`/`height` change) rather than swapping rendered content — the same HTML string renders at whatever viewport width the iframe currently occupies, exercising the base theme's real responsive CSS. `Visibility` settings (doc 08 §2.6) are applied by the Preview Renderer choosing whether to render a given instance at all for a simulated breakpoint, consistent with how the same flags drive production visibility at publish time.

To be explicit about what the iframe is **not**: it is not a separate remote website loaded via `<iframe src="https://...">` pointing at some hosted storefront URL. It is part of the builder's own preview system, its content generated entirely client-side from the current `StoreConfiguration` by the same LiquidJS pipeline described in §2, and it exists only within an active editor session.

---

## 6. Click-to-Select Editor Interaction

### 6.1 Interaction flow

```
hover over rendered element
        |
        v
outline drawn around the nearest data-sf-* ancestor (visual affordance only, editor chrome, drawn by React
  reading the hovered element's bounding box via same-origin DOM access)
        |
        v
click
        |
        v
select — walk up from the clicked element to the nearest ancestor carrying data-sf-setting (field-level),
  else data-sf-block-id (block-level), else data-sf-section-id (section-level)
        |
        v
map to Page -> Section id -> Block id -> Setting id
        |
        v
Inspector (doc 06) opens scoped to exactly that target
```

### 6.2 DOM metadata strategy

The mapping from a clicked DOM node back to a precise `StoreConfiguration` path is made possible by `data-sf-*` attributes that Section Liquid templates emit themselves (doc 07 §10 — this is a Section-authoring obligation, reviewed like any other part of a Section). The full attribute contract:

| Attribute | Where it's emitted | Purpose |
|---|---|---|
| `data-sf-page` | Root wrapper of the rendered page (once per page) | Identifies which `pages.{key}` the click occurred within. |
| `data-sf-section-id` | Root element of each rendered Section instance | Maps to `SectionInstance.id` (doc 08 §2.3). |
| `data-sf-section-type` | Same element as `data-sf-section-id` | Maps to `SectionInstance.type` — lets the editor know which contract/inspector layout to use without a lookup. |
| `data-sf-block-id` | Root element of each rendered block instance (e.g. each testimonial card, each FAQ item) | Maps to `BlockInstance.id` (doc 08 §2.4). |
| `data-sf-setting` | The specific DOM node rendering one editable field's value | Maps to a `SettingDef.id` — this is the field-level click target. |
| `data-sf-editable` | Same element as `data-sf-setting` | One of `"text" \| "richtext" \| "image" \| "none"` — tells the editor which in-preview interaction applies (§7) if any. |

Resolution walks **up** the DOM tree from the clicked node, taking the nearest match at each level — a click directly on a heading resolves to that heading's `data-sf-setting` (field-level, opens the Inspector pre-scrolled to that field); a click on section whitespace with no `data-sf-setting` ancestor resolves only to `data-sf-section-id` (section-level, opens the Inspector's general tab for that instance).

### 6.3 Open questions flagged for doc 26

The following are genuinely undecided and are flagged, not designed, here:

- **Overlapping/ambiguous click targets** — a block nested inside another block-like structure, or a setting rendered inside a loop where the same `data-sf-setting` value legitimately appears more than once in the DOM (e.g. a price shown both in a gallery thumbnail overlay and in the main info panel) needs a precise disambiguation rule beyond "nearest ancestor."
- **Keyboard/accessibility path for selection** — the hover/click flow above is mouse-first; an equivalent keyboard-navigable selection path is undesigned.
- **Selection behavior during an active `contentEditable` edit** — whether clicking a different element mid-edit should auto-commit, prompt, or discard is undecided (§7 states the write-back principle but not this specific UX rule).

---

## 7. `contentEditable` and the Single Source of Truth Principle

For appropriate text-shaped fields (`data-sf-editable="text"` or `"richtext"`), the editor supports direct in-preview editing via the browser's native `contentEditable`, rather than requiring every text change to go through the Inspector sidebar. This is purely an interaction convenience.

**The governing principle: `contentEditable` is only an editor *interaction mechanism*. It is never the source of truth, and raw DOM mutations are never persisted directly.** Concretely:

1. The user clicks into a `data-sf-editable="text"` element and types — the browser's native contentEditable behavior handles the in-place text mutation, entirely within the iframe's DOM.
2. On blur (or an explicit commit action), the editor **reads the current text content back out** of that DOM node — not the raw DOM tree, just the resulting string.
3. That string is written into `StoreConfiguration` at the path resolved by that element's `data-sf-setting` (§6.2) — e.g. `pages.home.sections[].settings.heading` — via the same settings-update path any other editor field edit uses (doc 08 §5, "Visual Editor" row).
4. This triggers a LiquidJS rerender (§8) — including of the very element just edited — which means the "final" rendered text the user sees after commit came from a fresh render off the updated `StoreConfiguration`, not from the raw DOM mutation the browser applied during typing.

This matters because it keeps exactly one source of truth (`StoreConfiguration`) even though the interaction momentarily lets the DOM diverge from it while the user is mid-edit — the DOM is never trusted as storage, only as a transient editing surface that gets reconciled back into the real data model on every commit.

---

## 8. The Editor → Configuration → Preview Loop

```
user edits a field (Inspector or in-preview contentEditable)
        |
        v
StoreConfiguration update  (doc 08 — a new settings value at a specific path)
        |
        v
LiquidJS rerender  (§2 — the affected Section(s) only, or the full page; either is a fresh render off
                     the current StoreConfiguration, never a DOM patch)
        |
        v
iframe content updated  (new HTML string written in)
```

**Worked example — hero heading text change:**

Before:
```json
{ "id": "sec_a1", "type": "hero", "settings": { "heading": "Everyday Carry, Elevated", ... } }
```
Rendered: `<h1 data-sf-setting="heading" data-sf-editable="text">Everyday Carry, Elevated</h1>`

User edits the heading in-preview to "Carry Less. Carry Better." → committed per §7's read-back flow →

After:
```json
{ "id": "sec_a1", "type": "hero", "settings": { "heading": "Carry Less. Carry Better.", ... } }
```
Rerendered: `<h1 data-sf-setting="heading" data-sf-editable="text">Carry Less. Carry Better.</h1>`

**This loop never touches Shopify.** The preview updates immediately, entirely client-side, off the in-memory/session `StoreConfiguration` — no publish, no Admin API call, no live theme write happens as part of ordinary editing. Shopify only enters the picture at explicit publish (doc 16).

---

## 9. Preview Parity: A Bounded Goal

Because the LiquidJS preview and Shopify's production Liquid engine render the **literal same Section templates** off the **literal same settings values**, parity for our controlled, first-party Sections is expected to be close. This is a real, structural advantage over any React-recreation approach (§3) — but it is a **bounded goal, not a guarantee of automatic 100% parity.** The following are concrete places parity can still break, and are things to be documented and tested case by case, not solved by this document:

| Parity risk | Why it can diverge |
|---|---|
| **Shopify-specific runtime objects** (`cart`, `routes`, `customer`, real `localization`) | The Preview Renderer uses a stubbed context (§2.3); a Section that behaves differently against a populated real cart (e.g. quantity-dependent messaging) than against the stub won't be caught in preview. |
| **Shopify-only Liquid behavior/tags** | Filters or tags with server-side-only semantics (e.g. money formatting tied to the shop's actual currency/locale settings, `{% recommendations %}`) may render differently between LiquidJS's implementation and Shopify's own engine's edge cases. |
| **App extensions / third-party apps** | Any merchant-installed Shopify app that injects script tags, app blocks, or checkout/cart extensions has no equivalent in the preview environment — it simply isn't there. |
| **Real inventory / cart state** | Preview cannot reflect actual stock levels, real cart contents, or live pricing/discount logic that depends on a live Shopify session. |
| **Shopify-specific APIs** | Any Section behavior driven by a live Storefront/Admin API call at runtime (as opposed to data resolved ahead of render, §2.4) has no live backend to call against in preview. |
| **Browser/runtime differences** | LiquidJS is a JavaScript reimplementation of Shopify's Ruby-based Liquid engine — edge-case filter/tag behavior differences between the two implementations are possible and need to be caught by testing, not assumed away. |

The product commitment here is: parity is strong *for the things this architecture structurally guarantees* (markup, settings-driven content, layout, styling) and explicitly weaker for anything that depends on a live Shopify runtime. Each row above is a testing/documentation obligation for the Section Library and QA process (doc 21), not a gap this document resolves.

---

## 10. Future / Advanced Architecture

Everything in this document assumes the Preview Renderer only ever needs to load Liquid from our own, known, fixed Section Library (doc 07). **If arbitrary-theme support is ever built** (doc 07 §11's cancelled-but-preserved direction), this same LiquidJS approach would, in principle, still be the right rendering strategy — but it would need to render *unknown* section Liquid pulled from an arbitrary merchant theme, rather than our controlled catalog.

That is flagged here as a much harder, currently unsolved problem, not designed: unknown Liquid can reference snippets, assets, and settings shapes this document has no visibility into; the `data-sf-*` DOM metadata contract (§6.2) that click-to-select depends on has no equivalent in a theme we didn't author, since we can't require an arbitrary theme's Sections to emit our attributes; and the stubbed runtime context (§2.3) would need to cover a much wider, unpredictable surface of Liquid patterns instead of the ones our own ~50 Sections actually use. None of this is designed here — it's noted so that if arbitrary-theme import is revived, this document's core rendering strategy (LiquidJS, same-origin iframe, settings-driven rerender) is understood as the likely starting point, not something to reinvent from scratch.
