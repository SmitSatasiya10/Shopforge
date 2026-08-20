# 07 — Section Library

## 1. Purpose and Scope

Shopforge does not parse, understand, or minimally edit an arbitrary merchant's existing Shopify theme. That direction — ingesting an unknown theme's file tree, deriving a capability manifest via static rules and embedding-based semantic matching, and performing targeted Liquid surgery on code we didn't write — is **cancelled for the MVP**. The reasoning that produced it isn't wasted; it's relocated to §11 as a possible post-MVP direction, because the underlying problem (arbitrary theme ingestion) is real and may return once the product has proven itself against a controlled surface.

The actual MVP architecture is narrower and much safer to build on: **Shopforge owns one base Shopify theme and a fixed library of reusable Sections.** We write and maintain every Section's Liquid ourselves, review it like any other production code, and version it deliberately. AI never generates or modifies Liquid. AI's entire surface area is choosing which Sections to use, in what order, and what structured settings/content to put into them — a job it does by writing JSON into a Store Configuration (doc 08), never by writing code.

This document specifies the Section Library as an engineering artifact: what a Section is, the initial target catalog, how Sections are authored/reviewed/versioned, how a new Section reaches the AI and the editor, and how a Section's contract changes propagate — or deliberately don't — to already-published stores.

```
Section Library (this doc)  +  Store Configuration (doc 08)
                    |
                    v
        Preview Renderer / LiquidJS (doc 09)  +  Shopify Liquid (production, doc 16)
```

The Section Library is the one and only place Liquid is authored. Everything downstream — AI, editor, preview, and the real storefront — treats it as a fixed, trusted catalog rather than something to be discovered or inferred.

---

## 2. Anatomy of a Section

A **Section** is a single reusable page-building block. It is defined by five sibling artifacts that ship together and are reviewed together — a Section is not "done" until all five exist and agree with each other:

1. **Liquid Template** (`{type}.liquid`) — the real `.liquid` file. This is the literal file that both the LiquidJS Preview Renderer (doc 09) and Shopify's own Liquid engine render at runtime. There is no separate "preview version" of a Section's markup; the same file serves both.
2. **Liquid Schema** — Shopify's native `{% schema %} ... {% endschema %}` JSON block, embedded in the template exactly as Shopify's theme editor spec requires (`name`, `settings[]`, `blocks[]`, `presets[]`, `max_blocks`). Because this is Shopify's own format, a Section that passes our review is, by construction, a Section Shopify's theme editor and Admin API will accept without translation.
3. **Editor/Preview Metadata** (`editor.meta.json`) — Shopforge-only descriptive data that is not part of Shopify's schema spec: inspector field grouping and order, richer field types than Shopify's native pickers support (e.g. a grouped "layout" tab vs. a "content" tab), icon, thumbnail, category (§3), and help text shown in the Visual Editor's inspector (doc 06).
4. **Shared Settings Contract** (`contract.json`) — the canonical, doc-08-shaped `SettingDef[]` / `BlockDef[]` definition for this Section type. This is the artifact doc 08 §5 calls the Shared Settings Contract: the one settings shape that AI, editor, LiquidJS preview, and Shopify Liquid all consume identically.
5. **Design Specification** (`design-spec.md`) — visual/brand guidelines this Section must follow: typography and spacing rules, responsive breakpoint behavior, imagery treatment, interactive states (hover/empty/loading), and accessibility notes. This is a human-reviewed document, not machine-consumed, and is the artifact a design reviewer signs off against before merge (§5).

**Why both a Liquid Schema and a separate Shared Settings Contract, when they describe the same settings?** They don't duplicate by hand. `contract.json` is the single source of truth for a Section's settings/blocks shape. The `{% schema %}` JSON block embedded in the `.liquid` file is *generated from* `contract.json` at build time by a small build step, not hand-maintained twice. This guarantees the two can never drift — there is exactly one place a Section author edits settings shape, and the Liquid-native schema Shopify reads is always a mechanical projection of it. `contract.json` additionally carries a `contractVersion` (§7) that has no equivalent field in Shopify's own schema format.

A Section's canonical identifier is its **type slug** — a short, kebab-case string (`hero`, `product-grid`, `faq`) that is:

- The Liquid filename stem (`sections/hero.liquid`).
- The `type` value every `SectionInstance` in a Store Configuration uses to reference it (doc 08 §2.3).
- The key the Preview Renderer uses to resolve which Liquid template to load (doc 09 §2).

This is the one identifier threaded through all three of these documents — get it wrong anywhere and preview/production diverge, so it is treated as an immutable primary key once a Section is published (§7).

---

## 3. The Initial Section Catalog

The list below is the MVP's working target catalog, organized into six rough categories. **This is explicitly not a final list** — categories and specific Sections will evolve as real store builds surface gaps or redundancies, and the catalog is designed to grow (or occasionally deprecate an entry, §7) without any of this document's mechanics changing. It currently totals 50 Sections, inside the ~40-60 range the product brief targets.

### 3.1 Layout / Navigation

| Type slug | Name | Purpose |
|---|---|---|
| `announcement-bar` | Announcement Bar | Thin top-of-page bar for shipping/promo messaging |
| `header` | Header | Logo, primary nav, cart icon, search trigger |
| `mega-menu` | Mega Menu | Rich nested navigation panel triggered from the header |
| `mobile-nav-drawer` | Mobile Nav Drawer | Slide-out navigation for small viewports |
| `search-overlay` | Search Overlay | Full-screen/dropdown search-as-you-type panel |
| `breadcrumbs` | Breadcrumbs | Hierarchical location trail on product/collection pages |
| `sticky-cart-bar` | Sticky Add-to-Cart Bar | Persistent bottom/top bar on product pages once the main ATC scrolls out of view |

### 3.2 Content / Marketing

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
| `logo-list` | Logo List | "As seen in" / brand/press logo row |
| `countdown-banner` | Countdown Banner | Timed promotion banner with a live countdown |
| `about` | About | Brand story section, usually image + long-form text |
| `blog-post-grid` | Blog Post Grid | Recent article cards |

### 3.3 Product / Commerce

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

### 3.4 Social Proof

| Type slug | Name | Purpose |
|---|---|---|
| `testimonials` | Testimonials | Curated quote cards, not tied to a reviews platform |
| `reviews` | Reviews | Star-rated customer review list/widget |
| `comparison` | Comparison | Feature/plan comparison table (us vs. alternative, or tier vs. tier) |
| `stats-counters` | Stats / Counters | Numeric proof points (e.g. "50,000+ customers") |
| `press-logos` | Press Logos | Media outlet logo row (distinct from `logo-list`'s brand-partner framing) |
| `trust-badges` | Trust Badges | Payment/security/guarantee badge row |
| `ugc-gallery` | UGC Gallery | Instagram-style user-generated-content image grid |

### 3.5 Conversion

| Type slug | Name | Purpose |
|---|---|---|
| `cta-banner` | CTA Banner | Focused single-message call-to-action band |
| `newsletter` | Newsletter | Email capture form |
| `faq` | FAQ | Accordion of question/answer pairs |
| `benefits` | Benefits | Icon + short-text value-proposition row |
| `features` | Features | Longer-form feature breakdown, usually icon/image + description |
| `promo-bar` | Promo Bar | Discount-code or limited-time-offer strip |
| `contact-form` | Contact Form | Merchant contact/inquiry form |

### 3.6 Footer / Utility

| Type slug | Name | Purpose |
|---|---|---|
| `footer` | Footer | Site-wide footer: link columns, legal, newsletter slot |
| `social-links` | Social Links | Social platform icon row |
| `payment-icons` | Payment Icons | Accepted payment method icon row |
| `store-locator` | Store Locator | Physical location list/map |
| `legal-bar` | Legal Bar | Copyright + policy link strip |

---

## 4. Directory / Package Shape

Each Section is a self-contained directory holding its five artifacts as siblings, so review, versioning, and catalog generation all operate at the directory level:

```
section-library/
  sections/
    hero/
      hero.liquid            # Liquid template (schema block generated into this file at build time)
      contract.json          # Shared Settings Contract — SettingDef[]/BlockDef[]/PresetDef[] (doc 08 §5)
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
  catalog.json                # Generated: aggregates every section's type, category, status, contractVersion,
                               #   and contract into one document — the artifact doc 12's AI context and
                               #   doc 06's editor "add section" picker both actually read
  build/
    generate-schema.ts        # Compiles each contract.json into its section's {% schema %} block
    generate-catalog.ts       # Rebuilds catalog.json from every sections/*/contract.json + editor.meta.json
```

`catalog.json` is the only artifact most other systems need to know about: doc 12 (AI context) reads it to ground the AI's understanding of what Sections exist and what settings each accepts; doc 06/19 (editor) reads it to populate the "add section" picker and to drive the inspector's field rendering together with each Section's `editor.meta.json`. Neither the AI nor the editor ever needs to read a `.liquid` file.

---

## 5. Ownership, Authoring, and Review

The Section Library is owned by internal frontend/theme engineering as a standard reviewed codebase, not a merchant- or AI-editable surface — this is a hard boundary, not a policy that happens to hold today: **AI never authors or modifies a Section's Liquid, schema, or contract.** AI's write surface is Store Configuration values (doc 08) only.

Every Section change goes through two review lenses before merge:

- **Engineering review** — standard code review of the Liquid template, contract shape (does it reuse existing `SettingDef` type conventions rather than inventing one-off shapes, per doc 08 §5), and editor metadata.
- **Design review** — a design owner signs off specifically against `design-spec.md`: does the shipped Section actually conform to the guidelines it claims to follow (typography, spacing, responsive behavior, states)?

A Section is not published to the catalog until both reviews pass. There is no fast-path for AI-proposed or merchant-proposed Sections; new capability always arrives through this same human-reviewed process (§6).

---

## 6. Lifecycle: Adding a New Section

1. **Proposal** — identify the gap (a demo script, a common merchant request pattern, a competitor-parity gap) and name the candidate Section, category, and rough settings shape.
2. **Design spec** drafted (`design-spec.md`) — visual direction and conformance rules, reviewed against the base theme's existing brand system.
3. **Contract drafted** (`contract.json`) — the `SettingDef[]`/`BlockDef[]`/`PresetDef[]` shape, reusing existing setting-type conventions (doc 08 §5) wherever the new Section's needs overlap with an existing pattern (e.g. reuse the same `image_picker`/`richtext`/`color_scheme` conventions rather than inventing new ones for equivalent needs).
4. **Liquid implementation** — the template is written against the drafted contract; the build step (§4) generates the embedded `{% schema %}` block from `contract.json` rather than it being hand-written.
5. **Editor metadata** (`editor.meta.json`) — inspector grouping/labels/icon/category.
6. **Review** (§5) — engineering + design sign-off.
7. **Merge → catalog regeneration** — `catalog.json` is rebuilt to include the new entry with `status: "active"` and an initial `contractVersion` of `"1.0.0"`.
8. **Propagation** — because the AI's section-catalog context (doc 12) and the editor's "add section" picker (doc 06) both read the current `catalog.json` live (or from a short-TTL cache) rather than any per-store cached copy, the new Section becomes usable in the very next AI context build and the very next editor session — there is no separate "roll out to stores" step, since nothing about a *new* Section (as opposed to a changed one, §7) can be backward-incompatible with any existing Store Configuration.

---

## 7. Lifecycle: Changing an Existing Section's Contract

This is the part of the Section Library's design that most needs to be gotten right, because getting it wrong means a Section Library change could silently break a store that published against an older Section version. The rule is deliberately simple and is treated as load-bearing:

**A Section type slug's Shared Settings Contract never changes shape once published. Type identity is contract identity.**

Concretely:

- Every Section's `contract.json` carries a `contractVersion` (semver-style string, e.g. `"1.4.0"`), bumped on every change, tracked purely for audit/changelog purposes.
- **Backward-compatible changes** — adding a new optional setting or block with a schema-level default, adjusting a label/help-text string, wording changes in `design-spec.md`, internal Liquid refactors that don't touch any `SettingDef.id`/`type` or `BlockDef.type` — are published **in place**, as a MINOR or PATCH `contractVersion` bump. The `type` slug is unchanged. Every existing `SectionInstance` in every store's Store Configuration with that `type` continues to render exactly as before, and immediately becomes eligible to use the new optional field (at its schema default until a merchant or the AI sets it).
- **Breaking changes** — removing a setting, renaming a `SettingDef.id`, changing a setting's `type` incompatibly, removing/renaming a `BlockDef.type` — are **never** made in place. They are published as a **new type slug** (e.g. `hero` → `hero-v2`), with its own full five-artifact directory, cataloged *alongside*, not instead of, the original. This is a MAJOR change by definition, and the version bump lands on the new slug's `contractVersion`, starting again at `"1.0.0"`.
- The original slug's entry is marked `status: "deprecated"` in `catalog.json`. Its Liquid, contract, and schema are **never deleted** — a deprecated Section remains fully renderable, by both the Preview Renderer (doc 09) and Shopify's own Liquid engine, indefinitely. Deprecation only changes two things: it's excluded from the AI's section-catalog context for new placements (§8), and it's excluded from the editor's "add section" picker for new placements. A Store Configuration may reference a mix of active and deprecated types at once; this is an expected, safe steady state, not an error condition.

**Consequence for Store Configurations (coordinated with doc 08 §6):** because contract shape is immutable per type slug, a stored Store Configuration is never invalidated by a Section Library release, and no automatic migration step is ever required when the library changes. This is a deliberate trade against "in-place evolution with migration scripts" — it costs catalog surface area (an old and a new slug coexisting) in exchange for making "does this library change break existing stores" a question with a structurally guaranteed "no" instead of a per-release judgment call.

**What this design leaves open:** there is currently no mechanism to *offer* a merchant an upgrade from a deprecated type to its replacement (e.g. surfacing "a newer version of this Hero section is available" in the editor) — deprecated just means "don't offer for new use," not "prompt for migration." Whether/how to build that affordance is undecided and is a candidate for doc 26 (Open Questions).

---

## 8. Propagation to the AI Section Catalog Context

Doc 12 (AI context assembly) treats `catalog.json` as one of its primary structured inputs, analogous to the role the old, cancelled Theme Manifest used to play — except the catalog here is **static across every store** (not derived per-merchant), since every store is built from the same fixed base theme and Section Library. Concretely:

- The catalog gives the AI, for every `status: "active"` Section, its `type`, category, and full Shared Settings Contract (`SettingDef[]`/`BlockDef[]`) — everything the AI needs to choose a Section and populate valid `settings`/`blocks` values (doc 11), without ever reading or writing Liquid.
- Because the catalog only changes on a Section Library release — not per merchant action, not per store — it can be built once at deploy time and cached, needing no per-request or per-store re-parse. This is a substantial simplification versus the cancelled Theme Parser's per-theme, per-webhook re-parse loop (old doc 07 §6): there is nothing store-specific to parse, because there is nothing store-specific about what Sections exist.
- `status: "deprecated"` Sections are omitted from the context given to the AI for new generation — the AI should never propose placing a Section that's being phased out, even though that same Section keeps rendering correctly for stores that already use it.

---

## 9. Propagation to Already-Published Stores

Because of the immutable-contract-per-type-slug policy (§7), "propagation to already-published stores" is mostly a non-event by design:

- A backward-compatible (in-place) contract change is picked up automatically the next time a store's Section instance of that type is re-rendered (preview or, on next publish, production) — new optional settings simply render at their defaults until explicitly set.
- A breaking contract change never reaches an already-published store at all, because it ships under a new type slug that no existing Store Configuration references. The store keeps rendering the deprecated-but-unchanged original.
- The one thing that *can* change for an already-published store without any Store Configuration edit is a Section's **Liquid/visual implementation** under a backward-compatible release (e.g. a CSS/markup polish that doesn't touch the contract) — this is treated the same as any other base-theme code deploy and is intentionally in scope; it's how visual/UX improvements reach existing stores without requiring a republish-triggering settings change.

---

## 10. Editor DOM Metadata (Cross-Reference)

Every Section's Liquid template is also responsible for emitting a small set of `data-sf-*` attributes on its rendered markup, so the Visual Editor's click-to-select and in-preview editing can map a clicked DOM node back to a specific setting. This is a Section-authoring responsibility (part of step 4 in §6/§7 above, and part of engineering review), but the exact attribute contract is specified in full in doc 09 §6, since it's fundamentally about the preview/editor interaction model, not the Section Library's own shape. Section authors implement against doc 09 §6's contract; this document just records that the obligation exists.

---

## 11. Future / Advanced Architecture

Everything in this section describes the **cancelled MVP direction**, preserved because the underlying problem — supporting an arbitrary, unknown merchant theme instead of only our own base theme — is a plausible post-MVP investment, not a bad idea. It is explicitly **not** part of the MVP architecture and nothing in docs 07-09 depends on it.

**If Shopforge ever supports importing an arbitrary existing merchant theme** (rather than only building on our own base theme + fixed Section Library), it would need something close to the original Theme Parser concept:

- **Arbitrary file-tree ingestion:** a parser walking an unknown OS 2.0 theme's `layout/`, `templates/`, `sections/`, `snippets/`, `config/`, `assets/`, and `locales/` directories, extracting each section's `{% schema %}` into a structural summary — an `ImportedThemeManifest`, distinct in name and purpose from this architecture's `StoreConfiguration` (doc 08), since an imported theme's sections aren't drawn from our controlled catalog and can't be assumed to expose our Shared Settings Contract shape.
- **Static rule-based capability detection:** cheap, deterministic, explainable pattern matching (e.g. "a section with an `image_picker` + `richtext` setting near the top of the homepage template is probably a hero") to flag likely capabilities without any model call.
- **Embedding-based semantic capability matching:** for capabilities that can't be reliably named by keyword because arbitrary theme authors use wildly inconsistent naming (a reviews section literally called "Customer Love Wall"), a fallback resolution pass comparing extracted schema text against a reference capability-description library — deferred to an AI/embedding step specifically because it's too expensive and non-deterministic to run as a static rule.
- **Tri-state capability flags** (`true | false | null`, `null` meaning "undetermined by static rule, pending semantic resolution") as the mechanism for handing off from the cheap static pass to the expensive semantic pass without conflating "we checked and it's absent" with "we haven't determined this yet."

None of this is designed in detail here — reviving it would require, at minimum, deciding how an arbitrary theme's ad hoc sections would map onto (or coexist with) the Section Library's controlled catalog and Shared Settings Contract, which is a substantially harder problem than anything this document solves for the fixed-catalog MVP. This is flagged as a real future direction, not a discarded one, but it is out of scope until there's product evidence it's needed.
