# Preview iframe

The same-origin iframe that hosts the rendered storefront preview inside the builder application: why it is
same-origin, what isolates it from the builder's own UI, how the builder application and the iframe communicate,
and its lifecycle and rerender behavior.

## 1. What the iframe is (and isn't)

```
React Builder
      |
      v
Same-Origin Preview iframe
      |
      +-- Rendered HTML
      +-- Preview CSS
      +-- Preview assets
      +-- Editor interaction metadata
```

The preview iframe is the **local preview surface of the builder application** — not a remote Shopify
storefront, and not an embed of any hosted URL. It is not loaded via `<iframe src="https://...">` pointing at
a live storefront. Its document is written client-side, in-browser, from the current
[Store Configuration](03-store-configuration.md) by the [LiquidJS Preview Renderer](06-preview-architecture.md),
and it exists only for the duration of an active editor session (`PreviewSession`, see
[Data Model](19-data-model.md)).

Everything inside the iframe — rendered HTML, preview CSS, preview assets, and the `data-sf-*` editor
interaction metadata (see [DOM Metadata and Selection](10-dom-metadata-and-selection.md)) — is produced by one
render pass of the real, first-party Section Liquid templates. Nothing inside the iframe is a React
reconstruction of the storefront; React never renders into the iframe's document.

**The preview never loads or executes JavaScript, by design.** A section's five sibling artifacts (Liquid
template, generated schema, `editor.meta.json`, `contract.json`, `design-spec.md` — see
[Base Theme and Section Library](02-base-theme-and-section-library.md) §2.2) include no JS artifact; sections
never carry script. The Base Theme's `assets/` directory may hold theme-level JavaScript (mobile nav, carousels,
cart-drawer interactivity) for the real Shopify storefront, but the preview pipeline loads only the Base
Theme's stylesheets into the iframe, never its JS (see [Preview Architecture](06-preview-architecture.md) §8) —
that JavaScript is production/Shopify-storefront-only and simply never reaches the preview. See
[LiquidJS vs. Shopify Liquid](07-liquidjs-vs-shopify-liquid.md) for this as a documented parity limitation, and
§9 below for why this is also load-bearing for the iframe's security model.

## 2. Why same-origin

The iframe is **same-origin** with the builder application. This is a deliberate, singular choice: same-origin
is what lets the builder's React chrome reach directly into the iframe's DOM — to attach hover/click listeners,
read computed styles and bounding boxes, and walk the DOM to resolve a clicked element back to a
`Store Configuration` path. A cross-origin iframe (or a `srcdoc` document rendered with an effectively distinct
origin) would block exactly this DOM access, which the entire click-to-select and inline-editing interaction
model depends on. Same-origin is therefore a hard requirement of the interaction architecture, not an
incidental implementation detail.

## 3. CSS isolation

The iframe's document isolates storefront CSS from the builder application's own UI CSS in both directions:

- The Base Theme's stylesheet, and any Section-level styles, apply only inside the iframe's document — they
  never leak out and affect the builder chrome (toolbar, sidebar, inspector, AI panel).
- The builder chrome's own CSS never leaks into the iframe's document and never alters how a Section renders.

This isolation is what lets the preview accurately reflect real storefront styling — it is rendering the real
Liquid output against the real Base Theme CSS, not a scaled-down or sandboxed approximation of it.

## 4. Communication model: React and the iframe

Because the iframe is same-origin, the builder application does not need a `postMessage` protocol to interact
with the preview — the React host reaches directly into the iframe's DOM. Concretely:

- **React owns**: the `<iframe>` host element, the builder chrome around it (toolbar, sidebar, section
  navigator, AI panel, inspector), and the JavaScript that attaches hover/click listeners onto the iframe's
  DOM and reads the results back into editor state.
- **LiquidJS owns**: everything written into the iframe's document — all storefront markup, exclusively,
  produced by the render pipeline in [Preview Architecture](06-preview-architecture.md).
- React never renders storefront markup itself and never reaches into the iframe to *produce* content — only
  to *read* it (hover targets, click targets, computed styles) and to *write* a fresh document into it on
  rerender (§8). If a pixel is part of what the store looks like, it came from LiquidJS; if a pixel is part of
  the tool used to build the store, it came from React.

## 5. Interaction surfaces hosted inside the iframe

The iframe hosts two editor-facing interaction surfaces, both dependent on same-origin DOM access and both
specified in their own documents:

- **Hover and click selection**, resolved via the `data-sf-*` DOM metadata every Section template emits — see
  [DOM Metadata and Selection](10-dom-metadata-and-selection.md).
- **In-preview inline text editing** via `contentEditable` on eligible elements — see
  [contentEditable](11-contenteditable.md).

## 6. Responsive viewport simulation

Device-size toggling (desktop / tablet / mobile) in the editor resizes the iframe element itself — its CSS or
`<iframe>` `width`/`height` — rather than swapping the rendered content. The same HTML string renders at
whatever viewport width the iframe currently occupies, exercising the Base Theme's real responsive CSS as a
real browser viewport would, not a scaled `<div>`. Visibility settings on a `SectionInstance` are applied by
the Preview Renderer choosing whether to render a given instance at all for the simulated breakpoint,
consistent with how the same flags drive production visibility at publish time.

## 7. Lifecycle

1. **Creation** — when an editor session (`PreviewSession`) starts, the iframe is created and its document is
   written for the first time from the current `Store Configuration`.
2. **Active session** — the document is rewritten in place on every rerender (§8); the iframe element itself
   persists across these rewrites rather than being torn down and recreated per edit.
3. **Teardown** — the iframe, and the session's in-memory preview state, exist only for the duration of the
   active editor session. It is not a persistent artifact; nothing about it is saved or published directly (see
   [Shopify Publishing](14-shopify-publishing.md) for what Publish actually transfers).

## 8. Rerender strategy

Every rerender is a **fresh render off the current `Store Configuration`, never a DOM patch** — the iframe's
document (or the affected portion of it) is regenerated from scratch by LiquidJS and written back in, rather
than having the previous DOM mutated in place. This holds whether the rerender is scoped to the affected
Section instance(s) only or to the full page; either way, what the user sees after a rerender is a fresh render
of the current configuration, not an incremental patch of what was there before. This loop never touches
Shopify — no publish, no Admin API call, and no live theme write happens as part of ordinary editing.

### 8.1 Execution placement — Decision Required

Whether LiquidJS execution for this live-editing rerender happens client-side (in the browser, as the current
design assumption for instant, network-free feedback) or is placed server-side is not finalized. A
server-rendered, per-section fragment approach is separately settled for share-link and thumbnail rendering
only — that mechanism is out of scope for the live-editing iframe described here, and does not resolve the
live-editing placement question. See [Preview Architecture](06-preview-architecture.md) for the render pipeline
this placement decision applies to.

## 9. Security, sandboxing, and asset handling

- **Sandbox posture: `sandbox="allow-same-origin"`, and nothing else — this is a binding requirement, not
  guidance.** The `<iframe>` element MUST be created with `sandbox="allow-same-origin"`. `allow-same-origin`
  alone preserves same-origin DOM access exactly as §2 requires — click-to-select, hover, and `contentEditable`
  are entirely unaffected — while every other sandbox token is withheld:
  - `allow-scripts` MUST NEVER be present on this element, under any circumstance, including as a workaround
    for some future preview-functionality request. Preview JavaScript execution is intentionally, permanently
    unsupported (§1 above) — not a current limitation to later lift. **Never combine `allow-scripts` with
    `allow-same-origin`**: scriptable same-origin content can strip its own `sandbox` attribute via
    `window.frameElement` and self-navigate fully unsandboxed, defeating the control entirely — this is the
    one well-known failure mode of `sandbox`, and it does not apply here only because `allow-scripts` is never
    granted.
  - No other token — `allow-forms`, `allow-popups`, `allow-modals`, `allow-top-navigation`,
    `allow-downloads`, or any token beyond `allow-same-origin` — is granted either, not merely "not currently
    needed."
  - The attribute is set once, at iframe-element creation, and MUST NOT be dynamically added, removed, or
    modified during the iframe's lifetime.
  - Any future change to this posture — granting any additional token, for any reason — requires an explicit,
    documented architectural decision and a security review *before* implementation, never an incidental change
    bundled into an unrelated feature. See [DECISIONS.md](DECISIONS.md) decision 8 and
    [Security and Multi-Tenancy](21-security-and-multi-tenancy.md) §10 for the full threat model this closes.
  - This is fully compatible with the rewrite-in-place rerender model in §7–§8: `allow-same-origin`
    specifically suppresses the opaque-origin side effect that a bare `sandbox` attribute would otherwise force
    on `srcdoc` (or equivalent same-origin document-write) content, so this posture does not change how the
    iframe's document is written or rewritten.
- **No live backend reachable from the preview.** Ordinary editing and rerendering never call the Shopify
  Admin/Storefront API or write to a live theme — the iframe's content is generated entirely from the
  in-session `Store Configuration`. Shopify is reached only at explicit Publish.
- **Content-injection hardening (CSP, output sanitization of AI- or user-authored text/richtext values
  rendered into the iframe) and other XSS-hardening specifics are owned by
  [Security and Multi-Tenancy](21-security-and-multi-tenancy.md)**, not detailed further here — this document
  covers the iframe's isolation and interaction architecture, not the full security threat model.
- **Assets** (images and other media referenced in Section settings) are rendered as ordinary resource
  references (e.g. `img` sources) already resolved to URLs by the time they reach the `Store Configuration`;
  the iframe does not run a separate asset pipeline of its own. See [Assets](13-assets.md) for asset lifecycle.

## 10. Open Questions / TBD

| Item | Status | Blocking |
|---|---|---|
| Client-side vs. server-side LiquidJS execution placement for the live-editing preview rerender | Decision Required | Instant, network-free feedback favors client-side execution, but this is not finalized project-wide; see §8.1. |
| Full XSS/CSP hardening treatment for content rendered into the iframe | Needs Investigation | This document's portion (the `sandbox="allow-same-origin"` posture, §9) is decided. The remaining escaping/sanitization/CSP-header detail is owned by [Security and Multi-Tenancy](21-security-and-multi-tenancy.md), not resolved in this document. |
