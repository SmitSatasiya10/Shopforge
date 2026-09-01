# Shopforge Feature Audit

_Date: 2026-09-01_

A full sweep of current features to identify what needs improvement and what new features could be added. Based on a survey of `app/` routes & APIs, `components/`+`lib/`, and git history/in-progress work.

## What Shopforge is

A Next.js 16 / React 19 app that turns a product URL (Shopify store, Amazon, Etsy, or a competitor site) into a working Shopify store: AI selects/configures sections from a first-party Base Theme, renders via a hand-built LiquidJS-compatible engine (the *same* Liquid that later ships to Shopify), lets the user edit visually, then publishes via real Shopify OAuth. It's pre-1.0 (`0.1.0`) but functionally deep — 66 test files, 92 theme sections, no TODO/FIXME litter, unusually thorough inline documentation.

## Feature inventory (shipped, working)

- **Import wizard** (`/import`, 1972 lines): Shopify URL / Amazon / Etsy / competitor-site import → product discovery → AI product-quality analysis (margin, perceived value, reviews, trends) → language/persona/marketing-angle selection → AI product images.
- **Visual editor** (`/editor/[projectId]`, 1739 lines): click-to-select sections/text/images, inline text editing, AI rewrite (angle-based: emotional/logical/social-proof/urgency/etc.), magic-brush restyle, 50-step undo/redo with coalescing, autosave with optimistic-concurrency conflict handling (409), `sendBeacon` flush on unload, voice dictation (mic → caret-accurate insert), color picker, media panel (product/generated/uploaded images), change-history panel restoring prior checkpoints.
- **Shopify integration**: full OAuth (CSRF state, HMAC verify, AES-256-GCM token encryption, token refresh), Admin API product fetch, theme publish (zip bundle + asset upload with dedup).
- **Store/theme management**: multi-theme-per-store, duplicate/rename/delete/activate, public shareable preview links (unauthenticated, token-based).
- **AI pipeline**: all via OpenRouter (no official SDK) — content generation, section/title/description rewriting, persona & marketing-angle generation, three separate image-generation paths (decorative, AI-edit-existing, product photography).
- **Rendering engine**: a hand-built Shopify-Liquid-compatible layer (custom tags/filters/drops/settings resolution) so preview and production Liquid never diverge — a genuinely sophisticated piece of infrastructure.

## In-progress, uncommitted work

**Icon Picker feature** — `components/IconPanel.tsx`, `components/IconChangeButton.tsx`, `lib/icons/material-symbols.ts`, `lib/preview/icon-setting.ts` (+test), plus edits to `PreviewFrame.tsx`, `SettingsPanel.tsx`, `globals.css`, `layout.tsx`, and ~30 base-theme `.liquid` files. Mirrors the existing image-picker UX for icon settings (Shopify has no native icon type, so this theme encodes icons as `text` settings by naming convention: `icon`/`icon_N`). **Functionally complete for a first pass** — detection logic is unit-tested, catalog is curated (~120 Material Symbols names), UI wiring is consistent end-to-end, no half-wired liquid files found. Not yet committed.

One loose end spotted in the diff: `snippets/icon-with-content-block.liquid`'s new `block_attributes` wrapper is passed `true` from `horizontal-ticker.liquid`'s two call sites but not from `custom-columns.liquid`'s call site — worth a quick check on whether that's intentional.

---

## Issues found (ranked)

### Critical

1. **No authentication or authorization anywhere.** Every API route (project, store, publish, Shopify disconnect/connect, theme delete) is fully open — no session check, no ownership check. Confirmed via grep: no `next-auth`, no `getServerSession`, no `middleware.ts`. This directly contradicts the project's own spec (`docs/product-spec/21-security-and-multi-tenancy.md`), which describes a full User/Organization/OrgMembership role model that was never built. Anyone who knows/guesses a `storeId`/`projectId` can read, edit, publish, or delete it.
2. **No rate limiting or AI spend controls.** Generation/image endpoints are uncapped per-caller. Worse, `POST /api/project/[id]/generate` and rewrite endpoints trust a client-supplied `body.model` to override the configured OpenRouter model with no allowlist — a caller could redirect generation to any model on the operator's API key.
3. **Failing test in the suite**: `lib/preview/__ticker_debug.test.ts` is a leftover debug scratch test that writes to a hardcoded path from a previous Claude session's scratchpad (which no longer exists) — it's the one failing test in `npm test` (641 pass / 1 fail / 3 skip). Trivial to fix (delete or convert to a real assertion) but currently makes CI/local test runs red.

### Moderate

4. **Token-at-rest encryption is a self-documented stopgap.** `lib/shopify/crypto.ts` uses AES-256-GCM at the application level; the code comment itself says to replace it with real KMS envelope encryption "before real merchant tokens (beyond a dev/testing store) are stored."
5. **Thin test coverage on security-sensitive layers**: `lib/shopify/` (Admin API, HMAC, crypto, token refresh) has only 1 of 11 files tested; `lib/shopify-compat/` (the custom Liquid engine) has only 3 of 12 files directly tested. Zero component-level tests exist anywhere in `components/`.
6. **Only 2 supplier integrations** (Amazon, Etsy) despite "supplier import" being presented as a general capability in the UI.
7. **Placeholder analysis signals**: `checks/reviews.ts` and `checks/trends.ts` in the Product Analysis feature return fixed scores (65/60) rather than real data — explicitly flagged in comments as temporary, with no Review model or trend-data provider wired up yet.
8. **MediaPanel's "Reviews" tab** has no backing data source (shows an honest empty state — not broken, just unbuilt).
9. **`README.md` is stale** — it claims "no implementation code exists yet," which actively misleads anyone (contributor, auditor, new AI session) who reads it first.
10. **Single-store-at-a-time Shopify connection** — documented as a known limitation, not a bug, but worth surfacing as a product constraint.
11. **Spec/delivery drift**: `docs/product-spec/24-mvp-scope.md` marks AI image generation as "deferred" for MVP, but it has already shipped (twice — wizard images and AI image-editing). The spec docs should be reconciled with what's actually built.

---

## New feature opportunities (detailed)

### A. AI & content generation

- **Multi-variant store generation** — generate 2–3 full store variants in one pass (different copy angle, section mix, or color/style direction) and let the user pick a starting point, instead of committing to one AI pass. Builds directly on the existing `content-generator.ts` + `fixed-sections.ts` pipeline; the main new work is running generation N times in parallel and a variant-picker UI (reuses `SectionPreviewThumbnail` rendering).
- **SEO pass** — auto-generate meta titles/descriptions, image alt text, and structured data (Product/Organization JSON-LD) as part of generation or as a one-click "Optimize for SEO" action. Currently nothing in `lib/ai/` touches SEO metadata at all; the theme's `theme.liquid`/product templates would need slots for it.
- **Inline AI copy suggestions** — today AI rewrite is a popover you invoke per selection (`AiRewritePopover.tsx`); a lighter-weight "suggest 3 alternatives as you edit" affordance (ghost-text style, like inline autocomplete) would lower the friction to iterate on copy.
- **AI store-assistant / chat widget** — generate a basic FAQ/chat widget section pre-populated with product-specific answers (shipping, returns, sizing) derived from the imported product data. New section + new AI generator module, no existing analog.
- **Competitor gap analysis** — the competitor-import path already scrapes a competitor's store (`lib/product/*`); today that's only used to seed sections/copy. A second mode — "show me what my store is missing vs. this competitor" — would surface a structured comparison (sections present/absent, price positioning, imagery style) as a standalone report before generation, reusing the discovery/extractor/normalizer pipeline you already have.

### B. Product Analysis (currently has two placeholder checks)

- **Real trend data** — replace `checks/trends.ts`'s fixed score-of-60 with an actual signal (Google Trends API, or a simpler proxy like search-volume estimate from the existing `search-fallback/` web-search calls). This is explicitly called out in the code as the intended next step.
- **Real review aggregation** — replace `checks/reviews.ts`'s fixed score-of-65 by actually pulling review count/rating at import time where the source exposes it (Amazon/Etsy product pages often have this in the scraped HTML already fetched by `lib/product/suppliers/*`) instead of a separate provider integration.
- **Pre-publish readiness checklist** — a new check pass run before "Publish to Shopify": empty/placeholder sections, missing product images, unwritten policy pages, broken internal links. Natural extension of the existing `analysis/` scoring pattern, run against the *store* instead of the *product*.

### C. Editor & visual experience

- **Global brand kit** — one settings surface for site-wide fonts/color palette/spacing applied everywhere in one action, instead of the current per-section "magic brush" (`lib/editor/magic-brush.ts`) which restyles one section at a time. Would sit on top of the existing `settings_schema.json`/`settings_data.json` resolution already used for theme settings.
- **Mobile/tablet preview toggle** — `PreviewFrame.tsx` renders a single fixed-width iframe today; a breakpoint switcher (desktop/tablet/mobile) is a comparatively small addition (resize the iframe + re-check responsive CSS) with high visible value since most traffic to these stores will be mobile.
- **Version diff view** — `HistoryPanel.tsx` currently restores a whole checkpoint from `lib/history/checkpoint.ts`'s snapshots; a side-by-side "what changed between this checkpoint and now" view (even a simple JSON-diff of the Store Configuration) would make history genuinely useful for recovering from one bad AI rewrite instead of an all-or-nothing revert.
- **Client review/comment mode** — the public preview link (`PublicLinkModal.tsx`, token-based, unauthenticated) currently only lets someone *view* a theme. Letting a client leave comments pinned to a section (no edit rights) would turn that link into a lightweight approval workflow — a natural next step once any auth model exists, since comments need to be attributed to someone.

### D. Commerce & import

- **Multi-product / catalog stores** — the entire pipeline (`Product`, `Project`, generation, analysis) is scoped to a single product today. Supporting an initial catalog of several related products (e.g. a starter collection) is a significant but high-leverage expansion — it's the difference between "single-product landing page generator" and "store builder."
- **More suppliers** — AliExpress and CJ Dropshipping are the natural next additions given the dropshipping-adjacent positioning implied by Amazon/Etsy support; the `lib/product/suppliers/` pattern (parser + `search-fallback/` as safety net) is already reusable per-supplier.
- **CSV / Shopify product export import** — a bulk-import path for a merchant migrating an existing product catalog wholesale, bypassing per-URL scraping entirely.
- **App/embed recommendations** — after publish, suggest and help install common Shopify apps (reviews, email capture, upsell) relevant to the store's category — currently `MediaPanel.tsx`'s "Reviews" tab is an honest empty state precisely because no such integration exists yet; this would be one way to fill it.

### E. Post-launch & growth

- **Post-publish analytics** — pull basic traffic/conversion data back from the connected Shopify store (Admin API already integrated in `lib/shopify/`) into a simple dashboard, closing the loop from "we built you a store" to "here's how it's doing."
- **Usage/spend dashboard** — `lib/ai/debug-logger.ts` already logs every AI request with token/cost detail to disk; surfacing that as a per-project or per-day aggregate view is mostly a read-side feature on data you're already capturing, and pairs naturally with adding the rate-limit/spend-cap fix from the Critical issues above.
- **Agency/white-label mode** — if multiple clients per operator is a real use case, a lightweight "workspace" grouping of stores (distinct from full multi-tenant auth) could ship before the full Org/Role model.

### F. Foundational (not new features, but unblock the above)

- **Close the auth gap** — even a minimal single-user-per-store session model unblocks client-comment mode (D above needs attribution) and is the prerequisite for any real multi-tenant/agency feature.
- **Finish and commit the Icon Picker** — already functionally complete; committing it clears the working tree before starting new work.
- **Component test coverage** — zero tests exist for `components/`; the editor's stateful pieces (undo/redo, autosave conflict handling, selection resolution) are exactly what regresses silently without them, especially once new editor features (brand kit, mobile preview, diff view) start touching the same state.
