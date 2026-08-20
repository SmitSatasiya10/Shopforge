# 02 — Dropmagic Feature Analysis

## 0. Method and Status Legend

This is a feature inventory of Dropmagic, strictly grounded in `research-dropmagic.md` (research date 2026-08-19). No feature is listed unless it appears in that research; where the research explicitly states something could not be verified, it is listed here as **UNKNOWN — not publicly documented** rather than omitted, because the gap itself is informative for Shopforge's planning.

Each row is marked with one of:

| Status | Meaning |
|---|---|
| **Confirmed** | Directly fetched/read from a primary source (Dropmagic's own site/terms, or a substantive independent review), tagged `[VERIFIED]` in the source research. |
| **Reported (unverified)** | Claimed via search-engine snippet, third-party aggregator, or Dropmagic's own self-authored marketing/comparison copy — not independently confirmed. Covers the source research's `[SELF-REPORTED]` and `[SEARCH-SNIPPET]` tags. |
| **Conflicting** | Two or more sources disagree, or the claim is contradicted elsewhere in the research. Tagged `[UNVERIFIED/CONFLICTING]` in the source. |
| **UNKNOWN — not publicly documented** | The research explicitly could not find or confirm this at all (`NOT PUBLICLY VERIFIABLE`). |

Citations point to the specific source(s) named in `research-dropmagic.md`.

---

## 1. Authentication

| Feature | Status | Detail | Source |
|---|---|---|---|
| Sign-in / account system | Confirmed (existence only) | App lives at a separate subdomain, `app.dropmagic.ai`, with a `signin` route (`app.dropmagic.ai/signin`) and a `get-started` route. | [VERIFIED] dropmagic.ai nav |
| Auth mechanism (email/password, OAuth, magic link, SSO) | UNKNOWN — not publicly documented | `app.dropmagic.ai` is a JS web app that could not be rendered/fetched by research tooling; no signup/login flow detail was accessible. | NOT PUBLICLY VERIFIABLE |
| Shopify OAuth connection (store linking) | Reported (unverified) | Inferred to exist because publishing requires a "connected Shopify store," but the specific OAuth flow, scopes requested, and consent screen were never observed. | [INFERENCE] from consistent multi-source "publish to Shopify" description |
| OAuth scopes requested by the Shopify app connection | UNKNOWN — not publicly documented | No App Store listing page rendered permission/scope details in any fetch attempt. | NOT PUBLICLY VERIFIABLE |
| Minimum required Shopify plan to use Dropmagic | UNKNOWN — not publicly documented | No source specified a minimum required Shopify plan (e.g., whether Basic is sufficient). | NOT PUBLICLY VERIFIABLE |

---

## 2. Onboarding

| Feature | Status | Detail | Source |
|---|---|---|---|
| Product URL import ("Magic Import") | Confirmed (existence) / Reported (mechanics) | Paste a product URL from AliExpress, Amazon, Alibaba, or an existing Shopify product page; scrapes titles, images, specs, reviews. | [VERIFIED] homepage tagline for the concept; [SELF-REPORTED/SEARCH-SNIPPET] for scraping mechanics |
| Store-concept prompt/questionnaire (describe niche, audience, style instead of a URL) | Reported (unverified) | Alternative onboarding path described in marketing/reviews. | [SELF-REPORTED/SEARCH-SNIPPET] |
| AI analysis of product category, features, audience, price point, competitive positioning | Reported (unverified) | Claimed as part of the import step. | [SELF-REPORTED/SEARCH-SNIPPET] |
| Supplier integrations beyond raw URL scraping (DSers, Spocket, Zendrop, AutoDS) | Reported (unverified, single-source) | Listed by one source summary (buildyourstore.ai) only; not independently corroborated elsewhere. | [SEARCH-SNIPPET, single-source — treat cautiously] |
| Full competitor-store import/clone (entire existing store's design/layout, not just one product) | UNKNOWN — not publicly documented | All sources describe single-product-URL import, never full competitor-store cloning. | NOT PUBLICLY VERIFIABLE |
| Brand info input fields (name, logo upload, brand voice, etc.) | UNKNOWN — not publicly documented | No screenshot or step-by-step onboarding walkthrough of the actual signup wizard was accessible. | NOT PUBLICLY VERIFIABLE |
| Goals input (e.g., "validate a product" vs. "scale an existing brand") | UNKNOWN — not publicly documented | No specific onboarding UI/form-field detail found. | NOT PUBLICLY VERIFIABLE |
| Industry/niche selection UI | UNKNOWN — not publicly documented | Only high-level narrative claims exist (e.g., "adapts every word to speak to that persona"), no actual form/UI described. | NOT PUBLICLY VERIFIABLE |
| Target-audience input | Reported (narrative only) | Marketing narrative claims copy is adapted "to speak to that persona," implying some audience input exists, but the actual input mechanism (dropdown, free text, inferred from product) is undocumented. | [SELF-REPORTED, narrative-level only] |
| Language selection | Confirmed (capability exists) | Multilingual copy generation confirmed on homepage; but the onboarding-step UI for selecting a language was not described. | [VERIFIED] homepage (capability); UNKNOWN for the specific onboarding UI |
| Design-preference input (style, layout preference, color preference at onboarding time) | UNKNOWN — not publicly documented | Not described by any source; branding is described as AI-selected post-generation, not as an onboarding input. | NOT PUBLICLY VERIFIABLE |
| Exact onboarding UI structure (screens, field order, wizard steps) | UNKNOWN — not publicly documented | Search explicitly failed to surface a screenshot of the sign-up/onboarding form. | NOT PUBLICLY VERIFIABLE |
| Free tier access (no credit card, permanent free plan) | Confirmed (majority view) | Consistent across multiple dropmagic.ai pages. One aggregator (slashdot.org) instead frames it as "$79/month starting price, free trial available," conflicting with this — treated as the aggregator likely mischaracterizing the model. | [VERIFIED/SELF-REPORTED] majority of dropmagic.ai pages; [UNVERIFIED/CONFLICTING] slashdot.org |

---

## 3. AI Generation

### 3.1 Store / Page Generation

| Feature | Status | Detail | Source |
|---|---|---|---|
| Full store generation from one product URL (homepage, product page, About, FAQ, legal pages) | Reported (unverified, but consistent) | Claimed consistently across marketing and independent reviews. | [SELF-REPORTED / SEARCH-SNIPPET, consistent] |
| Generation speed: "2 minutes" | Conflicting | Homepage tagline figure. | [SELF-REPORTED/CONFLICTING] dropmagic.ai homepage |
| Generation speed: "under 5 minutes" | Conflicting | Different figure used on a different Dropmagic page — inconsistent with the "2 minutes" tagline. | [SELF-REPORTED/CONFLICTING] dropmagic.ai |
| Real hands-on generation time (independent test) | Confirmed | "Fully branded product page in about two minutes," but reviewer notes true launch-readiness needs "an hour or two cleaning up copy and trimming sections." | [VERIFIED] buildyourstore.ai — most credible hands-on account found |
| Mobile/responsive optimization by default | Confirmed | Stated directly on homepage. | [VERIFIED] dropmagic.ai homepage |
| Per-store unique design (vs. one shared theme template across all generated stores) | Reported (unverified) | Claimed differentiator vs. cheaper AI-store-builder peers (e.g., Atlas AI, BuildYourStore, which reportedly reuse the same theme across stores). | [SELF-REPORTED comparison table, partially corroborated by an independent review's comparison table] |

### 3.2 Copywriting

| Feature | Status | Detail | Source |
|---|---|---|---|
| Persona-targeted copywriting (headlines, descriptions, CTAs) | Reported (unverified) | Marketing claims copy is "trained on 8-figure brand strategies." | [SELF-REPORTED] |
| Product descriptions | Reported (unverified) | Bundled under full store generation claims. | [SELF-REPORTED / SEARCH-SNIPPET] |
| Headlines / CTA copy | Reported (unverified) | Bundled under persona-targeted copywriting claim. | [SELF-REPORTED] |
| FAQ generation | Reported (unverified) | Listed among the pages generated as part of "full store generation." | [SELF-REPORTED / SEARCH-SNIPPET] |
| Multilingual copy generation | Confirmed | Stated directly on homepage. | [VERIFIED] dropmagic.ai homepage |
| "Unlimited" AI copywriting (Pro tier) | Reported (unverified) | Listed as a Pro-tier ($79/mo) inclusion. | [SEARCH-SNIPPET, consistent across sources] |

### 3.3 SEO

| Feature | Status | Detail | Source |
|---|---|---|---|
| SEO metadata / "SEO-optimized descriptions" | Reported (unverified) | Claimed capability, no technical detail (no evidence of what metadata fields are actually populated, meta title/description generation specifics, structured data, etc.). | [SEARCH-SNIPPET] |

### 3.4 Image Generation / Enhancement

| Feature | Status | Detail | Source |
|---|---|---|---|
| AI image generation | Reported (unverified, but consistent) | Credit-limited: 2 free credits, 30 on Pro tier/month. | [SEARCH-SNIPPET, consistent across sources] |
| Image enhancement (vs. pure generation) | UNKNOWN — not publicly documented | No source distinguished "enhance an imported product photo" from "generate a new image from scratch"; both may be bundled under "AI image generation" without detail. | NOT PUBLICLY VERIFIABLE |

### 3.5 Branding

| Feature | Status | Detail | Source |
|---|---|---|---|
| AI-selected color palette | Confirmed | Stated on homepage. | [VERIFIED] dropmagic.ai homepage |
| Fonts / typography selection | Confirmed | Stated on homepage. | [VERIFIED] dropmagic.ai homepage |
| Logo / icon concept generation | Reported (unverified) | Detail-level claim from Dropmagic's own detail pages, not corroborated independently. | [SELF-REPORTED] detail pages |

### 3.6 Layout / Conversion / Upsell / Bundle Suggestions

| Feature | Status | Detail | Source |
|---|---|---|---|
| Upsell/bundle suggestions | Conflicting | Claimed **only** by a single low-quality AI-tool-directory listing (aitoolsforest.com); directly contradicted by an independent reviewer who states Dropmagic has **no built-in upsell features**. | [UNVERIFIED/CONFLICTING — likely inaccurate/templated content] |
| "Checkout Optimizer" | Conflicting | Same single low-quality directory source; no other source mentions it; contradicted by the same independent reviewer's "no CRO tooling" statement. | [UNVERIFIED/CONFLICTING — likely inaccurate] |
| Analytics dashboard | Conflicting | Same single low-quality directory source, uncorroborated elsewhere. | [UNVERIFIED/CONFLICTING — likely inaccurate] |
| SOC 2 / AES-256 security certification claims | Conflicting | Same single low-quality directory source; no independent corroboration of formal certification. | [UNVERIFIED/CONFLICTING — likely inaccurate] |
| A/B testing | Reported (unverified, single self-authored source) | Claimed only in one of Dropmagic's own comparison pages; not corroborated elsewhere. | [SELF-REPORTED, not corroborated elsewhere] |
| Post-launch AI-driven trending-product suggestions | Conflicting | Claimed by one review; directly contradicted by another (buildyourstore.ai) explicitly calling Dropmagic a "one-shot generator with no post-launch optimization." | [UNVERIFIED/CONFLICTING] |
| Automated price sync with suppliers | Conflicting | Same conflict as above — claimed by one review, contradicted by buildyourstore.ai's "one-shot generator" characterization. | [UNVERIFIED/CONFLICTING] |
| Automatic currency/unit conversion (USD pricing, imperial units) | Reported (unverified, single source) | Mentioned in one workflow guide only. | [SEARCH-SNIPPET, single source] |

---

## 4. Visual Editor

| Feature | Status | Detail | Source |
|---|---|---|---|
| Proprietary drag-and-drop visual editor (separate from Shopify's native theme editor) | Reported (unverified) | Used during the pre-publish "build" phase. | [SELF-REPORTED, not independently confirmed with a screenshot or hands-on walkthrough] |
| Editor infrastructure: "hosted on Framer's infrastructure" | Conflicting / single-source | One independent review's technical claim; not corroborated anywhere else; directly at odds with the "proprietary, independent editor" framing on Dropmagic's own pages (not necessarily contradictory — build tool vs. output could differ — but neither is confirmed technically). | [SEARCH-SNIPPET, single source (buildyourstore.ai), NOT corroborated elsewhere] |
| Full control over sections/layout/content | Reported (unverified) | Marketing/review claim. | [SELF-REPORTED / SEARCH-SNIPPET] |
| Drag-and-drop reordering | Reported (unverified) | Marketing/review claim. | [SELF-REPORTED / SEARCH-SNIPPET] |
| Text/image inline editing | Reported (unverified) | Marketing/review claim. | [SELF-REPORTED / SEARCH-SNIPPET] |
| Adjustable spacing controls | Reported (unverified) | Marketing/review claim. | [SELF-REPORTED / SEARCH-SNIPPET] |
| 50–57+ pre-built section types | Reported (unverified) | Figure varies slightly by source (50 vs. 57+). | [SELF-REPORTED / SEARCH-SNIPPET] |
| Editor limitation: no pixel-level control over every element | Confirmed | Explicitly stated by an independent reviewer. | [VERIFIED] buildyourstore.ai |
| Editor limitation: pages can look "sectioned and content-heavy," sometimes requiring manual cleanup | Confirmed | Explicitly stated by a second independent reviewer. | [VERIFIED] ecommerce-platforms.com |
| Editor UI chrome (canvas/sidebar/inspector/toolbar layout) | UNKNOWN — not publicly documented | No source described the editor's literal UI structure — all descriptions are capability-level only. | NOT PUBLICLY VERIFIABLE |
| Undo/redo | UNKNOWN — not publicly documented | Not described anywhere in the research. | NOT PUBLICLY VERIFIABLE |
| Device preview switcher (desktop/tablet/mobile) | UNKNOWN — not publicly documented | Not described anywhere in the research beyond the general "mobile/responsive optimization by default" claim. | NOT PUBLICLY VERIFIABLE |
| Global settings panel | UNKNOWN — not publicly documented | Not described anywhere in the research. | NOT PUBLICLY VERIFIABLE |
| Save / loading / autosave states | UNKNOWN — not publicly documented | Not described anywhere in the research. | NOT PUBLICLY VERIFIABLE |

---

## 5. Shopify Integration Signals

| Feature | Status | Detail | Source |
|---|---|---|---|
| Standalone build tool that outputs/publishes to a Shopify store (vs. an embedded admin app for ongoing editing) | Reported (inference) | Based on consistent multi-source description of build happening on `app.dropmagic.ai`, then a "publish" step to a connected store. | [INFERENCE] from consistent multi-source description |
| Editing an existing, already-live Shopify store's theme in place | UNKNOWN — not publicly documented (and effectively unsupported per all available evidence) | No source describes this workflow; all describe generating a new store. | NOT PUBLICLY VERIFIABLE / absent from every source examined |
| Output format: standard Liquid theme code | UNKNOWN — not publicly documented | Not documented anywhere found. | NOT PUBLICLY VERIFIABLE |
| Output format: Online Store 2.0 JSON templates | UNKNOWN — not publicly documented | Not documented anywhere found. | NOT PUBLICLY VERIFIABLE |
| Output format: proprietary renderer exported to Shopify | Reported (single-source, unverified) | Only the "Framer infrastructure" claim gestures at this, and it's unverified/single-source. | [SEARCH-SNIPPET, single source — do not treat as fact] |
| "One-click" / "direct Shopify integration" publishing | Reported (unverified) | Described this way in marketing/reviews. | [SEARCH-SNIPPET] |
| Published store runs "natively on Shopify," fully owned, "no vendor lock-in" | Reported (single-source) | Only one review (buildyourstore.ai) makes this explicit claim. | [SEARCH-SNIPPET via buildyourstore.ai — only source] |
| Custom domain connection via DNS (~2 minutes, no extra fee, requires paid plan) | Reported (unverified) | Single-source detail. | [SEARCH-SNIPPET] |
| Shopify App Store category | Reported (unverified) | "Page builder" / store design. | [SEARCH-SNIPPET] appnavigator.io |
| Shopify App Store rating (~4.9/5) | Reported (unverified) | Direct fetch of the listing returned a JS-rendering placeholder in every attempt; figure comes from search snippets/aggregators only. | [SEARCH-SNIPPET only — not VERIFIED despite high consistency] |
| Shopify App Store review count | Conflicting | Reported inconsistently as 43, 46, or 54 depending on source/date; likely just different scrape dates rather than a real conflict, but no single number was directly verifiable. | [UNVERIFIED/CONFLICTING exact count] |
| "120,000+ stores generated" | Conflicting (different metric from below) | From one review-derived search summary; not independently confirmable. | [SEARCH-SNIPPET] |
| "Trusted by 50,000+ happy customers" | Confirmed (claim exists on the page, not independently audited) | Directly fetched from Dropmagic's own inspiration page — note this is a different metric than "stores generated," not necessarily contradictory, but neither figure is independently audited. | [VERIFIED fetch of the claim itself] dropmagic.ai/inspiration |
| App Store rank ("#14,466" overall, per one aggregator) | Reported (unverified, low confidence) | Single aggregator, no corroboration. | [SEARCH-SNIPPET, low confidence] |

---

## 6. Pricing / Billing

| Feature | Status | Detail | Source |
|---|---|---|---|
| Free plan: $0/month, unlimited store/product generation and preview, 2 AI image credits/month, cannot publish to Shopify | Reported (unverified, but highly consistent) | Consistent across ≥4 independent sources. | [SEARCH-SNIPPET, consistent across ≥4 independent sources] |
| Pro plan: $79/month | Reported (unverified, but highly consistent on price) | Only paid tier found; no mid-tier. Includes unlimited AI copywriting, 30 AI image credits/month, 50–57+ sections, one free `.store` domain, publishing enabled, and (per one source only) a "Bundle app." | [SEARCH-SNIPPET, consistent on price; feature list varies slightly by source] |
| Mid-tier plan between Free and Pro | UNKNOWN — not publicly documented | No source mentioned one existing. | NOT PUBLICLY VERIFIABLE |
| Refund policy: 7-day window, one-live-store-max condition, immediate Pro-access revocation on refund, no partial-period refunds, 72-hour cancellation window for renewal refund eligibility | Confirmed | Directly read from Dropmagic's own Terms of Service. | [VERIFIED] dropmagic.ai/legal/terms |
| Auto-renewing subscription | Confirmed | Directly read from Terms of Service. | [VERIFIED] dropmagic.ai/legal/terms |
| Separate "generation credits" / "copy credits" beyond AI image credits | UNKNOWN — not publicly documented | May simply be undocumented rather than nonexistent. | NOT FULLY VERIFIABLE |
| Real "all-in" minimum monthly cost (Dropmagic Pro + Shopify Basic) | Confirmed | ~$118/month minimum ($79 Dropmagic Pro + $39 Shopify Basic), excluding product/ad spend — direct quote from an independent reviewer. | [VERIFIED] ecommerce-platforms.com-sourced buildyourstore.ai fetch |
| Conflicting trial-model characterization ("$79/month starting price, free trial available") | Conflicting | One aggregator (slashdot.org) frames pricing this way, conflicting with the majority "permanent free tier" framing used elsewhere. | [UNVERIFIED/CONFLICTING] slashdot.org |

---

## 7. Company / Legal Basics

| Feature | Status | Detail | Source |
|---|---|---|---|
| Operating entity | Confirmed | Operated by LBND, a French company, SIREN 903 347 425; disputes governed by French law/courts. | [VERIFIED] dropmagic.ai/legal/terms |
| Shopify App Store developer profile (apps.shopify.com/partners/lbnd) | Conflicting/unresolved | Direct fetch showed 0 apps listed — likely a rendering/geo issue with the fetch tool, since search snippets and third-party trackers independently corroborate an active, well-reviewed listing. | [VERIFIED fetch result, but contradicts SEARCH-SNIPPET evidence — flagged as unresolved] |
| Non-Shopify platform support (WooCommerce/BigCommerce) | Not credible / excluded | Claimed by one review site only (ecommerceparadise.com), conflicting with every other source stating Dropmagic is Shopify-only; reads as possibly mismatched/generic content. | Excluded from confident findings; flagged as unreliable |

---

## 8. Most Significant Open Questions About Dropmagic's Actual Technical Implementation

These are the gaps the research could not close. They are still worth tracking as competitive context, though they matter differently than they once did: earlier planning ranked them by how much they'd change Shopforge's read on one specific axis — whether Dropmagic could edit an already-live store in place — that Shopforge no longer competes on (Shopforge has since adopted its own generation-first, new-store architecture; see doc 01 §4). Ranked below by general relevance to understanding Dropmagic as a competitor:

1. **What does the published store's theme code actually look like?** Standard Liquid, Online Store 2.0 JSON templates, or a proprietary format exported/transpiled into Shopify? This is the single biggest unknown — it determines whether a Dropmagic-generated store is genuinely "native Shopify, no lock-in" (as one review claims) or has a hidden runtime/format dependency (as the single "Framer infrastructure" claim would suggest, if true). No source resolves this. It is also now the clearest point of contrast with Shopforge's own architecture, where the preview-time Liquid is, by construction, the same Liquid that publishes (doc 01 §4).
2. **Can Dropmagic ever operate on an already-live, already-selling Shopify store's existing theme?** Every source describes a build-then-publish-to-a-new-store flow. Whether this is a hard structural limitation (by product design) or simply an undocumented/unmarketed capability could not be determined — but the total absence of any source describing in-place editing of an existing store, despite deep coverage of onboarding/editing/publishing, strongly suggests it is not supported. This question mattered most under Shopforge's earlier "edit an existing theme" architecture; under the current generation-first architecture Shopforge doesn't compete on this axis either, but the finding remains useful competitive context — it confirms Dropmagic, like Shopforge, is fundamentally a new-store generation pipeline, not an existing-theme editor.
3. **What actually happens after publish?** Direct contradiction between "automated price updates from suppliers + AI-driven trending product suggestions" (one review) and "one-shot generator with no post-launch optimization, no review mining, no ad creatives, no CRO tools" (an independent, more detailed review). This bears directly on whether Dropmagic is a launch tool only or an ongoing store-management tool.
4. **Are the CRO/upsell/analytics/security-certification claims (Checkout Optimizer, analytics dashboard, SOC 2, AES-256) real or hallucinated/templated content from a low-quality directory listing?** They are contradicted by a more detailed independent review and appear nowhere else — if false, they meaningfully overstate Dropmagic's competitive surface relative to actual CRO-category tools (PageFly, Shogun).
5. **What are the actual OAuth scopes and minimum Shopify plan requirement?** Unknown; relevant to understanding how deep Dropmagic's Shopify access/integration actually is, and what a merchant is exposing by connecting their store.
6. **What is the editor's real UI structure?** No source describes canvas/sidebar/inspector/toolbar layout, undo/redo, device-preview switching, or save/loading states — only capability-level claims exist. This limits any UI-level competitive comparison to Shopforge's own editor spec.
7. **What are the true install/review counts on the Shopify App Store?** All numeric App Store signals (rating, review count, rank) rest on search snippets or aggregators because direct fetches of the listing consistently returned client-rendered placeholders — the actual current numbers are unverified.
8. **Does a mid-tier pricing plan exist between Free ($0) and Pro ($79/mo)?** No source mentions one, but the binary free/paid structure with no stated usage-based scaling in between is itself a notable and unconfirmed data point about how Dropmagic monetizes larger users.
