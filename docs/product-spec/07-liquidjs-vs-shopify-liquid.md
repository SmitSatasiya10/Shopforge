# LiquidJS vs. Shopify Liquid

## 1. Relationship

```
Preview:
LiquidJS -> Our Liquid Templates

Production:
Shopify Liquid Engine -> Our Liquid Templates
```

Preview and production render the **same Liquid template source** — the controlled, first-party `.liquid`
files in the [Base Theme and Section Library](02-base-theme-and-section-library.md) — through two different
Liquid engines:

- **Preview**: LiquidJS, a JavaScript implementation of the Liquid language, running client-side inside the
  builder application (see [Preview Architecture](06-preview-architecture.md)).
- **Production**: Shopify's own (Ruby-based) Liquid engine, running on Shopify's servers against the merchant's
  installed copy of the Base Theme.

There is exactly one set of Section templates. Neither environment maintains its own copy of a Section's
markup. This is what makes preview/production consistency structurally possible — but rendering the same
source through two different engines, fed two different runtime contexts (§4), is **not the same thing as
automatic 100% rendering parity**. Parity is a property this architecture is positioned to deliver well for the
things it structurally controls (markup, settings-driven content, layout, styling), and is explicitly weaker for
anything that depends on a live Shopify runtime (§6). Parity is a testing and documentation obligation, not an
assumption — the testing methodology lives in
[Preview-to-Shopify Parity](16-preview-shopify-parity.md); this document states only the relationship and the
known limitation surface.

## 2. Supported Liquid Features

Both engines render the core Liquid language used by Section templates:

- Output (`{{ }}`) and tag (`{% %}`) syntax.
- Control flow (`if`/`unless`/`case`, `for` loops over `section.blocks` — the classic block-iteration pattern;
  see §3 on Shopify's newer `content_for 'blocks'` theme-blocks tag, which is a different mechanism).
- Variable assignment (`assign`, `capture`).
- `section.settings.*` / `section.blocks[]` object access, matching Shopify's own Liquid object shape (see the
  [Shared Section Contract](12-shared-section-contract.md)).
- Snippet inclusion (`{% render %}` / `{% include %}`) against the Base Theme's `snippets/` directory.
- Shopify-specific filters (`image_url`, `money`, `t`, `asset_url`, and others in regular use across real
  Shopify sections) — **but only because Shopforge maintains a filter shim library on top of LiquidJS's own
  filter set, not because LiquidJS supports them natively.** See §3 — this is a correction to this document's
  earlier assumption that no product-authored filters/tags would be needed.

Because Section authoring is restricted to this controlled, first-party template set — AI never generates or
modifies Liquid — the surface of Liquid actually in use is bounded and known ahead of time, rather than an
open-ended arbitrary-theme surface. See [Base Theme and Section Library](02-base-theme-and-section-library.md).

## 3. Unsupported / Different Features

LiquidJS is a separate implementation of the Liquid language, not a port of Shopify's engine, so:

- **Filter/tag edge-case behavior can differ** between LiquidJS's implementation and Shopify's own engine, even
  where both nominally support the same filter or tag name.
- **Shopify-only tags** with server-side-only semantics — e.g. `{% recommendations %}` — have no live backend to
  drive them in preview; there is nothing for the tag to call against.
- **Locale/currency-dependent filters** (e.g. money formatting tied to the shop's actual currency/locale
  settings) render against the stubbed localization context (§4), not the merchant's real settings.
- **A large Shopify-specific filter surface has no LiquidJS equivalent at all** — `image_url`, `money`, `t`
  (translation lookup), `asset_url`, and others real Shopify sections use routinely are absent from LiquidJS's
  built-in filter set. **Confirmed by an internal rendering spike** run against a real, unmodified production
  theme (Debutify, ~90 sections): a hand-built, maintained filter shim library is required infrastructure for
  this architecture, not an edge case. Scoping and owning that shim library is tracked in §9.
- **`{% content_for 'blocks' %}` — Shopify's newer theme-blocks tag — has no native LiquidJS support at all.**
  Also confirmed by the same spike: 2 of 5 sections sampled from a real production theme used it, and rendering
  them required a full custom tag reimplementation (including handling nested-block recursion correctly). This
  is a materially different, larger gap than an ordinary filter/tag edge-case difference — see §6.
- **Silent failures are a distinct, and practically the more dangerous, risk category.** The same spike found
  that a missing filter or an incorrect translation-interpolation syntax (Shopify's `t` filter uses `%{var}`
  interpolation; naively assuming Liquid's own `{{ var }}` style is wrong) does not throw — it silently produces
  visibly incorrect output (`[object Object]`, literal unresolved `{{ ... }}` text) that a purely
  error-driven test would never catch. Parity testing (§8, and
  [Preview-to-Shopify Parity](16-preview-shopify-parity.md)) must include visual/snapshot comparison for this
  reason — "it rendered without throwing" is not sufficient evidence of correctness.

Given the above, this document's original assumption — "no product-authored custom Liquid filters or tags are
defined by Shopforge on top of either engine" — **does not hold** and is corrected here: a Shopforge-maintained
filter/tag shim library sitting on top of LiquidJS is now confirmed, load-bearing infrastructure for this
architecture. Section authors still work only within the *combined* supported surface (LiquidJS core + the
maintained shim library), never inventing ad hoc Liquid behavior per section — the shim library is centrally
owned, not something an individual section's template defines for itself.

## 4. Shopify-Specific Objects and Required Mock Context

Section Liquid legitimately references Shopify-provided runtime objects that only exist inside a real Shopify
request. In production, the Shopify Liquid engine populates these from the live store/request. In preview,
LiquidJS is fed a **stubbed runtime context** in their place:

| Object | Production (Shopify Liquid Engine) | Preview (LiquidJS) |
|---|---|---|
| `shop` | The real, live shop record. | Stubbed — real known values (name, domain) where available, representative-but-fake otherwise. |
| `cart` | The real, live cart for the current session. | An empty cart object — correct shape, no real line items. |
| `routes` | Real Shopify-generated URLs. | Plausible-looking, structurally correct paths not backed by a live storefront. |
| `settings` (theme-wide) | The merchant's live theme settings. | Sourced from the theme-wide portion of the Store Configuration where defined, otherwise representative defaults. |
| `localization` | The merchant's real locale/currency configuration. | A representative default locale/currency. |
| `customer` | The real logged-in customer (or absent). | Not populated with a live identity in preview. |

This stub context is maintained alongside the Section Library, since which globals a given Section's Liquid
might reference is a Section-authoring concern. It is the first, most direct source of the parity gaps in §6.
See [Preview Architecture §6](06-preview-architecture.md) for the full stubbing strategy.

## 5. Dynamic Shopify-Only Functionality

Some Section behavior depends on live Shopify systems that have no equivalent inside the preview environment:

- **App extensions / third-party apps** — merchant-installed Shopify apps that inject script tags, app blocks,
  or checkout/cart extensions are not present in preview; there is nothing to render in their place.
- **Real inventory / cart state** — stock levels, real cart contents, and live pricing/discount logic that
  depend on a live Shopify session are not reflected in preview.
- **Live Storefront/Admin API calls** — any Section behavior driven by a runtime API call (as opposed to data
  resolved ahead of render — see [Preview Architecture §5.1](06-preview-architecture.md)) has no live backend to
  call against in preview.

## 6. Known Limitations

| Limitation | Why it can diverge |
|---|---|
| Shopify-specific runtime objects (`cart`, `routes`, `customer`, real `localization`) | The Preview Renderer uses a stubbed context (§4); a Section that behaves differently against a populated real cart (e.g. quantity-dependent messaging) than against the stub won't be caught in preview. |
| Shopify-only Liquid behavior/tags | Filters or tags with server-side-only semantics (e.g. money formatting tied to the shop's actual currency/locale settings, `{% recommendations %}`) may render differently between LiquidJS and Shopify's own engine at their respective edge cases. |
| Shopify-specific filter surface (`image_url`, `money`, `t`, `asset_url`, others) | Not implemented by LiquidJS at all — **confirmed by spike**, requires a Shopforge-maintained filter shim library (§3). A section using a filter the shim library hasn't yet covered will fail or render incorrectly in preview until the shim is extended. |
| `{% content_for 'blocks' %}` theme-blocks tag | No native LiquidJS support — **confirmed by spike**, requires a custom tag implementation (§3). Any section (ours, or a legacy section referenced during migration/comparison work) using this newer block-authoring pattern needs the shim; the classic `{% for block in section.blocks %}` pattern does not. |
| Silent rendering failures | A missing filter/tag or incorrect interpolation syntax can produce visibly wrong output (`[object Object]`, literal unresolved `{{ }}` text) **without throwing an error** — confirmed by spike. Error-driven testing alone will not catch this; parity testing must include visual/snapshot comparison (§8). |
| App extensions / third-party apps | Any merchant-installed Shopify app that injects script tags, app blocks, or checkout/cart extensions has no equivalent in preview — it simply isn't there. |
| Real inventory / cart state | Preview cannot reflect actual stock levels, real cart contents, or live pricing/discount logic that depends on a live Shopify session. |
| Shopify-specific APIs | Section behavior driven by a live Storefront/Admin API call at runtime has no live backend to call against in preview. |
| Engine implementation differences | LiquidJS is a JavaScript reimplementation of Shopify's Ruby-based Liquid engine — edge-case filter/tag behavior differences between the two are possible and must be caught by testing, not assumed away. |
| Base Theme/theme-level JavaScript (`assets/*.js` — mobile nav, carousels, cart-drawer interactivity) | Does not execute in the LiquidJS preview; the preview renders static HTML/CSS only, by design (see [Preview iframe](08-preview-iframe.md) §1). This is load-bearing for the iframe security model — see [Security and Multi-Tenancy](21-security-and-multi-tenancy.md) §10 — not only a fidelity gap. |

These rows are testing and documentation obligations for the Section Library and QA process, not gaps this
document resolves. See [Preview-to-Shopify Parity](16-preview-shopify-parity.md) for the parity testing
methodology.

## 7. Where LiquidJS Executes

The architectural requirement is fixed: **LiquidJS renders the preview, and the preview is displayed inside the
same-origin iframe** (see [Preview Architecture](06-preview-architecture.md) and
[Preview iframe](08-preview-iframe.md)). A per-section server-rendered fragment is settled for share-link and
thumbnail generation only — that use case is out of scope for this document.

**Where LiquidJS executes during an active live-editing session — client-side in the browser vs. server-side —
is TBD.** This is not resolved by this document or its source material; do not assume client-side execution is
final for the live-editing case. Whatever the eventual placement, it must satisfy the fixed requirement above
and preserve the instant, no-network-round-trip feel of the edit-to-preview loop described in
[Preview Architecture §10](06-preview-architecture.md).

## 8. Parity Testing

Parity between preview and production is tested and documented per Section, per the known-limitations surface
in §6 — see [Preview-to-Shopify Parity](16-preview-shopify-parity.md) for the full methodology. This document
does not restate that methodology; it defines only the relationship between the two engines and the bounded set
of things that can differ between them.

## 9. Open Questions / TBD

- **Client-side vs. server-side LiquidJS execution for live editing** (§7) — the share-link/thumbnail
  server-rendered-fragment case is settled; live-editing-session execution placement is not.
- **Filter/tag shim library — full scope and ownership.** §3/§6 confirm the shim library (Shopify-specific
  filters plus a `content_for 'blocks'` tag implementation) is required, load-bearing infrastructure, based on a
  5-section sample from one real theme. The *complete* filter/tag surface the full Section Library (§2, up to
  ~40-60 sections) will actually need is not yet enumerated, and the shim library has no assigned long-term
  owner or update process for when a new section needs a filter the shim doesn't yet cover. Treat "does the shim
  library cover what this section needs" as a per-section authoring/review checklist item (see [Base Theme and
  Section Library §3](02-base-theme-and-section-library.md)) until this is resolved.
- **Visual/snapshot parity testing — not yet implemented.** §3/§6/§8 establish that visual comparison is
  necessary because of confirmed silent-failure risk, but the actual tooling/methodology for it is owned by
  [Preview-to-Shopify Parity](16-preview-shopify-parity.md) and was not built as part of the spike that surfaced
  the need for it — the spike's own verification was manual visual inspection, which does not scale.
