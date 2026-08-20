# Base Theme and Section Library

Shopforge builds every store on one first-party Shopify theme and a fixed, first-party catalog of reusable
Liquid sections. We author, review, and version every section ourselves; AI never generates or modifies Liquid,
HTML, CSS, or JavaScript. This document specifies the Base Theme's structure and ownership, the Section
Library's anatomy and catalog, how a section is added, and how a section's contract changes without breaking
already-published stores.

## 1. The Base Theme

The Base Theme is the one Shopify Online Store 2.0 theme Shopforge installs on every connected merchant store.
It follows the standard Shopify theme directory structure:

```
base-theme/
  layout/       # theme.liquid and other layout wrappers
  templates/    # JSON templates (index, product, collection, ...) that reference sections by type
  sections/     # every Section Library entry's .liquid file lives here at build/publish time
  snippets/     # shared Liquid partials used across sections
  assets/       # theme-level CSS/JS/image assets
  config/       # settings_schema.json / settings_data.json
  locales/      # translation files
```

- **Ownership**: the Base Theme is owned and maintained by Shopforge, as a single controlled codebase — not a
  merchant-editable or AI-editable surface. There is exactly one Base Theme; Shopforge does not parse, import,
  or support arbitrary pre-existing merchant themes in MVP.
- **Content**: `sections/` is populated from the Section Library (§2) — every section's `.liquid` file (with its
  generated `{% schema %}` block) is the same file both the LiquidJS Preview Renderer and Shopify's own Liquid
  engine render. `templates/` reference sections by `type` slug the same way a Store Configuration does (see
  [Store Configuration](03-store-configuration.md)).
- **Versioning**: the Base Theme is versioned as a whole. Every `ShopifyInstallation` records which Base Theme
  version is installed on a given `ShopifyStore`. Publish installs the Base Theme on first publish and can
  update it on subsequent publishes (see [Shopify Publishing](14-shopify-publishing.md)).
- **Update policy for already-published stores** (auto-update vs. opt-in) — **TBD**. Blocking question: whether
  a Base Theme release should roll forward automatically on a merchant's live store or require explicit
  opt-in/republish. See [DECISIONS.md](DECISIONS.md).
- **Packaging/hosting/versioning of the `themeCreate` source artifact** — **TBD**. Blocking question: the exact
  mechanism by which a Base Theme version is packaged and supplied to the Shopify Admin API's `themeCreate`
  operation is not finalized.

## 2. The Section Library

The Section Library is the one and only place Liquid is authored. It is a fixed, first-party catalog of
reusable page-building blocks (**Sections**). Everything downstream — AI, the Visual Editor, the LiquidJS
Preview Renderer, and the real Shopify storefront — treats the catalog as a trusted, pre-built list, never
something to be discovered or inferred at runtime.

```
Section Library  +  Store Configuration
        |
        v
Preview Renderer / LiquidJS  +  Shopify Liquid (production)
```

- **Target size**: ~40-60 sections at full maturity.
- **MVP slice**: an initial ~15-20 sections, sufficient to build a homepage and a product page (header/footer,
  hero, image banner, rich text, product grid, featured product, product information, product gallery,
  testimonials/reviews, FAQ, CTA banner, newsletter, about). The remaining sections toward the ~40-60 target
  ship on an ongoing post-MVP content-production cadence.

### 2.1 Section categories and working catalog

The working target catalog totals 50 sections across six categories, inside the ~40-60 range. This is a working
list, not a final one — specific sections evolve as store builds surface gaps or redundancies, and the
mechanics in this document don't change as the catalog grows or as an entry is deprecated (§5).

**Layout / Navigation**

| Type slug | Name | Purpose |
|---|---|---|
| `announcement-bar` | Announcement Bar | Thin top-of-page bar for shipping/promo messaging |
| `header` | Header | Logo, primary nav, cart icon, search trigger |
| `mega-menu` | Mega Menu | Rich nested navigation panel triggered from the header |
| `mobile-nav-drawer` | Mobile Nav Drawer | Slide-out navigation for small viewports |
| `search-overlay` | Search Overlay | Full-screen/dropdown search-as-you-type panel |
| `breadcrumbs` | Breadcrumbs | Hierarchical location trail on product/collection pages |
| `sticky-cart-bar` | Sticky Add-to-Cart Bar | Persistent bottom/top bar on product pages once the main add-to-cart control scrolls out of view |

**Content / Marketing**

| Type slug | Name | Purpose |
|---|---|---|
| `hero` | Hero | Primary above-the-fold image/video + heading + CTA |
| `image-banner` | Image Banner | Full-width image with overlay text and optional CTA |
| `video-banner` | Video Banner | Full-width autoplay/looping video with overlay content |
| `slideshow` | Slideshow | Rotating carousel of banner-style slides |
| `rich-text` | Rich Text | Freeform heading + formatted text block |
| `image-with-text` | Image With Text | Two-column image/text pairing |
| `split-promo` | Split Promo | Two adjacent image+CTA panels |
| `collage` | Collage | Multi-column asymmetric image gallery |
| `logo-list` | Logo List | Brand/partner logo row |
| `countdown-banner` | Countdown Banner | Timed promotion banner with a live countdown |
| `about` | About | Brand story section, usually image + long-form text |
| `blog-post-grid` | Blog Post Grid | Recent article cards |

**Product / Commerce**

| Type slug | Name | Purpose |
|---|---|---|
| `product-grid` | Product Grid | Configurable grid of product cards, manual or collection-sourced |
| `featured-product` | Featured Product | Single spotlighted product with full purchase controls |
| `product-information` | Product Information | PDP core block: title, price, variant picker, add-to-cart |
| `product-gallery` | Product Gallery | PDP media gallery (images/video/3D) |
| `collection-list` | Collection List | Grid of collection tiles |
| `best-sellers` | Best Sellers | Curated or auto-ranked top-selling products |
| `related-products` | Related Products | "You may also like" grid |
| `recently-viewed` | Recently Viewed | Client-side recently-viewed product rail |
| `quick-add-grid` | Quick-Add Product Grid | Product grid with inline variant/add-to-cart per card |
| `size-chart` | Size Chart | Sizing table, usually modal-triggered from PDP |
| `bundle` | Bundle | Multi-product bundle with combined pricing |
| `upsell` | Upsell | Cross-sell/upsell offer block (cart or PDP context) |

**Social Proof**

| Type slug | Name | Purpose |
|---|---|---|
| `testimonials` | Testimonials | Curated quote cards, not tied to a reviews platform |
| `reviews` | Reviews | Star-rated customer review list/widget |
| `comparison` | Comparison | Feature/plan comparison table (e.g. product tier vs. tier) |
| `stats-counters` | Stats / Counters | Numeric proof points (e.g. "50,000+ customers") |
| `press-logos` | Press Logos | Media outlet logo row |
| `trust-badges` | Trust Badges | Payment/security/guarantee badge row |
| `ugc-gallery` | UGC Gallery | Instagram-style user-generated-content image grid |

**Conversion**

| Type slug | Name | Purpose |
|---|---|---|
| `cta-banner` | CTA Banner | Focused single-message call-to-action band |
| `newsletter` | Newsletter | Email capture form |
| `faq` | FAQ | Accordion of question/answer pairs |
| `benefits` | Benefits | Icon + short-text value-proposition row |
| `features` | Features | Longer-form feature breakdown, usually icon/image + description |
| `promo-bar` | Promo Bar | Discount-code or limited-time-offer strip |
| `contact-form` | Contact Form | Merchant contact/inquiry form |

**Footer / Utility**

| Type slug | Name | Purpose |
|---|---|---|
| `footer` | Footer | Site-wide footer: link columns, legal, newsletter slot |
| `social-links` | Social Links | Social platform icon row |
| `payment-icons` | Payment Icons | Accepted payment method icon row |
| `store-locator` | Store Locator | Physical location list/map |
| `legal-bar` | Legal Bar | Copyright + policy link strip |

A section's canonical identifier is its **type slug** — a short, kebab-case string (`hero`, `product-grid`,
`faq`). The type slug is:

- The Liquid filename stem (`sections/hero.liquid`).
- The `type` value every `SectionInstance` in a Store Configuration uses to reference it.
- The key the LiquidJS Preview Renderer uses to resolve which Liquid template to load.

The type slug is the one identifier threaded through the Section Library, the Store Configuration, and the
Preview Renderer — it is treated as an immutable primary key once a section is published (§5).

### 2.2 Anatomy of a section: five sibling artifacts

A section is defined by five sibling artifacts that ship together and are reviewed together. A section is not
considered complete until all five exist and agree with each other:

| # | Artifact | File | What it is |
|---|---|---|---|
| 1 | Liquid Template | `{type}.liquid` | The real `.liquid` file rendered at runtime by both the LiquidJS Preview Renderer and Shopify's own Liquid engine. There is no separate preview-only markup — the same file serves both. |
| 2 | Liquid Schema | embedded `{% schema %} ... {% endschema %}` | Shopify's native schema JSON (`name`, `settings[]`, `blocks[]`, `presets[]`, `max_blocks`), generated into the `.liquid` file from artifact 4 at build time — never hand-maintained separately. |
| 3 | Editor / Preview Metadata | `editor.meta.json` | Shopforge-only descriptive data outside Shopify's schema spec: inspector field grouping/order, richer field types than Shopify's native pickers, icon, thumbnail, category, and inspector help text. |
| 4 | Shared Settings Contract | `contract.json` | The canonical `SettingDef[]` / `BlockDef[]` / `PresetDef[]` definition for this section type — the single source of truth for its settings/blocks shape, consumed identically by AI, the editor, the LiquidJS preview, and Shopify Liquid. See [Shared Section Contract](12-shared-section-contract.md). |
| 5 | Design Specification | `design-spec.md` | Human-reviewed visual/brand guidelines: typography and spacing rules, responsive breakpoint behavior, imagery treatment, interactive states (hover/empty/loading), and accessibility notes. Not machine-consumed — a design reviewer signs off against this document before merge. |

The Liquid Schema (artifact 2) and the Shared Settings Contract (artifact 4) describe the same settings but are
never hand-duplicated: `contract.json` is authored once, and the embedded `{% schema %}` block is a mechanical,
build-time projection of it. This guarantees the two can never drift. `contract.json` additionally carries a
`contractVersion` (§5) that has no equivalent field in Shopify's native schema format.

### 2.3 Directory / package shape

Each section is a self-contained directory holding its five artifacts as siblings, so review, versioning, and
catalog generation all operate at the directory level:

```
section-library/
  sections/
    hero/
      hero.liquid            # Liquid template (schema block generated into this file at build time)
      contract.json          # Shared Settings Contract — SettingDef[]/BlockDef[]/PresetDef[]
      editor.meta.json       # Inspector metadata: field groups, icon, category, help text
      design-spec.md         # Visual/brand guidelines this section must follow
      thumbnail.png          # Editor "add section" picker preview image
    product-grid/
      product-grid.liquid
      contract.json
      editor.meta.json
      design-spec.md
      thumbnail.png
    ...
  catalog.json                # Generated: aggregates every section's type, category, status,
                               #   contractVersion, and contract into one document
  build/
    generate-schema.ts        # Compiles each contract.json into its section's {% schema %} block
    generate-catalog.ts       # Rebuilds catalog.json from every sections/*/contract.json + editor.meta.json
```

`catalog.json` is the one artifact most other systems need to know about:

- AI context assembly reads it to ground the AI's understanding of which sections exist and what settings each
  accepts (see [AI Architecture](04-ai-architecture.md)).
- The Visual Editor reads it (together with each section's `editor.meta.json`) to populate the "add section"
  picker and to drive the inspector's field rendering (see [Visual Editor](09-visual-editor.md)).

Neither the AI nor the editor ever reads a `.liquid` file directly.

### 2.4 Liquid Authoring Conventions

An internal rendering spike (LiquidJS against a real, unmodified production theme — see
[LiquidJS vs. Shopify Liquid §3](07-liquidjs-vs-shopify-liquid.md)) confirmed that LiquidJS has no native
support for `{% content_for 'blocks' %}`, Shopify's newer theme-blocks authoring tag, while the classic
`{% for block in section.blocks %}` loop pattern (§2.1's examples all use this) renders correctly with no
special handling. Because every Section is first-party-authored by Shopforge — never AI-generated, never
inherited from an arbitrary merchant theme — this is a choice we control, not a constraint imposed on us:

- **Section authors use the classic `{% for block in section.blocks %}` pattern by default.** It is simpler,
  fully supported by both engines with no shim dependency, and sufficient for every block-repeating layout the
  current catalog (§2.1) needs.
- `{% content_for 'blocks' %}` is not prohibited outright, but a section proposing to use it needs an explicit
  reason during engineering review (§3) — e.g. a specific merchant-composability need the classic pattern can't
  express — since it pulls in the maintained shim implementation described in
  [LiquidJS vs. Shopify Liquid §3](07-liquidjs-vs-shopify-liquid.md) rather than being natively supported.
- Regardless of which block pattern a section uses, real Shopify sections (including this one, per the spike)
  routinely depend on Shopify-specific filters (`image_url`, `money`, `t`, `asset_url`, and others) that also
  have no native LiquidJS implementation and rely on the same maintained shim library. Confirming a new
  section's filter usage is covered by the shim library is an engineering-review checklist item (§3), not an
  assumption.

## 3. Ownership, Authoring, and Review

The Section Library is owned by internal frontend/theme engineering as a standard reviewed codebase — this is a
hard boundary. **AI never authors or modifies a section's Liquid, schema, or contract.** AI's write surface is
Store Configuration values only (see [AI Architecture](04-ai-architecture.md)).

Every section change goes through two review lenses before merge, and a section is not published to the
catalog until both pass:

- **Engineering review** — standard code review of the Liquid template and contract shape, including whether it
  reuses existing `SettingDef` type conventions rather than inventing one-off shapes; whether every Shopify
  filter/tag the template uses (including any block-authoring pattern, §2.4) is covered by the maintained
  LiquidJS shim library, per [LiquidJS vs. Shopify Liquid §3](07-liquidjs-vs-shopify-liquid.md); and whether the
  section renders identical output in both engines with no silent (non-throwing) discrepancy, per that
  document's confirmed silent-failure risk.
- **Design review** — a design owner signs off specifically against `design-spec.md`: does the shipped section
  conform to the guidelines it claims to follow (typography, spacing, responsive behavior, states)?

There is no fast-path for AI-proposed or merchant-proposed sections; new capability always arrives through this
same human-reviewed process.

## 4. Lifecycle: Adding a New Section

```
Proposal
  |
Design spec drafted (design-spec.md)
  |
Contract drafted (contract.json)
  |
Liquid implementation (schema block generated from contract.json)
  |
Editor metadata authored (editor.meta.json)
  |
Review (engineering + design sign-off)
  |
Merge -> catalog.json regenerated (status: "active", contractVersion: "1.0.0")
  |
Immediately usable: next AI context build + next editor session
```

1. **Proposal** — identify the gap and name the candidate section, category, and rough settings shape.
2. **Design spec** — visual direction and conformance rules, reviewed against the Base Theme's existing brand
   system.
3. **Contract** — the `SettingDef[]` / `BlockDef[]` / `PresetDef[]` shape, reusing existing setting-type
   conventions wherever the new section's needs overlap with an existing pattern (e.g. the same `image_picker`
   / `richtext` / `color_scheme` conventions, rather than inventing new ones for equivalent needs).
4. **Liquid implementation** — the template is written against the drafted contract; the build step generates
   the embedded `{% schema %}` block from `contract.json` rather than it being hand-written. The template also
   emits `data-sf-*` DOM metadata (§6).
5. **Editor metadata** — inspector grouping, labels, icon, category.
6. **Review** — engineering and design sign-off (§3).
7. **Merge and catalog regeneration** — `catalog.json` is rebuilt to include the new entry with
   `status: "active"` and an initial `contractVersion` of `"1.0.0"`.
8. **Propagation** — AI context assembly and the editor's "add section" picker both read the current
   `catalog.json` live (or from a short-TTL cache) rather than a per-store cached copy, so a new section becomes
   usable in the very next AI context build and the very next editor session. There is no separate "roll out to
   stores" step: a *new* section cannot be backward-incompatible with any existing Store Configuration.

## 5. Lifecycle: Changing an Existing Section's Contract

**A section type slug's Shared Settings Contract never changes shape once published. Type identity is contract
identity.**

- Every section's `contract.json` carries a `contractVersion` (semver-style string, e.g. `"1.4.0"`), bumped on
  every change, tracked for audit/changelog purposes.
- **Backward-compatible changes** — adding a new optional setting or block with a schema-level default,
  label/help-text wording changes, `design-spec.md` wording changes, or internal Liquid refactors that don't
  touch any `SettingDef.id`/`type` or `BlockDef.type` — are published **in place**, as a MINOR or PATCH
  `contractVersion` bump. The `type` slug is unchanged. Every existing `SectionInstance` of that type in every
  store's Store Configuration continues to render exactly as before, and immediately becomes eligible to use
  the new optional field (at its schema default until explicitly set).
- **Breaking changes** — removing a setting, renaming a `SettingDef.id`, changing a setting's `type`
  incompatibly, or removing/renaming a `BlockDef.type` — are **never** made in place. They ship as a **new type
  slug** (e.g. `hero` -> `hero-v2`), with its own full five-artifact directory, cataloged *alongside*, not
  instead of, the original. This is a MAJOR change by definition; the new slug's `contractVersion` starts again
  at `"1.0.0"`.
- The original slug's catalog entry is marked `status: "deprecated"`. Its Liquid, contract, and schema are
  **never deleted** — a deprecated section remains fully renderable, by both the Preview Renderer and Shopify's
  own Liquid engine, indefinitely. Deprecation only changes two things: it is excluded from the AI's
  section-catalog context for new placements, and it is excluded from the editor's "add section" picker for new
  placements. A Store Configuration may reference a mix of active and deprecated types at once — this is an
  expected, safe steady state, not an error condition.

**Consequence for Store Configurations**: because contract shape is immutable per type slug, a stored Store
Configuration is never invalidated by a Section Library release, and no automatic migration step is ever
required when the library changes. This is a deliberate trade: it costs catalog surface area (an old and a new
slug coexisting) in exchange for making "does this library change break existing stores" a structurally
guaranteed "no" rather than a per-release judgment call. See [Store Configuration](03-store-configuration.md)
and [DECISIONS.md](DECISIONS.md).

**Migration/upgrade affordance for a deprecated type** (e.g. surfacing "a newer version of this section is
available" in the editor) — **TBD**. There is currently no mechanism to offer this; deprecation only means "not
offered for new use," not "prompt for migration."

**Section settings-schema migration path across Base Theme versions for already-published stores** — **TBD**,
distinct from the per-type-slug immutability rule above: how a Base Theme version bump itself is coordinated
with in-place section contract changes for stores already live on Shopify is not finalized.

## 6. Propagation to Already-Published Stores

Because of the immutable-contract-per-type-slug policy (§5), propagation to already-published stores is mostly
a non-event by design:

- A backward-compatible (in-place) contract change is picked up automatically the next time a store's section
  instance of that type is re-rendered (preview, or production on next publish) — new optional settings render
  at their defaults until explicitly set.
- A breaking contract change never reaches an already-published store, because it ships under a new type slug
  that no existing Store Configuration references. The store keeps rendering the deprecated-but-unchanged
  original.
- A section's Liquid/visual implementation *can* change for an already-published store without any Store
  Configuration edit, under a backward-compatible release (e.g. a CSS/markup polish that doesn't touch the
  contract). This is treated the same as any other Base Theme code deploy, and is how visual/UX improvements
  reach existing stores without requiring a republish-triggering settings change.

## 7. `data-sf-*` DOM Metadata

Every section's Liquid template is responsible for emitting `data-sf-*` attributes on its rendered markup, so
the Visual Editor's click-to-select and in-preview editing can map a clicked DOM node back to a specific
Section / Block / Setting identity. Emitting this metadata is a section-authoring responsibility — part of step
4 in §4/§5 above, and part of engineering review — but the full attribute contract (which attributes exist, what
they encode, how nested section/block/setting identity is expressed) is specified in
[DOM Metadata and Selection](10-dom-metadata-and-selection.md). Section authors implement against that
contract; this document only records that the obligation exists.

**Final DOM metadata attribute names beyond the `data-sf-*` namespace** — **TBD**. The namespace itself is
decided; exact per-attribute names are specified in
[DOM Metadata and Selection](10-dom-metadata-and-selection.md).

## Open Questions / TBD

| Item | Blocking question |
|---|---|
| Base Theme update policy for already-published stores | Auto-update vs. opt-in on new Base Theme releases. |
| Base Theme `themeCreate` source artifact packaging/hosting/versioning | Exact packaging and delivery mechanism to the Shopify Admin API. |
| Deprecated-type upgrade affordance | Whether/how to prompt a merchant to move a section instance from a deprecated type slug to its replacement. |
| Section settings-schema migration across Base Theme versions | How an in-place contract change is coordinated with a Base Theme version bump for already-published stores. |
| Exact `data-sf-*` attribute names | See [DOM Metadata and Selection](10-dom-metadata-and-selection.md). |

See [DECISIONS.md](DECISIONS.md) for the settled decisions this document assumes.
