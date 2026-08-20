# 23 — MVP Scope

## 1. Framing

The MVP is not "as many Dropmagic features as we can clone." It is the smallest slice of Shopforge that proves the actual product thesis this document set now describes (doc 01 §4): **an owned, curated Section Library rendered through the same LiquidJS pipeline that ultimately runs on Shopify, driven by AI that generates structured configuration and content — never code — with a visual editor that operates on the exact same rendered output the merchant will get.**

This is a real pivot from this document set's earlier framing, and the MVP scope below is written against the new thesis, not the old one. Two facts gate everything below and are treated as load-bearing, not background:

1. **The `write_themes` exemption** (doc 16 §8) — publishing still requires writing theme files to a merchant's store, which for a public App Store app requires a Shopify-granted exemption beyond the OAuth scope itself. This remains a Phase 0 business-development dependency with its own timeline, run in parallel with engineering — and, per doc 16 §8.2, the new architecture's bounded write surface (installing/updating one specific, versioned, first-party Base Theme, never arbitrary edits to an unknown merchant theme) is if anything an *easier* case to make than the old one was.
2. **The Section Library is the real content-production bottleneck now.** The old MVP's central engineering risk was "does capability-aware minimal editing work against real, messy themes." That problem no longer exists — there is no unknown theme to parse. The MVP's central *production* risk is instead: hand-authoring, schema-defining, and design-reviewing enough first-party Liquid sections (doc 07) to generate a credible store, before any AI-quality or preview-fidelity question even matters. This gates scope directly (§2 below).

## 2. MVP feature list

| # | Feature | In MVP? | Notes |
|---|---|---|---|
| 1 | Base Theme (skeleton) | Yes | `layout/`, required infra, `config/`, `locales/` per doc 07 §4 — one theme, versioned |
| 2 | Section Library | Partial | An initial catalog of ~15–20 sections (not the full ~40–60 target), covering the categories a homepage + a product page need: header/footer, hero, image banner, rich text, product grid, featured product, product info, product gallery, testimonials/reviews, FAQ, CTA banner, newsletter, about (doc 07 §3). The full catalog is explicitly a post-MVP content-production effort (Phase 6). |
| 3 | Store Configuration schema + persistence | Yes | Full schema per doc 08; `Project`/`StoreConfigVersion`/`SectionDefinition` per doc 17 |
| 4 | Product Import | Yes, narrowed | Scrape a merchant-supplied product URL into `Product` data (doc 17 §6); MVP supports a small, explicitly allowlisted set of source shapes (e.g. a Shopify product page, one or two major marketplaces) rather than "any URL" — broader source support is a post-MVP crawler-engineering investment, not a architecture gap |
| 5 | LiquidJS Preview Renderer | Yes | Full pipeline per doc 09: resolve type → load template → inject settings → render → same-origin iframe. This is core infrastructure, not deferrable — everything downstream (editor, AI feedback loop, publish confidence) depends on it |
| 6 | Visual Editor | Partial | Section/setting/block editing, add/remove/reorder/duplicate section, contentEditable text, global styles (doc 06). Defer: drag-handle spacing controls, advanced responsive per-breakpoint overrides beyond the three standard viewports |
| 7 | AI chat / conversational editing | Yes | Flow B per doc 11 — one AI provider live at launch (see §5), full abstraction (doc 10) so a second provider is a config change |
| 8 | AI Store Generation (Flow A) | Yes | Product Import → section selection/ordering → settings/copy generation → Store Configuration, per doc 11 §4 — this is the product's core hook and is not deferrable |
| 9 | Clarification system | Yes | All 5 outcomes (execute / clarify / plan / confirm / refuse) per doc 13 |
| 10 | Section/setting reuse decision logic | Yes | doc 11 §8 — much simpler than the old capability-lookup problem, since the catalog is fixed and known; still the mechanism that keeps the AI from inventing settings outside a section's contract |
| 11 | Provenance / safe regeneration | Yes | doc 11 §9's `ai`/`user` field tagging — required from day one so regeneration never silently destroys a merchant's manual edits, even in a narrow MVP |
| 12 | Diff / undo / redo | Yes | Full schema per doc 14, required for #16/#18 below |
| 13 | Validation | Yes | All 8 categories from doc 15 — this pipeline is now simple enough that there's no reason to defer any layer of it |
| 14 | `generate_copy` | Yes | AI-authored text content, per doc 11 §3.3 |
| 15 | `generate_image` | **No — deferred** | Image generation/enhancement is scoped out of MVP (see §3); Product Import's own scraped images plus manually uploaded assets cover MVP's image needs |
| 16 | Shopify OAuth + publish | Yes | Base Theme install (`themeCreate`) + Store Configuration publish (`themeFilesUpsert`/`themePublish`) per doc 16 §4–§7; explicit merchant action only |
| 17 | Rollback | Yes | Republish a prior `PublishHistory` entry, per doc 16 §7/§9 |
| 18 | AI usage tracking | Yes | `AIUsageEvent`/`CreditBalance` ledger from day one per doc 22 §4, even though MVP billing is a single free-plus-flat tier (see §6) |

## 3. Deliberately narrow generative-op scope at MVP

`generate_image`, `regenerate_page` (bulk, whole-page regeneration), and the `overrideUserEdits: true` variant of `regenerate_section`/`regenerate_page` (doc 11 §3.3, §9) are explicitly **post-MVP**. None of them are required to prove the core thesis — that thesis rests on Flow A's initial generation quality and Flow B's ordinary conversational editing, not on bulk regeneration or image synthesis. `generate_copy` and single-section `regenerate_section` (default, `ai`-provenance-only) are in scope, since those are exercised on every normal generation and edit.

This mirrors the old document's instinct to keep MVP's generative surface narrow and well-validated rather than broad — but the reason has changed. The old scope was narrowed because arbitrary Liquid/CSS/JS generation was the highest-risk, hardest-to-validate part of the system. That risk is gone (doc 11's Future/Advanced Architecture appendix: no primary-workflow operation type emits code). What's narrowed now is scoped for a much more mundane reason: image generation and bulk regeneration are real product features with real UX and cost-control surface area, and they aren't needed to prove the thesis.

## 4. The `write_themes` exemption, made concrete for MVP planning

- MVP engineering (Section Library → Store Configuration → LiquidJS Preview → Editor → AI Generation, docs 07–15) is built and validated **entirely without needing `write_themes` access** — the LiquidJS preview never round-trips through Shopify (doc 09, doc 16 §6). This is a structural improvement over the old plan, where the Theme Parser/Model/Editor pipeline needed at least a dev-store `write_themes` grant to duplicate a theme into a working copy. In the new architecture, a developer can build and demo the entire generation-through-editing loop with **zero** Shopify write access.
- `write_themes` first becomes load-bearing at Publish (Phase 5) — installing the Base Theme and pushing Store Configuration onto it.
- The exemption application itself starts in Phase 0, in parallel, using the framing doc 16 §8.4 recommends: a bounded, versioned, first-party write surface (our own Base Theme, never arbitrary merchant files), safety properties carried over from the old application framing (never touches `MAIN` until explicit publish, full diff/undo history).
- **MVP "done" has two states depending on exemption status at ship time**, same as before: if granted, MVP ships as a normal public app hitting real merchant stores. If not yet granted, MVP ships to a small set of design-partner merchants via a custom/unlisted app installation (doc 16 §8.4's fallback), which sits outside the App-Store-distribution gate. Either path validates the same product; only distribution mechanics differ.

## 5. AI provider scope

One provider live at MVP (a single well-supported chat + structured-output + vision-capable model, since Product Data review and section-selection reasoning benefit from image understanding even without image *generation*), behind the full abstraction layer from doc 10. The abstraction is built at MVP time, not deferred, for the same reason as before: retrofitting a provider-neutral interface after prompts/schemas are hardcoded to one vendor's API shape is expensive; adding a second live provider later should be a configuration change.

## 6. Billing at MVP

Full `AIUsageEvent`/`CreditBalance`/credit-cost-table machinery (doc 22 §3–§4) is built at MVP, using the credit table doc 22 defines: Product Import free; AI Store Generation 25 credits; AI Section Regeneration 4; AI Copy Regeneration 2; ordinary conversational structural edits free; image generation (10 credits) simply isn't reachable yet since `generate_image` is deferred (§3). Commercial rollout launches with doc 22 §1's converged shape — a free tier (50 credits/month) that builds and previews unlimited Projects but gates *publish*, mirroring how Dropmagic itself gates commercialization, per doc 22 §0's reasoning for why that convergence is now the right call — rather than the old plan's flat, ungated beta tier. The ledger exists from day one so historical usage data isn't lost when full tiering (Starter/Growth/Agency) launches later.

## 7. Explicitly out of scope for MVP

- Multi-provider AI (built abstracted, only one wired up)
- `generate_image`, bulk `regenerate_page`, and the `overrideUserEdits` regeneration variant (§3)
- The remaining ~25–45 sections needed to reach the full target catalog (§2) — MVP ships with the ~15–20 needed for a credible homepage + product page
- Broad Product Import source coverage — MVP supports a small allowlisted set of source shapes, not arbitrary URLs
- Full tiered billing/plans beyond free + one paid tier
- CRO features, analytics, A/B testing (doc 24 Phase 6)
- Multi-language/localization beyond whatever the Base Theme ships with by default
- Team roles beyond a functional owner/editor split
- **Everything in the Future / Advanced Architecture appendices** across docs 07, 09, 11, and 15 — arbitrary existing-theme import/parsing, theme capability detection, AI-generated Liquid/CSS/JS, and generic theme compatibility are not partially-scoped-down MVP features; they are a different, unbuilt product direction, explicitly out of scope, not just deferred within this one

## 8. MVP acceptance criteria

MVP is done when, against a real (or dev-store) Shopify connection:

1. A user can paste a supported product URL and, within a few minutes, see a fully AI-generated multi-section homepage and product page rendered live via the LiquidJS Preview Renderer — no Shopify connection required to get to this point.
2. The user can click any rendered element in the preview, have it resolve to the correct Section/Block/Setting in the Inspector (doc 09's click-to-select mapping), edit it, and see the preview update immediately with no Shopify round trip.
3. Sending an ambiguous conversational request ("make the header better") produces a clarifying question, not a guess (doc 13).
4. Sending a well-scoped request ("make the hero heading bigger") resolves as a single `set_setting` operation, applied and previewed in one turn.
5. Regenerating a section that the user has already hand-edited preserves the user-edited fields by default (doc 11 §9) and reports what was preserved.
6. Every applied change has a Diff, is undoable, and passes doc 15's validation pipeline.
7. Publish installs the Base Theme (first publish) or updates it (subsequent publishes) and pushes the current Store Configuration live only on explicit user action; the merchant's live storefront was never touched before that point.
8. Rollback to a prior `PublishHistory` entry is demonstrated at least once against a real store.
