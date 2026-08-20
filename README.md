# Shopforge — Research & Planning

Research and planning only. No implementation code exists yet. This README is the entry point into `docs/01`–`25`, which were produced by: three research passes (Dropmagic, the Shopify platform, and five page-builder competitors — each with full source citations and explicit VERIFIED/REPORTED/NOT-PUBLICLY-VERIFIABLE tagging), followed by architecture and planning docs written against that research. Research date: 2026-08-19.

## What was researched

- **Dropmagic** (dropmagic.ai): marketing site, pricing, ToS, Shopify App Store presence, and independent reviews. Full findings in `docs/01-product-overview.md` and `docs/02-dropmagic-feature-analysis.md`.
- **The Shopify platform**: Online Store 2.0 theme architecture, GraphQL Admin API theme endpoints, OAuth scopes, rate limits, webhooks, and Shopify Magic/Sidekick as a baseline. Full findings in `docs/16-shopify-integration.md`.
- **Five competitors** (PageFly, GemPages, Replo, Instant, Shogun) plus Shopify's native Theme Editor. Full findings in `docs/03-competitor-analysis.md`.

Every factual claim about a named product in these docs carries a citation tag back to the underlying research; nothing about a competitor's internals is asserted without one.

## Dropmagic's core model

Paste a product URL (AliExpress/Amazon/Alibaba/Shopify) → get a fully branded, brand-new Shopify store in minutes — homepage, product page, About, FAQ, copy, images, branding, all generated in one pass. Free tier builds and previews unlimited stores but **cannot publish**; the only paid tier ($79/mo) unlocks publishing. It is structurally a **new-store generator**, not an existing-theme editor — no source found across the research shows it editing an already-live merchant theme in place. An independent hands-on review found the marketed "2–5 minute" store needs roughly another 1–2 hours of manual cleanup before it's launch-ready. Its underlying technical architecture (Liquid-native output vs. something proprietary) is essentially undocumented publicly.

The wider competitive set (PageFly, GemPages, Replo, Instant, Shogun, and Shopify's own Magic/Sidekick) shares one trait: every one of them is **generate-and-place**, not **understand-then-minimally-edit**. Replo comes closest technically (writes real Liquid section files into the theme); Shopify Sidekick comes closest philosophically (can adjust existing settings via natural language); none combines both with a proper editor, versioning, and validation layer on top. See `docs/03-competitor-analysis.md` §4.7 for the full argument.

## Our differentiation

Shopforge parses a merchant's **existing** theme into a structured Manifest and Model (`docs/07`–`09`), lets an AI propose the **smallest sufficient change** by reusing existing settings/sections before ever generating new code (`docs/11`), asks for clarification instead of guessing on ambiguous requests (`docs/13`), and makes every change — AI or manual — traceable and reversible through one shared model and one diff/undo system (`docs/09` §Principle 7, `docs/14`). This is a different bet than Dropmagic's: not "build a store from nothing fast," but "make a merchant's live store better without breaking or replacing what already works."

## Key architectural decisions

- **Duplicate-first, never touch `MAIN` directly** (`docs/16` §5) — every import creates a working-copy theme; publish is a single explicit, deliberate action.
- **One shared Theme Model for editor and AI** (`docs/09`, Principle 7) — no disconnected representations.
- **Structural ops are near-free; generative ops cost credits** (`docs/22`) — the one billing dimension no competitor researched appears to price this way.
- **9-layer validation, atomic Operation Plans, bounded single-retry on generative failure** (`docs/14`, `docs/15`) — nothing reaches a merchant's real files unvalidated or un-reversible.
- **`write_themes` requires a Shopify-granted exemption for public apps** (`docs/16` §10) — this is the single biggest platform risk in the whole plan, treated as a Phase 0/1 gating milestone run in parallel with engineering, with a dev-store/local-CLI fallback so engineering isn't blocked on approval timing (`docs/24` Phase 0–1).

## MVP scope (docs/23)

Full pipeline (parser → manifest → model → planner → clarification → diff → validation → publish) shipped end to end, but narrowed: one AI provider, structural operations fully supported, generative operations limited to `create_section_file` against a small allowlisted archetype set (FAQ, testimonials, CTA banner) — `modify_liquid`/`modify_css`/`modify_js` deferred post-MVP as the highest-risk, hardest-to-validate capability. Built and proven against a Shopify development store and CLI-pulled themes first, independent of exemption approval timing.

## Major risks

1. **Platform**: the `write_themes` exemption (see above) — business-development risk with an unknown timeline, not an engineering unknown.
2. **AI**: whether the reuse-vs-generate decision (`docs/11` §5) actually holds up against real, messy, heavily-customized merchant themes rather than clean fixture themes — this is the core untested product hypothesis, flagged explicitly in `docs/24` Phase 4.
3. **Validation completeness**: regression validation depends on a complete per-operation "allowed secondary effects" list (`docs/15`); an incomplete list produces false-positive blocks that make working correctly *feel* broken.
4. **Unresolved Shopify specifics**: conflicting GraphQL rate-limit figures, unconfirmed preview-link mechanism for hosted apps, unconfirmed `themes/update` webhook semantics — all listed with the rest in `docs/16` §11 and needing direct confirmation with Shopify before those specific subsystems are finalized.
5. **Security**: imported product/competitor content is untrusted input by construction (`docs/20`) — prompt injection via scraped pages is a real, addressed-but-unproven-in-production threat model.

## Open questions

See `docs/16` §11 for the full ranked list (exemption approval criteria, rate limits, webhook semantics, `files` connection content behavior). Beyond platform specifics: exact pricing tiers (`docs/22` proposes a structure, not final numbers); whether a "start from scratch" secondary path is ever worth building given Dropmagic's and Shogun Frontend's cautionary evidence against full-generation/full-replacement models (`docs/03` §6.4).

## Recommended next step

Start Phase 0 for real: submit the `write_themes` exemption application to Shopify Partner support using the safety-property framing in `docs/16` §10.4, in parallel with standing up a Shopify development store and beginning Phase 1 engineering (`docs/24`) against it. Do not wait for exemption approval to start building — the entire roadmap is sequenced so engineering proceeds on the dev-store/local-CLI path while the partner-approval track runs alongside it.

## Document index

| Doc | Contents |
|---|---|
| [01-product-overview.md](docs/01-product-overview.md) | Dropmagic product understanding + Shopforge's differentiator |
| [02-dropmagic-feature-analysis.md](docs/02-dropmagic-feature-analysis.md) | Full Dropmagic feature inventory, cited |
| [03-competitor-analysis.md](docs/03-competitor-analysis.md) | Dropmagic + 5 competitors + Shopify Magic, comparison matrix, copy/improve/ignore table |
| [04-user-flows.md](docs/04-user-flows.md) | Full Shopforge user journey, step by step |
| [05-information-architecture.md](docs/05-information-architecture.md) | App sitemap, screen-to-entity mapping |
| [06-editor-specification.md](docs/06-editor-specification.md) | Every visual-editor operation, mutation-function-level detail |
| [07-theme-parser.md](docs/07-theme-parser.md) | Theme file tree → Manifest extraction logic |
| [08-theme-manifest.md](docs/08-theme-manifest.md) | Full Manifest schema + example |
| [09-theme-model.md](docs/09-theme-model.md) | Full Model schema, mutation API, serializer |
| [10-ai-architecture.md](docs/10-ai-architecture.md) | Provider-neutral AI abstraction layer |
| [11-ai-operation-system.md](docs/11-ai-operation-system.md) | Operation planning, reuse-vs-generate logic |
| [12-ai-context-and-token-optimization.md](docs/12-ai-context-and-token-optimization.md) | Context-selection strategy, token budgets |
| [13-clarification-system.md](docs/13-clarification-system.md) | When to ask vs. act vs. plan vs. refuse |
| [14-diff-versioning.md](docs/14-diff-versioning.md) | Diff schema, undo/redo, snapshots, revert |
| [15-validation-system.md](docs/15-validation-system.md) | 9-layer validation pipeline |
| [16-shopify-integration.md](docs/16-shopify-integration.md) | OAuth, theme API, **write_themes exemption risk** |
| [17-database-model.md](docs/17-database-model.md) | Full entity schema + ER diagram |
| [18-api-architecture.md](docs/18-api-architecture.md) | Full API surface, roles, concurrency |
| [19-frontend-architecture.md](docs/19-frontend-architecture.md) | App layout, editor UI, state management |
| [20-security.md](docs/20-security.md) | OAuth security, prompt injection defense, XSS/SSRF |
| [21-testing-strategy.md](docs/21-testing-strategy.md) | Unit/integration/AI/regression/visual test plan |
| [22-billing-and-ai-usage.md](docs/22-billing-and-ai-usage.md) | Tiers, credit-cost table, overage policy |
| [23-mvp-scope.md](docs/23-mvp-scope.md) | Exactly what ships first, and why |
| [24-development-roadmap.md](docs/24-development-roadmap.md) | Phase 0–9, features/dependencies/risks/acceptance criteria |
| [25-final-architecture.md](docs/25-final-architecture.md) | Final architecture diagram + rationale |

## Canonical schemas

`docs/` intentionally does not repeat the canonical Theme Manifest / Theme Model / Operation / Diff / DB-entity schemas in every file — they're defined once and referenced by name throughout. If you're implementing against these docs, read `docs/08`, `docs/09`, `docs/11` §2–3, and `docs/14` §2 first; every other doc assumes those names and shapes.
