# Preview-to-Shopify Parity

The LiquidJS Preview Renderer and Shopify's own Liquid engine both render the identical, controlled first-party
Liquid section templates (see [Base Theme and Section Library](02-base-theme-and-section-library.md) and
[Product Architecture Overview §4](01-product-architecture-overview.md)). This is what makes parity possible,
not what guarantees it: LiquidJS is an independent implementation of the Liquid language, running in a different
context (headless Node/browser rendering vs. Shopify's own servers) against a partially stubbed runtime. The
engineering goal is stated precisely as follows and is treated as a goal with evidence, not an assumption:

> The LiquidJS preview should match the final Shopify rendering as closely as possible for our controlled
> first-party sections.

This is not a claim of 100% parity without evidence. Differences are expected in specific, enumerated
categories (§6), are allowlisted where their cause is understood, and anything outside that allowlist is a bug,
not a tolerated gap.

## 1. What "parity" covers

| Dimension | What's compared |
|---|---|
| **Structural parity** | The rendered DOM subtree for each Section — element structure, attributes (including `data-sf-*` metadata), applied setting values — matches between the two render paths. |
| **Visual parity** | Full-page and per-Section screenshot comparison — layout, color, imagery — matches between the two render paths. |
| **Responsive parity** | Structural and visual comparison is run at three breakpoints matching the Visual Editor's own preview context: desktop (1440px), tablet (768px), mobile (375px). |
| **Typography** | Font family, size, weight, and line-height as rendered — covered under visual parity; a webfont that loads in one path and not the other is a parity bug, not tolerated noise (§4). |
| **Spacing** | Margin/padding/gap as rendered — covered under visual parity. |
| **Images** | Image presence, aspect ratio, and placement are compared structurally and visually; the underlying URL is not expected to match byte-for-byte (§3). |
| **Section order** | The order Sections render in must match between paths — a structural-comparison concern, keyed by Section id so an ordering bug is attributable to a specific Section rather than "somewhere on the page." |
| **Settings** | Every setting/block value bound into a Section's Liquid must resolve identically in both paths — a data-binding correctness concern as much as a rendering one. |
| **Dynamic data** | Real Shopify runtime objects a local render cannot reproduce (§3) are explicitly out of scope for byte-identical comparison and are allowlisted. |

## 2. Comparison methodology

For a given fixture Store Configuration, both paths are rendered and compared:

1. **LiquidJS Preview Renderer path**: Store Configuration → LiquidJS `render()` against the Section Library's
   Liquid templates → HTML, rendered headlessly at the three breakpoints in §1.
2. **Real Shopify path**: the same Store Configuration applied to the Base Theme on a dedicated Shopify Partner
   development store (§5), fetched live via a headless request/browser at the same three breakpoints.

The comparison runs at two levels:

- **Structural (DOM) comparison** — each Section's rendered DOM subtree from path 1 is diffed against its
  rendered DOM subtree from path 2, keyed by Section id. This catches markup-level divergence (wrong element,
  missing attribute, different applied setting value) cheaply, without a full visual render.
- **Visual (perceptual screenshot) comparison** — full-page and per-Section-bounding-box screenshot diffs
  between the two paths, catching differences a DOM diff wouldn't (CSS resolved differently, a font failing to
  load, a layout difference from how each path serves static assets).

## 3. Shopify-only behavior and the allowlist

Not every difference between the two paths is a bug. Differences with a known, understood cause are explicitly
allowlisted and excluded from failing a comparison run — this list is reviewed periodically so it cannot
silently grow to swallow a genuine bug under an "expected difference" label:

| Allowlisted difference | Cause |
|---|---|
| Live cart contents/count | Real Shopify-only session/cart state a local LiquidJS render cannot reproduce. |
| Live inventory/stock-level text | Same — depends on real Shopify store data. |
| Customer-specific/logged-in content | Same — depends on a real customer session. |
| Storefront-selected currency/language | Same — depends on real storefront locale/market resolution. |
| Shopify CDN image URL/transform parameters vs. local preview image references | Both paths render the same image; the serving URL/transform syntax differs by design (§1, Images row). |
| Script tags injected by other apps installed on the dev store | Not part of Shopforge's own controlled output. |

**Anything outside this allowlist — at either the structural or visual level — is a hard fail and blocks
release.** An unallowlisted difference means the preview a merchant edited against does not represent what
actually published, which is the specific failure mode this comparison exists to catch. Each failure is
attributed to the specific Section and fixture Store Configuration responsible, so it's immediately clear
whether the issue is in that Section's Liquid template, a LiquidJS-vs-Shopify-Liquid engine behavioral
difference (§4), or the Store Configuration → template data-binding itself.

## 4. Known limitations: LiquidJS vs. Shopify's Liquid engine

Because LiquidJS is an independent implementation of the Liquid language, it is not guaranteed to be
behaviorally identical to Shopify's own Liquid engine on every filter/tag's edge cases. Any such incompatibility
discovered through this comparison is recorded in a known-incompatibility list maintained alongside the Section
Library, and Section templates are authored/reviewed against that list — specifically to avoid constructs known
to diverge between the two engines, rather than re-discovering the same gap Section by Section.

Two rules govern how tolerance is applied so it never masks a real gap:

- Perceptual screenshot diffing uses a noise tolerance for anti-aliasing/font-rendering jitter, but a
  **systematic** visual gap between the two rendering contexts (e.g. a webfont that fails to load in one path
  but not the other) is never waved through under that tolerance just because the pixel delta is individually
  small — a consistent, explainable divergence is a parity bug regardless of magnitude.
- The live-Shopify fetch is retried with backoff for genuine transient network conditions, but a
  content/structural mismatch is never retried in the hope it resolves itself — a real difference fails
  immediately.

## 5. Test store strategy

Comparisons against the real Shopify path run against a Shopify Partner **development store**, dedicated to this
purpose and reset between runs:

- The Base Theme is installed/updated on this store the same way it would be on a merchant's store (see
  [Shopify Publishing](14-shopify-publishing.md)), exercised end to end outside the App-Store write-access
  exemption gate (see [Shopify Publishing §8](14-shopify-publishing.md)).
- Cart and inventory state is reset or seeded to a known fixed state before each comparison run, so that
  "expected dynamic difference" cases (§3) are themselves deterministic — they're allowlisted because their
  cause is understood, not because the suite has learned to tolerate nondeterminism.

## 6. Coverage and cadence

- Every Section in the library gets parity coverage at least once, via a full-catalog fixture Store
  Configuration exercising every Section type — a new Section isn't considered done until its parity comparison
  passes, alongside its own unit/golden-render coverage.
- After every editor/AI operation type is exercised at least once per representative fixture Store
  Configuration, both paths are re-rendered and compared (an operation-types × fixture-configs smoke matrix).
- The cheaper **structural (DOM) comparison** runs on every CI run touching the Section Library, the LiquidJS
  renderer, or the Store Configuration schema.
- The more expensive **full visual/screenshot comparison**, which requires the real dev store, runs nightly and
  pre-release.
- The structural (DOM) comparison in §2 is a non-negotiable release gate: it must be 100% green for a release to
  ship, on the same footing as the validation pipeline and regeneration-preservation guarantees (see
  [Validation and Error Handling](17-validation-and-error-handling.md)). The full visual comparison is tracked
  with thresholds but is not itself a hard release blocker.

## Open Questions / TBD

| Item | Blocking question |
|---|---|
| Client-side vs. server-side LiquidJS execution for the live editing session | Settled/assumed for share-link/thumbnail rendering as a server-rendered per-section fragment only; placement for the live editing session itself is unresolved. See [Preview Architecture](06-preview-architecture.md). |
| GraphQL Admin API rate-limit figures | Affects how often the real-Shopify comparison path can be exercised against the dev store; needs re-confirmation at implementation time. |

See [DECISIONS.md](DECISIONS.md) for the settled decisions this document assumes.
