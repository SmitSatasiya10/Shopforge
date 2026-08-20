# Shopforge — Research & Planning

Research and planning only. No implementation code exists yet. This README is the entry point into `docs/01`–`26`.

This document set went through two passes. The first pass (docs 01–03, 16) was built on three research efforts — Dropmagic, the Shopify platform, and five page-builder competitors, each with source citations and VERIFIED/REPORTED/NOT-PUBLICLY-VERIFIABLE tagging — followed by an architecture designed around parsing and minimally editing an arbitrary merchant's *existing* Shopify theme. That architecture is no longer what Shopforge is building. The second pass (this rewrite) replaces it with the actual product direction: **one base Shopify theme we own, a fixed library of first-party Liquid sections, AI that generates structured configuration/content rather than code, and a LiquidJS-powered preview that renders the exact same Liquid templates that ultimately run on Shopify.** Docs 01–03 and 16 keep their original competitor/platform research intact where it's still factual and relevant, with only the architecture-dependent conclusions rewritten; docs 04–15 and 17–22 are substantially rewritten; docs 23–25 are fully replaced; doc 26 is new.

## What was researched

- **Dropmagic** (dropmagic.ai): marketing site, pricing, ToS, Shopify App Store presence, and independent reviews. Full findings in `docs/01-product-overview.md` and `docs/02-dropmagic-feature-analysis.md`.
- **The Shopify platform**: Online Store 2.0 theme architecture, GraphQL Admin API theme endpoints, OAuth scopes, rate limits, webhooks, and Shopify Magic/Sidekick as a baseline. Full findings in `docs/16-shopify-integration.md`.
- **Five competitors** (PageFly, GemPages, Replo, Instant, Shogun) plus Shopify's native Theme Editor. Full findings in `docs/03-competitor-analysis.md`.

Every factual claim about a named product in these docs carries a citation tag back to the underlying research; nothing about a competitor's internals is asserted without one. Our own architecture decisions are design specification, not research findings, and don't carry citation tags — the same convention docs 01 §0 and §4 draw explicitly.

## Dropmagic's core model

Paste a product URL (AliExpress/Amazon/Alibaba/Shopify) → get a fully branded, brand-new Shopify store in minutes — homepage, product page, About, FAQ, copy, images, branding, all generated in one pass. Free tier builds and previews unlimited stores but **cannot publish**; the only paid tier ($79/mo) unlocks publishing. An independent hands-on review found the marketed "2–5 minute" store needs roughly another 1–2 hours of manual cleanup before it's launch-ready. Its underlying technical architecture (Liquid-native output vs. something proprietary) is essentially undocumented publicly — this remains the single largest unresolved question about Dropmagic across all the research.

## Our model — and the honest relationship to Dropmagic's

Shopforge has converged on a generation-first flow that is structurally close to Dropmagic's: paste a product URL, get an AI-generated store, preview it, edit it, publish it. Docs 01 §4 and 03 §4.7 both say this plainly rather than papering over it — the old positioning ("we parse and minimally edit your existing live theme; Dropmagic only builds new ones") no longer describes what's being built. What differentiates Shopforge now is not the shape of the workflow, it's what's underneath it:

- **The LiquidJS Preview Renderer renders the actual production Liquid section templates** — not a React recreation, not a proprietary renderer of undocumented provenance (Dropmagic's own rendering engine is unconfirmed). What's previewed is, section for section, what publishes.
- **A curated, first-party, quality-controlled section library** (`docs/07`) bounds output quality, in contrast to Dropmagic's uncorroborated/contradicted quality claims and its own documented cleanup-time problem.
- **Real Shopify Liquid output with no ongoing runtime dependency on our servers** — shared with Replo and Shopify Magic/Sidekick, in contrast to the JS-overlay pattern reported for PageFly and GemPages, where pages stop rendering if the app is uninstalled.

See `docs/01` §4 for the full argument.

## Key architectural decisions

- **We own the Base Theme and the Section Library — we do not parse arbitrary merchant themes** (`docs/07`, `docs/16`) — every generated store is built on one controlled foundation; the old duplicate-and-parse-the-merchant's-theme model is gone.
- **The Store Configuration is the single source of truth** (`docs/08`) — AI, the visual editor, the LiquidJS preview, and eventually Shopify's own Liquid engine all read and write the identical settings/blocks shape per section, via a Shared Section Contract (`docs/08` §5).
- **Preview never touches Shopify** (`docs/09`) — the LiquidJS Preview Renderer renders our own Liquid section templates into a same-origin iframe, entirely client-side (or server-rendered for share links only, `docs/18` `/preview/*`). This is the single most important architectural decision in the whole set.
- **AI generates structured configuration and content, never code** (`docs/11`) — no primary-workflow `OperationType` emits Liquid, HTML, CSS, or JS. Regeneration is provenance-aware (`docs/11` §9): it only touches AI-authored fields by default, never silently overwriting a merchant's manual edits.
- **`write_themes` requires a Shopify-granted exemption for public apps** (`docs/16` §8) — still the single biggest platform risk in the plan, still a Phase 0 gating milestone run in parallel with engineering — but the new architecture's bounded write surface (installing/updating one specific first-party theme, never arbitrary merchant files) is argued to make this an *easier* case than the old framing, and engineering no longer needs any Shopify write access at all until Publish (`docs/24` Phase 5).

## MVP scope (docs/23)

Base Theme + an initial ~15–20 section slice (not the full ~40–60 target) + Store Configuration + LiquidJS Preview + Visual Editor + AI Store Generation + conversational AI editing + Clarification + Diff/undo + full validation + Shopify publish, shipped end to end. Narrowed: one AI provider, `generate_image` and bulk/override regeneration deferred post-MVP, Product Import limited to a small allowlisted set of source shapes rather than arbitrary URLs. Section Library content-production throughput — not engineering risk — is named explicitly as the dominant MVP planning risk.

## Major risks

1. **Platform**: the `write_themes` exemption (see above) — business-development risk with an unknown timeline, arguably eased by the new architecture's narrower write surface.
2. **Content production**: whether the Section Library can be authored at the pace the roadmap assumes — a design/content risk, not purely an engineering one (`docs/23` §1, `docs/24` Phase 0–1).
3. **AI generation quality**: whether AI-selected section ordering and AI-authored settings/copy actually produce a credible, on-brand store from real, varied product data — this replaces the old "does reuse-vs-generate hold up against messy real themes" risk, which no longer exists (`docs/24` Phase 4).
4. **Preview-production parity**: the LiquidJS preview and Shopify's own Liquid engine can still diverge around Shopify-specific runtime objects, app extensions, and real cart/inventory state (`docs/09` §8, `docs/21` §6) — tested, not assumed.
5. **Security**: imported product/scraped content is untrusted input by construction (`docs/20`), and the LiquidJS same-origin iframe introduces a new trust boundary (Liquid-injection-style risk from unescaped setting values) that didn't exist under the old architecture (`docs/20` §20.7).

## Open questions

See `docs/26` for the full tracked list — platform items (exemption approval criteria, Base Theme update policy, rate limits), preview/editor interaction items (click-target disambiguation, keyboard-accessible selection), and AI/product items (vague-style-request resolution, Section Library authorship throughput, Product Import source breadth).

## Recommended next step

Start Phase 0 for real: submit the `write_themes` exemption application to Shopify Partner support using the bounded-write-surface framing in `docs/16` §8.4, and in parallel begin Section Library content production planning for the ~15–20 sections Phase 1 needs (`docs/24`). Neither of these blocks the other, and neither blocks starting Phase 1 engineering — the entire roadmap is sequenced so the generation-through-editing loop (Phases 1–4) can be built and demoed with zero Shopify write access at all.

## Document index

| Doc | Contents |
|---|---|
| [01-product-overview.md](01-product-overview.md) | Dropmagic product understanding + Shopforge's differentiator |
| [02-dropmagic-feature-analysis.md](02-dropmagic-feature-analysis.md) | Full Dropmagic feature inventory, cited |
| [03-competitor-analysis.md](03-competitor-analysis.md) | Dropmagic + 5 competitors + Shopify Magic, comparison matrix, copy/improve/ignore table |
| [04-user-flows.md](04-user-flows.md) | Full Shopforge user journey, step by step |
| [05-information-architecture.md](05-information-architecture.md) | App sitemap, screen-to-entity mapping |
| [06-editor-specification.md](06-editor-specification.md) | Every visual-editor operation, Store Configuration write path per operation |
| [07-theme-parser.md](07-theme-parser.md) | Section Library — the fixed, first-party Liquid section catalog |
| [08-theme-manifest.md](08-theme-manifest.md) | Store Configuration Schema — the central JSON document + Shared Section Contract |
| [09-theme-model.md](09-theme-model.md) | Preview Rendering & Interaction Architecture — LiquidJS pipeline, same-origin iframe, click-to-select, contentEditable |
| [10-ai-architecture.md](10-ai-architecture.md) | Provider-neutral AI abstraction layer |
| [11-ai-operation-system.md](11-ai-operation-system.md) | AI Generation & Editing Operation System — generation flow, editing operations, provenance |
| [12-ai-context-and-token-optimization.md](12-ai-context-and-token-optimization.md) | Context-selection strategy, token budgets |
| [13-clarification-system.md](13-clarification-system.md) | When to ask vs. act vs. plan vs. refuse |
| [14-diff-versioning.md](14-diff-versioning.md) | Diff schema, undo/redo, snapshots, restore, revert |
| [15-validation-system.md](15-validation-system.md) | 8-category validation pipeline |
| [16-shopify-integration.md](16-shopify-integration.md) | OAuth, Base Theme install/update, publish, **write_themes exemption risk** |
| [17-database-model.md](17-database-model.md) | Full entity schema + ER diagram |
| [18-api-architecture.md](18-api-architecture.md) | Full API surface, roles, concurrency |
| [19-frontend-architecture.md](19-frontend-architecture.md) | App layout, editor UI, state management |
| [20-security.md](20-security.md) | OAuth security, prompt injection defense, LiquidJS/iframe security, XSS/SSRF |
| [21-testing-strategy.md](21-testing-strategy.md) | Unit/integration/AI/regression/preview-parity test plan |
| [22-billing-and-ai-usage.md](22-billing-and-ai-usage.md) | Tiers, credit-cost table, overage policy |
| [23-mvp-scope.md](23-mvp-scope.md) | Exactly what ships first, and why |
| [24-development-roadmap.md](24-development-roadmap.md) | Phase 0–6, features/dependencies/risks/acceptance criteria |
| [25-final-architecture.md](25-final-architecture.md) | Final architecture diagram + rationale |
| [26-open-engineering-questions.md](26-open-engineering-questions.md) | Every unresolved decision, tracked with a status |

## Canonical schemas

`docs/` intentionally does not repeat the canonical Section / Store Configuration / Operation / Diff / DB-entity schemas in every file — they're defined once and referenced by name throughout. If you're implementing against these docs, read `docs/07`, `docs/08`, `docs/09`, `docs/11` §3, and `docs/14` §2 first; every other doc assumes those names and shapes.
