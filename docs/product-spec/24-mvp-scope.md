# MVP Scope

## 1. What MVP proves

The MVP is the smallest slice of Shopforge that proves the full product loop end to end: an owned, curated
Section Library rendered through the same LiquidJS pipeline that ultimately runs on Shopify, driven by AI that
generates structured configuration and content — never code — with a visual editor that operates on the exact
same rendered output the merchant will get.

## 2. MVP feature list

| # | Feature | In MVP? | Notes |
|---|---|---|---|
| 1 | Base Theme (skeleton) | Yes | `layout/`, required infra, `config/`, `locales/` — one theme, versioned |
| 2 | Section Library | Partial | An initial catalog of ~15-20 sections covering what a homepage + product page need: header/footer, hero, image banner, rich text, product grid, featured product, product info, product gallery, testimonials/reviews, FAQ, CTA banner, newsletter, about. The full ~40-60 catalog is a post-MVP content-production effort. |
| 3 | Store Configuration schema + persistence | Yes | Full schema; see [Store Configuration](03-store-configuration.md) |
| 4 | Product Import | Yes, narrowed | A small, explicitly allowlisted set of source shapes (e.g. a Shopify product page, one or two major marketplaces) rather than arbitrary URLs |
| 5 | LiquidJS Preview Renderer | Yes | Full pipeline: resolve type → load template → inject settings → render → same-origin iframe. Core infrastructure, not deferrable. |
| 6 | Visual Editor | Partial | Section/setting/block editing, add/remove/reorder/duplicate section, `contentEditable` text, global styles. Deferred: drag-handle spacing controls, advanced per-breakpoint responsive overrides beyond the three standard viewports. |
| 7 | AI chat / conversational editing | Yes | One AI provider live at launch, behind the full provider abstraction |
| 8 | AI Store Generation | Yes | Product Import → section selection/ordering → settings/copy generation → Store Configuration. The product's core hook; not deferrable. |
| 9 | Clarification system | Yes | All five outcomes: execute / clarify / plan / confirm / refuse |
| 10 | Section/setting reuse decision logic | Yes | Determines whether an existing section/setting already satisfies a request, against the fixed, known catalog |
| 11 | Provenance / safe regeneration | Yes | `ai`/`user` field tagging from day one, so regeneration never silently destroys a manual edit |
| 12 | Diff / undo / redo | Yes | Full schema, required for versioning and safe regeneration |
| 13 | Validation | Yes | All validation categories — no layer deferred |
| 14 | AI copy generation | Yes | AI-authored text content |
| 15 | AI image generation | **No — deferred** | Product Import's scraped images plus manually uploaded assets cover MVP's image needs |
| 16 | Shopify OAuth + publish | Yes | Base Theme install + Store Configuration publish; explicit merchant action only |
| 17 | Rollback | Yes | Republish a prior publish-history entry |
| 18 | AI usage tracking | Yes | Usage/credit ledger from day one, even though MVP billing is a single free-plus-flat tier |

## 3. Deliberately narrow generative scope at MVP

Bulk whole-page regeneration and the override-user-edits regeneration variant are explicitly post-MVP — neither
is required to prove the core thesis, which rests on initial generation quality and ordinary conversational
editing, not bulk regeneration. Single-section regeneration (default, AI-provenance-only) and copy generation
are in scope, since both are exercised on every normal generation and edit.

## 4. Shopify write access and MVP sequencing

MVP engineering (Section Library → Store Configuration → LiquidJS Preview → Editor → AI Generation) is built and
validated entirely without needing `write_themes` access — the LiquidJS preview never round-trips through
Shopify. `write_themes` first becomes load-bearing at Publish. See [Shopify Publishing](14-shopify-publishing.md)
for the exemption status (**Needs Investigation** — see [DECISIONS.md](DECISIONS.md) and
[Technical Dependencies](22-technical-dependencies.md)).

MVP "done" has two possible states depending on exemption status at ship time: if granted, MVP ships as a
normal public app hitting real merchant stores; if not yet granted, MVP ships to a small set of design-partner
merchants via a custom/unlisted app installation. Either path validates the same product — only distribution
mechanics differ.

## 5. AI provider scope

One provider live at MVP — a chat + structured-output + vision-capable model — behind the full provider
abstraction (see [AI Architecture](04-ai-architecture.md)). The abstraction is built at MVP time, not deferred,
so adding a second live provider later is a configuration change, not a rewrite.

## 6. Explicitly out of scope for MVP

- Multi-provider AI (built abstracted, only one wired up).
- AI image generation, bulk whole-page regeneration, and the override-user-edits regeneration variant.
- The remaining ~25-45 sections needed to reach the full target catalog.
- Broad Product Import source coverage — MVP supports a small allowlisted set of source shapes only.
- Full tiered billing/plans beyond a free tier and one paid tier.
- CRO features, analytics, A/B testing.
- Multi-language/localization beyond whatever the Base Theme ships with by default.
- Team roles beyond a functional owner/editor split.
- Arbitrary existing-theme import/parsing, theme capability detection, AI-generated Liquid/CSS/JS, and generic
  theme compatibility — not a scaled-down MVP feature; a different, unbuilt product direction entirely.

## 7. MVP acceptance criteria

MVP is done when, against a real (or dev-store) Shopify connection:

1. A user can paste a supported product URL and, within a few minutes, see a fully AI-generated multi-section
   homepage and product page rendered live via the LiquidJS Preview Renderer — no Shopify connection required
   to get to this point.
2. The user can click any rendered element in the preview, have it resolve to the correct Section/Block/Setting
   in the inspector, edit it, and see the preview update immediately with no Shopify round trip.
3. Sending an ambiguous conversational request produces a clarifying question, not a guess.
4. Sending a well-scoped request (e.g. "make the hero heading bigger") resolves as a single setting-update
   operation, applied and previewed in one turn.
5. Regenerating a section the user has already hand-edited preserves the user-edited fields by default and
   reports what was preserved.
6. Every applied change has a Diff, is undoable, and passes the validation pipeline.
7. Publish installs the Base Theme (first publish) or updates it (subsequent publishes) and pushes the current
   Store Configuration live only on explicit user action; the merchant's live storefront is never touched
   before that point.
8. Rollback to a prior publish-history entry is demonstrated at least once against a real store.
