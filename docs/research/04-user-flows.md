# 04 — User Flows

## 1. Purpose and scope

This document is the single source of truth for the **end-to-end Shopforge user journey** — every screen a user passes through from first landing on the marketing site to iterating on a published, live Shopify store. It exists to make one thing unambiguous before any UI or API work starts: **Shopforge's front door is "give us a product URL and we generate a store you can preview and edit before anything touches Shopify," not "connect an existing store and let us parse its theme."** The latter was this product's original positioning; it is retired for MVP (see §2). Every screen below reflects the current architecture: a product URL seeds AI-generated content, the AI arranges that content using a fixed library of sections we own and maintain (never sections it invents), and the result is a real, live-rendered preview the user can point-and-click edit — with Shopify entering the picture only when the user is ready to publish.

Every step below uses the same sub-structure — User Action, System Action, AI Action, Data Required, API/Integration, UI Required, Validation, Error States, Loading States, Empty States, Success State — so any step can be scanned in isolation. Data entities referenced are the canonical names introduced by doc 08 (Store Configuration Schema) and doc 17 (Database Model); API groups follow the canonical grouping convention used across docs 06/09/16/18.

## 2. Divergence from Dropmagic — at a glance

Per the Dropmagic research file (`research-dropmagic.md`), Dropmagic's own marketing and independent reviews consistently describe a **generate-from-scratch** flow: paste a product URL (AliExpress/Amazon/Alibaba/Shopify) or describe a niche → AI drafts a brand-new store on a proprietary editor → publish to a *new* Shopify store **[VERIFIED]** (dropmagic.ai homepage). Shopforge's MVP now follows the same overall shape — product URL or description in, AI-generated store out. That is a deliberate, honest repositioning, not an accident: parsing and minimally editing an arbitrary existing merchant theme (this document's previous primary journey) is no longer in scope. Doc 01 covers the reasoning behind that call; this document does not repeat it, only reflects it.

Given that convergence, the differentiators worth documenting are no longer about *whether* Shopforge generates a store from a product URL — it does, same as Dropmagic. They are about what happens *around* that generation: what the AI is and isn't allowed to touch, how faithfully the user can preview the result before it's live, and what "editing" means once a store exists.

| Dimension | Dropmagic (per research) | Shopforge |
|---|---|---|
| Entry point | Paste a product URL or describe a niche **[VERIFIED/SELF-REPORTED]** | Same shape: paste a **Product URL** (primary) or describe the product/store in text (secondary, §5) — Shopforge no longer differentiates here. This is a deliberate structural match, not a coincidence (§4 Step 2). |
| What the AI generates | Drafts all copy/sections/branding from nothing on a proprietary editor; whether it ever writes/edits underlying theme code directly is **NOT PUBLICLY VERIFIABLE** (research §6) | AI generates **structured configuration and copy only** — Section Selection, Section Ordering, Section Settings/Content (§4 Steps 6–7) — against a fixed, human-authored **Section** library (doc 07, ~40–60 sections). The AI never writes Liquid, CSS, or JS. Every generated store is assembled from the same maintained, audited section set, not open-ended code generation. This is the sharpest remaining architectural divergence. |
| Preview fidelity | Editor described as a separate, proprietary build surface ("hosted on Framer" per one low-confidence source, research §5); rendering fidelity versus the eventual live Shopify storefront is **NOT PUBLICLY VERIFIABLE** | Preview is a real render, not a recreation: the **LiquidJS Preview Renderer** (doc 09) executes the same Section Liquid templates that ship to the live store, inside a **Same-Origin Preview iframe** (§4 Step 9). What the user edits is the same rendering path as the published storefront, live, without needing a Shopify connection. |
| Output ownership / code quality | Marketing claims ~57+ section types with no visibility into authorship or ongoing maintenance **[SELF-REPORTED, NOT PUBLICLY VERIFIABLE beyond the count]** | Every section in the library is written and maintained by Shopforge (doc 07) — a fixed, versioned, quality-controlled catalog rather than per-store generated code. A fix or improvement to one section benefits every store built on it. |
| Editing model | Editor UI chrome, field-level controls, and state model are **NOT PUBLICLY VERIFIABLE** (research §6) beyond drag-and-drop/text/image/spacing marketing claims | Click-to-select and `contentEditable` directly on the rendered preview DOM, mapped back to `Page → Section ID → Block ID → Setting` in the **Store Configuration** (doc 06/08) — one JSON source of truth, no separate "builder state" divorced from what's rendered (§4 Steps 10–11). |
| Publish gating | Free tier reportedly cannot publish at all; publish requires the $79/mo Pro tier **[SEARCH-SNIPPET, consistent across ≥4 sources]** | Converges deliberately: building and previewing are free and require no Shopify connection at all; connecting Shopify and publishing is the plan-gated action (doc 22). This mirrors Dropmagic's own gate placement intentionally — it is no longer a point of difference. |
| Post-launch editing | One independent reviewer explicitly describes it as a "one-shot generator with no post-launch optimization" **[VERIFIED, buildyourstore.ai, though contradicted by a lower-confidence source — research §3, §11]** | Still the differentiator: publish is a checkpoint, not an endpoint. The Visual Editor, AI-assisted editing, and Version History all remain available after publish and are the expected steady-state loop (§4 Step 17). |

Everywhere below that a step exists *because* Shopforge diverges from Dropmagic's model, it is called out inline with a **Diverges from Dropmagic** note. Where a step is a deliberate point of *convergence*, it is called out the same way so the distinction doesn't get lost.

## 3. Entry point(s)

The old two-path framing — "connect an existing store" versus "start a new store" — no longer describes the product. There is no arbitrary-existing-theme import to branch around, so there is nothing left for a second path to be an alternative *to*. The real entry point is uniform: **tell Shopforge about a product**, either by pasting a URL or by describing it in text. Both inputs feed the identical downstream pipeline from Product Import/AI Generation onward; they differ only in how the initial **Product Data** record gets populated (scraped vs. AI-drafted from a description — see §5).

```
                        ┌─────────────────────┐
                        │       Landing        │
                        └──────────┬───────────┘
                                   ▼
                    ┌───────────────────────────────┐
                    │   Tell us about the product     │
                    │  ┌───────────┐   ┌───────────┐ │
                    │  │ Product URL│   │ Describe it│ │
                    │  │ (default)  │   │ instead    │ │
                    │  └─────┬─────┘   └──────┬─────┘ │
                    └────────┼────────────────┼───────┘
                              ▼                ▼
                     Sign up / Login (gate before any generation work begins)
                                   │
                     ┌─────────────┴─────────────┐
                     ▼                             ▼
            Product Import (scrape)      AI-drafted Product Data (§5)
                     └─────────────┬─────────────┘
                                   ▼
                        BOTH CONVERGE HERE:
                  AI Generation → Store Configuration → Visual Editor → …
```

The Product URL mode is the default and primary path, documented in full in §4. The description-only mode (§5) is a real, deliberately supported secondary entry — a merchant may not have a specific product page yet (pre-launch product, a niche rather than a single SKU) — but it is explicitly a **thin input variant that re-enters the same pipeline as §4 at the AI Generation step**, skipping only the scrape. Shopforge never has a separate "editor" or "output format" for stores built from a description versus a URL; from AI Generation onward, both look identical.

One deliberate design choice worth naming here: **the Product URL/description step is reachable before sign-up**, and sign-up is gated immediately after it, before Product Import consumes any generation work. This lowers the friction of the product's actual hook (see what a URL turns into) while still gating the costly steps (scraping, AI generation) behind an authenticated `User`/`Organization`, reflecting a cost-aware-AI design goal — nothing that costs Shopforge money runs for an anonymous visitor.

## 4. Primary journey — product URL to published store

### Step 1 — Landing

| Aspect | Detail |
|---|---|
| User action | Arrives at marketing site (organic, ad, referral) and reads value proposition |
| System action | Serves static/marketing page; tracks acquisition source for attribution |
| AI action | None |
| Data required | None (unauthenticated) |
| API/integration | None (marketing site is not app-backed) |
| UI required | Hero messaging centered on "paste a product link, get a live store to preview in seconds" with an inline URL field directly in the hero (not a separate page) — the field is the primary CTA, not a button that leads to one |
| Validation | N/A |
| Error states | N/A |
| Loading states | Standard page load; no app-shell wait |
| Empty states | N/A |
| Success state | User submits a URL (or clicks "describe it instead") and proceeds to Step 2 |

### Step 2 — Product URL Input (or describe instead)

| Aspect | Detail |
|---|---|
| User action | Pastes a product page URL (Shopify, AliExpress, Amazon, or another supported storefront/marketplace — doc 07 for the supported-source list) into the hero field; or toggles to "describe it instead" and writes a short free-text description of the product/store concept |
| System action | Validates the URL is well-formed and reachable; holds the input in session/local state — no `Project` or `ProductData` record is created yet, since the user isn't authenticated |
| AI action | None yet |
| Data required | Raw URL string or description text, held client-side/in an unauthenticated session, not yet persisted |
| API/integration | Lightweight URL-reachability pre-check only (`/import/*` — validate-url); no scrape yet |
| UI required | Single field with a mode toggle (URL / describe instead); inline "checking link…" affordance on submit; no separate onboarding page — this *is* the onboarding surface |
| Validation | URL syntactically valid and resolves (HTTP reachable); description mode requires a minimum length to be useful to Step 6's generation |
| Error states | Malformed URL (inline validation, no round-trip needed); unreachable URL (network/DNS failure) — user can retry or switch to describe-instead |
| Loading states | Brief "checking link…" spinner on the pre-check call |
| Empty states | N/A |
| Success state | Input accepted; user proceeds to Step 3 with the URL/description carried forward |
| **Diverges from Dropmagic** | This is a deliberate point of convergence, not divergence — see §2 row 1. Shopforge's entry point is now structurally identical to Dropmagic's reported entry point. The only judgment call unique to Shopforge here is holding the input pre-auth and gating the expensive work (scrape + generation) behind Step 3, rather than either running generation anonymously or requiring signup before the user has seen anything. |

### Step 3 — Sign up / Login

| Aspect | Detail |
|---|---|
| User action | Chooses email/password signup, email/password login, or an OAuth-based identity option; the pending URL/description from Step 2 is shown as "your product" context on the auth screen so the transition doesn't feel like a detour |
| System action | Creates or authenticates `User`; if this is the user's first `Organization`, creates a default `Organization` + `OrgMembership` (role: owner); creates the `Project` record and attaches the Step 2 input to it as the seed |
| AI action | None |
| Data required | Email, password (or OAuth identity token), `User`, `Organization`, `OrgMembership`, `Project` |
| API/integration | Internal auth service |
| UI required | Tabbed or toggled signup/login form; password strength meter on signup; "forgot password" link on login; persistent reminder of the pending product input above the form |
| Validation | Email format, password strength/length, duplicate-email detection on signup; credential match on login |
| Error states | Invalid credentials, account already exists (signup), account not found (login), identity-provider denied/cancelled, email not verified (if verification required before proceeding) |
| Loading states | Submit button spinner while auth request is in flight |
| Empty states | N/A |
| Success state | Session established, `Project` created and carrying the Step 2 input, user routed to Step 4 |

### Step 4 — Product Import (scrape)

| Aspect | Detail |
|---|---|
| User action | Waits (or navigates away and returns later — import is async) while the submitted URL is fetched and parsed |
| System action | Fetches the product page, runs the Product Import/Scraper (doc 07's source-adapter layer) to extract structured **Product Data** — title, description, price, images, variants, vendor/brand, category — and creates a `ProductImportJob` tracking status |
| AI action | Minimal — may run light classification (e.g., inferring a product category the source page doesn't explicitly label) to help Step 6's Section Selection, not generation of copy |
| Data required | `ProductImportJob`, resulting `ProductData` (draft, unconfirmed) |
| API/integration | `/import/*` — scrape, job-status |
| UI required | Progress screen with staged messaging ("Fetching product page… Extracting details…"); can run as a background job with a dashboard notification if the user navigates away |
| Validation | Source URL must resolve to a page the adapter recognizes as a product page (not a search/category/homepage URL) |
| Error states | **Product-URL scrape/import failure** — unsupported site, page-structure change, anti-bot blocking/rate-limiting, or partial extraction — this is a first-class, expected error path, detailed in §6.1 |
| Loading states | Staged progress indicator (fetch → extract → structure); most imports complete in a few seconds, slower sources show an estimated wait |
| Empty states | N/A |
| Success state | Draft `ProductData` populated, user routed to Step 5 |
| **Diverges from Dropmagic** | Dropmagic reportedly supports scraping from several marketplaces (AliExpress/Amazon/Alibaba/Shopify) in addition to a description mode **[SELF-REPORTED]** — Shopforge's source-adapter list (doc 07) is comparable in shape, not a differentiator in itself. What differs is that every field this step extracts is shown to the user for confirmation before anything is generated from it (Step 5) — Dropmagic's product research surfaced no equivalent confirmation step **[NOT PUBLICLY VERIFIABLE]**. |

### Step 5 — Product Data Review & Confirm

| Aspect | Detail |
|---|---|
| User action | Reviews the scraped title, description, price, images, and variants; edits/corrects any field before generation begins (e.g., trims a marketplace listing's SEO-stuffed title, deselects irrelevant images) |
| System action | Renders the draft `ProductData` as an editable form/card set; persists edits back onto the same `ProductData` record |
| AI action | None (this step is a plain confirm/edit form, not an AI interaction) |
| Data required | `ProductData` (draft → confirmed) |
| API/integration | `/import/*` — get-product-data, update-product-data |
| UI required | Editable field list with the scraped values pre-filled; image picker/deselector for scraped images; clear "this is what we'll build your store from" framing |
| Validation | At minimum a title and one image must be present to proceed — if the scrape returned neither, the user is prompted to fill them in manually rather than blocked outright |
| Error states | User submits with required fields still empty (inline validation, not a hard page block) |
| Loading states | N/A (data is already fetched) |
| Empty states | Sparse scrape (e.g., missing price or variants) shows those fields as empty and clearly marked "optional — fill in if you have it," not hidden |
| Success state | User confirms; `ProductData` marked confirmed, user routed to Step 6 |

### Step 6 — AI Generation: Section Selection & Ordering

| Aspect | Detail |
|---|---|
| User action | Waits during generation; may optionally answer a short clarifying prompt if the AI's confidence in store type/tone is low (e.g., "Is this a single hero product or a full catalog store?") |
| System action | Creates a `GenerationJob`; the AI Generation pipeline selects which **Sections** from the Base Theme library (doc 07) best fit this `ProductData` (e.g., hero, product gallery, reviews, FAQ, related products) and determines their order across the store's **Pages** (Home, Product, Collection, Cart, About — as applicable) |
| AI action | Section Selection and Section Ordering (doc 10/11 for tiering) — a constrained choice over the fixed section catalog, never generation of a new section type; if the request is ambiguous enough to affect the outcome materially, the Clarification System (doc 13) surfaces a targeted question rather than guessing |
| Data required | Confirmed `ProductData`, `GenerationJob`, section catalog metadata (doc 07), in-progress `StoreConfiguration` skeleton (pages + ordered, unconfigured section slots) |
| API/integration | `/ai/*` — generate-structure, clarify-answer |
| UI required | Progress screen with staged messaging ("Choosing sections for your store… Arranging your pages…"); clarifying question (if triggered) rendered as quick-reply chips where possible |
| Validation | Every selected section must be a real, currently-published entry in the Section library (doc 07) — the Planner cannot reference a retired or draft section |
| Error states | **AI generation timeout/failure** — detailed in §6.2 |
| Loading states | Staged progress indicator; typical generation completes in well under a minute for a single-product store |
| Empty states | N/A |
| Success state | Section Selection and Ordering complete; proceeds to Step 7 |
| **Diverges from Dropmagic** | This is the step where the sharpest divergence in §2 becomes concrete: the AI's output here is a *selection* over a closed, human-authored catalog (doc 07), never a new section definition. Whatever Dropmagic's generation step produces internally is **NOT PUBLICLY VERIFIABLE**, but Shopforge's constraint is architectural and visible in this document, not a claim about a competitor. |

### Step 7 — AI Generation: Section Settings & Content

| Aspect | Detail |
|---|---|
| User action | Continues waiting (same progress screen as Step 6, later stage) |
| System action | For each selected `SectionInstance`, the AI fills in its `Setting` values and `BlockInstance` content — headline/body copy, CTA text, which product images map to which section, layout variant/style settings exposed by that section's schema (doc 07) |
| AI action | Section Settings/Content generation (doc 10/11 tiering) — copywriting and content-to-slot assignment against each section's declared schema; the AI never invents a setting the section doesn't declare |
| Data required | `GenerationJob`, section schemas (doc 07), `ProductData`, resulting populated `StoreConfiguration` |
| API/integration | `/ai/*` — generate-content |
| UI required | Continuation of Steps 6–7's progress screen, final stage ("Writing your copy…") |
| Validation | Every generated setting value must satisfy its section's schema (type, required-ness, enum options) — doc 15-equivalent validation for configuration data, not Liquid |
| Error states | Same class as §6.2 (AI generation timeout/failure) — including the partial-success case: some sections fully populated, one or two failed, in which case those sections render with a clear placeholder rather than blocking the whole store |
| Loading states | Continuation of Step 6's staged progress UI |
| Empty states | N/A |
| Success state | `StoreConfiguration` fully populated for an initial draft; proceeds to Step 8 |

### Step 8 — Store Configuration Created / Project Overview

| Aspect | Detail |
|---|---| 
| User action | Lands on a brief summary before entering the editor — what was built ("We generated a 4-page store: Home, Product, Collection, Cart, using 9 sections") |
| System action | Persists the initial `StoreConfiguration` as version 1 of the `Project`; renders a short structural summary from it |
| AI action | May generate a one-line natural-language summary of what was built (a lightweight chat call, doc 10 tiering) — purely descriptive |
| Data required | `Project`, `StoreConfiguration` (version 1), `ConfigurationVersion` |
| API/integration | `/config/*` — get-configuration (summary read) |
| UI required | Page/section count summary; single primary CTA "Open in editor" |
| Validation | N/A (read-only summary) |
| Error states | Summary-generation AI call failure degrades gracefully to a plain structural count, never blocks entry to the editor |
| Loading states | Should be instant — this reads the just-created `StoreConfiguration`, not a fresh computation |
| Empty states | N/A — Step 7 guarantees at least a minimal populated configuration exists by this point |
| Success state | User proceeds to Step 9 |

### Step 9 — Visual Editor Opens — LiquidJS Preview Render

| Aspect | Detail |
|---|---|
| User action | Watches the store render for the first time |
| System action | Loads `StoreConfiguration` version 1 into the Visual Editor (doc 06); the **LiquidJS Preview Renderer** (doc 09) renders the Base Theme's Section Liquid templates against that configuration, output into a **Same-Origin Preview iframe** as the editor canvas |
| AI action | None (rendering is deterministic) |
| Data required | `StoreConfiguration`, Base Theme Section templates (doc 07), a `PreviewSession`/render token (doc 09) |
| API/integration | `/preview/*` — render; `/config/*` — get-configuration |
| UI required | Editor shell (doc 19): canvas (the preview iframe), a Store/Page Navigator for switching between generated pages, an inspector panel, an AI panel — all specified fully in doc 06/09/19, referenced here rather than re-described |
| Validation | Preview render must succeed for every page/section in the configuration — a render failure here is surfaced per-section (§6.3), not as a blank canvas |
| Loading states | Skeleton/shimmer canvas while the first render completes; this is a real render, not a placeholder screenshot, so first paint depends on the Preview Renderer's actual render time (doc 09) |
| Error states | Preview render failure — detailed in §6.3 |
| Empty states | N/A |
| Success state | Store renders live in the canvas; user is in the Visual Editor, ready to edit |
| **Diverges from Dropmagic** | This is the second sharp divergence from §2: what's in the canvas is a real render of real production Section Liquid through the LiquidJS Preview Renderer, in a same-origin iframe that updates live as the `StoreConfiguration` changes — not a screenshot, mockup, or a separate front-end framework's recreation of what Shopify will eventually show. Dropmagic's rendering approach is **NOT PUBLICLY VERIFIABLE** beyond marketing claims of a live preview; this document does not assert a comparison beyond what Shopforge itself guarantees. |

### Step 10 — Click-to-Select Editing

| Aspect | Detail |
|---|---|
| User action | Hovers over an element in the rendered preview (highlights on hover) and clicks to select it — a section, a block within a section, or an individual setting's rendered output |
| System action | Maps the clicked DOM node back to its `Page → Section ID → Block ID → Setting` path (doc 06) and opens the corresponding inspector controls for that path |
| AI action | None |
| Data required | Current `StoreConfiguration`, DOM-to-config mapping metadata emitted by the Preview Renderer (doc 09) |
| API/integration | `/editor/*` — resolve-selection |
| UI required | Hover outline + click-to-select on the canvas iframe; inspector panel populated with the selected section/block/setting's editable fields (doc 06) |
| Validation | Selection must resolve to a real path in the current configuration — stale selections (e.g., a section removed by an AI edit mid-selection) are cleared rather than left pointing at nothing |
| Error states | Selection fails to resolve (rare — indicates a renderer/mapping bug) — inspector shows nothing selected rather than stale/incorrect controls |
| Loading states | N/A (selection is instant, local) |
| Empty states | Nothing selected: inspector shows a prompt to click something on the canvas, plus the AI panel remains available for whole-store requests |
| Success state | Inspector shows editable controls for the selected setting/block/section; user proceeds to edit directly (Step 11) or via the section-level controls (Step 12) |

### Step 11 — Inline Text Editing (`contentEditable`)

| Aspect | Detail |
|---|---|
| User action | Double-clicks (or uses an explicit "edit text" affordance from Step 10's selection) on any text element in the preview and types directly in place |
| System action | Enables `contentEditable` on the selected DOM node scoped to that one setting; on blur/commit, writes the new value back to the corresponding `Setting` in the `StoreConfiguration` and triggers a re-render of just that section |
| AI action | None for the raw edit; an optional "improve with AI" affordance next to the field routes into Step 13's AI-assisted editing instead |
| Data required | `StoreConfiguration`, the specific `Setting` path being edited |
| API/integration | `/config/*` — update-setting |
| UI required | In-place text cursor/editing chrome constrained to the exact rendered text bounds (font, size, wrapping preserved from the live render); autosave indicator (ties to Step 14) |
| Validation | Setting-level constraints from the section's schema (doc 07) — e.g., max length where a section enforces one — enforced inline, not after the fact |
| Error states | Save-on-blur failure (network) — edit remains in the field locally with a retry affordance, never silently lost |
| Loading states | Brief "saving…" indicator on blur, non-blocking |
| Empty states | Clearing a field entirely falls back to the section's default/placeholder copy rather than rendering blank, where the section schema defines one |
| Success state | Text updated in the live render and persisted to `StoreConfiguration`; autosave checkpoint created (Step 14) |

### Step 12 — Section Library — Add / Remove / Reorder Sections

| Aspect | Detail |
|---|---|
| User action | Opens the Section Library browser (from the Store/Page Navigator or a page-level "add section" affordance), browses/searches the catalog, adds a section to a page; drags existing sections to reorder within a page, or removes one |
| System action | Section Library browser reads the current published section catalog (doc 07) with previews/thumbnails; add/remove/reorder mutate the relevant page's section list in `StoreConfiguration` and trigger a live re-render |
| AI action | None for manual add/remove/reorder; newly added sections may be pre-filled with AI-generated content matching the store's existing tone/`ProductData` rather than the section's generic default copy (a lightweight follow-on generation call) |
| Data required | Section catalog (doc 07), `StoreConfiguration` |
| API/integration | `/config/*` — add-section, remove-section, reorder-sections; `/ai/*` — prefill-content (for the new-section content pass) |
| UI required | Section Library browser (grid/list with thumbnails and short descriptions, doc 07/06); drag handles on the Store/Page Navigator and/or directly on the canvas for reordering; remove confirmation for sections with existing custom content |
| Validation | A page must retain at least one section (cannot be emptied entirely via remove); section compatibility with the page type enforced (e.g., a product-gallery section can't be added to the Cart page if its schema declares it product-page-only, doc 07) |
| Error states | Prefill-content generation failure degrades to the section's generic default copy rather than blocking the add |
| Loading states | Brief "adding section…" state while prefill content generates; instant for reorder/remove |
| Empty states | Section Library browser with no search results shows a clear "no matching sections" state, not a blank grid |
| Success state | Page's section list updated; canvas re-renders to reflect the new order/composition; autosave checkpoint created (Step 14) |
| **Diverges from Dropmagic** | Every entry a user browses here is a real, Shopforge-authored, Shopify-theme-quality section (doc 07) — the same fixed catalog the AI itself selects from in Step 6, never a per-request generated block. This is the user-facing surface of the §2 "output ownership" divergence: the library the user browses and the library the AI draws from are the identical, maintained set. |

### Step 13 — AI-Assisted Editing within the Visual Editor

| Aspect | Detail |
|---|---|
| User action | With something selected (Step 10) or unscoped, describes a desired change in natural language via the AI panel — e.g., "make this headline punchier," "add a reviews section below the description," "swap this section's layout to a two-column grid" |
| System action | Routes the message with selection context (if any) through the AI Generation pipeline, scoped to the relevant `Page`/`SectionInstance`/`BlockInstance`/`Setting`; if underspecified, the Clarification System (doc 13) asks a targeted follow-up rather than guessing |
| AI action | Proposes an updated value (or set of values) for the scoped `StoreConfiguration` path — copy rewrite, setting change, or (via the same mechanism as Step 12) a section add/remove/reorder — and applies it optimistically to a working copy so the canvas updates immediately |
| Data required | `AIConversation`, `AIMessage` history (scoped to this `Project`), selection context, `StoreConfiguration` |
| API/integration | `/ai/*` — message (chat), clarify-answer, apply-edit |
| UI required | Chat composer + message thread in the AI panel (doc 06/19); the canvas updates live as the AI's proposed change lands, with an explicit "undo this" affordance directly in the chat thread (backed by Step 14's version checkpoints, not a separate approval workflow) |
| Validation | Same setting/schema validation as Steps 11–12 runs on any AI-proposed value before it's written to `StoreConfiguration` |
| Error states | **AI timeout/failure during editing** — detailed in §6.2 (same failure mode as generation, different trigger point); AI proposes a change that fails schema validation — rejected before it ever reaches the render, user shown why |
| Loading states | Typing/streaming indicator while the AI composes a response; per-section "updating…" shimmer on the canvas while the proposed change renders |
| Empty states | First message in a `Project`'s AI panel shows example prompts ("Try: 'add a reviews section' or 'make the hero image bigger'") |
| Success state | Canvas reflects the AI's change; autosave checkpoint created (Step 14); user can keep iterating or undo |

### Step 14 — Autosave & Configuration Version Checkpoints

| Aspect | Detail |
|---|---|
| User action | None required — happens continuously as a side effect of Steps 11–13; user can also explicitly open Version History (Step 18) at any point |
| System action | Every committed edit (inline text commit, section add/remove/reorder, AI-assisted edit) creates a `ConfigurationVersion` checkpoint against the `Project`, chained to its parent version |
| AI action | None |
| Data required | `ConfigurationVersion` (chained list), `StoreConfiguration` (current working state) |
| API/integration | `/config/*` — save-checkpoint |
| UI required | Small, persistent "saved" indicator in the editor toolbar (doc 19); no explicit "save" button — the working configuration is always durable |
| Validation | N/A |
| Error states | Checkpoint save failure (network) — local working state is retained client-side and retried, so a transient failure never loses an in-progress edit |
| Loading states | Brief, non-blocking "saving…" flicker in the toolbar indicator |
| Empty states | N/A |
| Success state | Working configuration durably persisted; visible in Version History (Step 18) |

### Step 15 — Connect Shopify (OAuth)

| Aspect | Detail |
|---|---|
| User action | Clicks "Connect & Publish" (available at any time in the editor toolbar, but the natural trigger is being ready to go live); enters store domain or selects from a Shopify-side account picker; approves requested OAuth scopes on Shopify's consent screen |
| System action | Initiates OAuth authorization-code flow against Shopify (doc 16); on callback, exchanges code for access token, creates `ShopifyStore` + `ShopifyInstallation` (storing token/scopes), links the `Project` to that store |
| AI action | None |
| Data required | Store domain, OAuth scopes (write access to theme assets, as required to install the Base Theme + configuration, doc 16), `ShopifyStore`, `ShopifyInstallation` |
| API/integration | `/shopify/*` — oauth connect |
| UI required | Domain entry field with inline validity check; redirect-out to Shopify's hosted consent screen; redirect-back confirmation; this step is also plan-gated (doc 22) — if the user's plan doesn't permit publishing, they see the upgrade prompt here rather than at Shopify's screen |
| Validation | Domain resolves to an active Shopify store; store is not already connected to a different `Organization`'s `Project` (or is, with a clear re-link/ownership prompt); required scopes all granted |
| Error states | **Shopify OAuth failure** — detailed in §6.4 |
| Loading states | "Connecting to Shopify…" spinner during token exchange after redirect-back |
| Empty states | N/A |
| Success state | `ShopifyStore` + `ShopifyInstallation` linked to the `Project`; user proceeds to Step 16 |
| **Diverges from Dropmagic** | Placement, not existence, is the point worth noting. Building and previewing the entire store (Steps 1–14) require no Shopify connection whatsoever — this step is reachable only when the user chooses to go live, matching Dropmagic's own reported gate placement (publish behind a paid tier, not build) rather than the old positioning where a live store connection was the very first required step. |

### Step 16 — Publish

| Aspect | Detail |
|---|---|
| User action | Reviews a publish confirmation summary and confirms "Publish live" |
| System action | Installs the Base Theme (doc 16) onto the connected `ShopifyStore` if not already installed, pushes the current `StoreConfiguration` as the active configuration for that theme installation, and records a `PublishRecord` |
| AI action | None |
| Data required | `StoreConfiguration` (current version), Base Theme assets (doc 07), `PublishRecord`, `ShopifyInstallation` |
| API/integration | `/shopify/*` — publish |
| UI required | Publish confirmation dialog summarizing what will go live (page/section count, whether this is a first publish or a republish); success screen with a "View live store" link |
| Validation | Full configuration validated against the installed Base Theme's section schemas immediately before push (doc 15-equivalent), catching anything that could have drifted since it was last rendered in preview |
| Error states | **Publish rejected by Shopify** — detailed in §6.5; Shopify API/network failure during push (retryable; nothing is left partially published) |
| Loading states | "Publishing to Shopify…" blocking state with staged messaging (installing theme → applying configuration → activating) |
| Empty states | N/A |
| Success state | Store is live on Shopify; `PublishRecord` created; user shown a success confirmation and routed toward Step 17 |
| **Diverges from Dropmagic** | Converges deliberately with §2's gating row — publish is the plan-gated moment, same as Dropmagic's reported model. What's still Shopforge's own: because the Base Theme and its sections are fixed and pre-validated (doc 07), a first publish is installing a known-good, already-rendered theme rather than generating and validating arbitrary code for the first time at push. |

### Step 17 — Post-Publish Iteration Loop

| Aspect | Detail |
|---|---|
| User action | Returns (same session or later) to keep editing — same Visual Editor, same interactions as Steps 10–13 |
| System action | Loads the current `StoreConfiguration` (now backing a live store) into the editor exactly as in Step 9; edits create new `ConfigurationVersion` checkpoints as before |
| AI action | Same AI-assisted editing loop as Step 13, now operating against a live store's configuration |
| Data required | Same as Steps 9–14 |
| API/integration | Same groups as Steps 9–14 |
| UI required | Same Visual Editor shell; toolbar clearly indicates "live" vs. "unpublished changes pending" state (doc 19) |
| Validation | Same as prior steps |
| Error states | Same as prior steps |
| Loading states | Same as prior steps |
| Empty states | N/A |
| Success state | Loop continues indefinitely — the steady state of product usage, not a terminal step; user republishes (re-enters Step 16) whenever they want pending edits to go live |
| **Diverges from Dropmagic** | This loop is still the product's clearest differentiator. One independent Dropmagic reviewer explicitly characterizes it as "a one-shot generator with no post-launch optimization" **[VERIFIED, research §3/§11, though a lower-confidence contradicting source exists]** — Shopforge is architected around the opposite assumption: publish is a checkpoint, and every editing tool available pre-publish remains available after. |

### Step 18 — Version History / Rollback

| Aspect | Detail |
|---|---|
| User action | Browses `ConfigurationVersion` history for the `Project`, inspects differences between any two versions, restores a prior version, or reverts a single past edit |
| System action | Restores from a `ConfigurationVersion` checkpoint (whole-configuration restore) or replays an inverse change for a single-edit revert; if the restored version was already published, offers to republish immediately |
| AI action | None |
| Data required | `ConfigurationVersion` list, `PublishRecord` history |
| API/integration | `/config/*` — versions, restore |
| UI required | Version timeline with per-version publish status and a diff/comparison view between any two selected versions; restore confirmation |
| Validation | Restoring to a version that predates a since-removed section in the Base Theme catalog (rare — the catalog is additive far more often than it removes) is flagged rather than silently applied |
| Error states | Restore failure (corrupted/missing checkpoint — should be rare given checkpoints are created automatically on every commit, Step 14) |
| Loading states | "Restoring version…" blocking state, staged like publish |
| Empty states | A brand-new `Project` with only its initial AI-generated version shows a single-entry timeline, not an empty state, since generation itself counts as version 1 |
| Success state | Working `StoreConfiguration` reflects the restored version; user can review and republish (Step 16) as normal |

## 5. Secondary journey — describe instead of pasting a URL

A genuinely different secondary journey does still exist in the new architecture, but it's narrower than the old Path A/B split: **starting from a text description instead of a product URL**. This matters because a merchant may not have a specific product page to point at yet — a pre-launch product, a general niche idea, or a multi-product concept rather than one SKU. Everything else — signup gating, AI Generation, the Visual Editor, publish — is identical to §4; this section documents only where the two paths differ, the same way the old doc's Path B documented only its delta from Path A.

| Aspect | Detail |
|---|---|
| Step D1 — User action | From Step 2 (§4), toggles "describe it instead" and writes a free-text description — product/store concept, target audience, tone, and optionally a reference URL that isn't itself a scrapable product page (e.g., a competitor's homepage for inspiration, not extraction) |
| Step D1 — System action | Holds the description in session state exactly as Step 2 holds a URL; no scrape is queued |
| Step D1 — UI required | Same entry screen as Step 2, description mode; a short set of optional prompts (product category, brand tone) to reduce ambiguity going into generation |
| Step D2 — User action | Proceeds to Sign up/Login exactly as §4 Step 3 |
| Step D2 — System action | Creates the `Project` with the description attached as its seed instead of a URL |
| Step D3 | **Replaces §4 Step 4 (Product Import) entirely** — there is nothing to scrape. Instead, the AI Generation pipeline (§4 Steps 6–7) drafts a synthetic `ProductData` record directly from the description (title, description copy, suggested category; no real product images, since none exist yet) |
| Step D3 — AI action | Drafting `ProductData` from a description is itself an AI Generation sub-step, tiered like any other generation call (doc 10); low-confidence drafts trigger the Clarification System (doc 13) more readily here than in the URL path, since there's less concrete input to ground the draft |
| Step D4 | Converges into **§4 Step 5 (Product Data Review & Confirm)** — the user reviews the AI-drafted data exactly as they'd review scraped data, with an explicit note that images are placeholders to be replaced (via the Section Library/inspector, §4 Step 10–12) since none were extracted |
| Step D5 onward | Fully converges into §4 Step 6 onward — AI Generation, Store Configuration, Visual Editor, publish, and iteration are identical regardless of entry mode |
| **Diverges from Dropmagic** | Dropmagic's research describes the same dual entry (URL or niche description) **[VERIFIED/SELF-REPORTED]** without a documented equivalent to Shopforge's confirm-before-generate step (§4 Step 5) for either mode — Shopforge treats the AI-drafted seed data the same way it treats scraped data: reviewable and correctable before any section content is generated from it. |

## 6. Error and edge flows (detailed)

### 6.1 Product-URL scrape/import failure

| Aspect | Detail |
|---|---|
| Trigger | The Product Import/Scraper (doc 07) cannot extract usable Product Data from the submitted URL — the site isn't a supported source, the target page's structure doesn't match any known adapter (site redesign), the source blocks/rate-limits the fetch (anti-bot protection), or the page loads but only partial data is extractable (e.g., price hidden behind JS the scraper doesn't execute) |
| System response | Import does not silently fail — it distinguishes "nothing usable extracted" from "partial extraction," and for partial extraction proceeds to Step 5 with whatever fields it got, clearly marked as incomplete, rather than discarding a partial success |
| User-facing message | Full failure: "We couldn't read that product page — it might not be a supported store type, or the page may be blocking automated access. You can try a different URL or describe the product instead." Partial: "We got some details from this page but not all of them — fill in the rest below." |
| Recovery path | Three options presented on full failure: (1) try a different URL, (2) switch to describe-instead (§5) with the failed URL still offered as optional inspiration text, (3) for partial extraction, simply proceed to Step 5 and fill the gaps manually |
| Data/logging | `ProductImportJob.status` persisted as `failed`/`partial`/`succeeded` with the specific failure reason, both for user-facing messaging and to prioritize which source adapters (doc 07) need attention as failure patterns emerge |

### 6.2 AI generation timeout/failure

| Aspect | Detail |
|---|---|
| Trigger | The AI Generation pipeline (§4 Steps 6–7, or the AI-assisted editing call in Step 13) exceeds its latency budget, or the provider fails to respond within the configured timeout (fallback chain exhausted, doc 10 §7) |
| System response | During initial generation (Steps 6–7): if some sections generated successfully before the failure, those are kept and only the unfinished sections are marked for retry — the user is never dropped back to a blank state. During AI-assisted editing (Step 13): the pre-edit `StoreConfiguration` state is untouched (nothing is applied optimistically until the AI's proposal is actually received), so a timeout there simply means nothing changed |
| User-facing message | Generation: "Some sections are taking longer than expected — the rest of your store is ready, and we'll keep trying these in the background." Editing: "We couldn't get a response in time. Nothing was changed — you can try again or rephrase your request." |
| Recovery path | "Retry" re-sends the same generation/edit request (which may route to a fallback provider, doc 10 §4/§7); for editing specifically, simplifying an overly broad request often resolves timeouts caused by wide context selection (doc 12) |
| Data/logging | Timeout recorded as an `AIUsageEvent` with `finishReason: "error"` and zero/partial credit charge — no charge for a response that never completed (cost-aware AI design goal) |

### 6.3 Preview render failure

| Aspect | Detail |
|---|---|
| Trigger | The LiquidJS Preview Renderer (doc 09) fails to render one or more sections against the current `StoreConfiguration` — most commonly a setting value that's technically schema-valid but produces a render-time error in that section's Liquid (e.g., a malformed URL in an image setting), or a transient renderer/iframe failure |
| System response | Render failure is isolated per section — a single section failing to render shows a clear "this section couldn't be previewed" placeholder in the canvas at that section's position, while the rest of the page renders normally; it never blanks the whole canvas |
| User-facing message | "This section couldn't be previewed — the setting causing it is flagged in the inspector." The specific `Setting` believed responsible is highlighted when the user selects the failed section |
| Recovery path | User corrects the flagged setting (Step 11/10) and the section re-renders automatically; if the cause isn't a setting value but a renderer-side issue, a "retry render" affordance re-requests the render without requiring an edit |
| Data/logging | Render failures logged with the specific section/setting context, both for user-facing flagging and to catch systemic issues in a given Base Theme section (doc 07) across many stores, not just this one |

### 6.4 Shopify OAuth failure

| Aspect | Detail |
|---|---|
| Trigger | User declines consent, the OAuth callback returns an error code, token exchange fails, or granted scopes are insufficient for the required publish functionality |
| System response | Callback handler distinguishes failure types: user-declined (no retry needed, just re-offer the connect CTA), scope-insufficient (explain which scope is missing and why, re-initiate with corrected scope request), transient/network (auto-retry once, then surface manual retry) |
| User-facing message | Scope-insufficient example: "Shopforge needs permission to install your theme and its content to publish. Please grant that access to continue." |
| Recovery path | "Try connecting again" restarts Step 15 cleanly; no partial `ShopifyStore`/`ShopifyInstallation` record is left ambiguous — either the connection fully succeeds or nothing is persisted; the `Project` itself is entirely unaffected by a failed connect attempt since building/previewing never depended on it |
| Data/logging | If the failure happens on a *reconnection* (existing `ShopifyInstallation` whose token was revoked externally), the user sees a distinct "reconnect" messaging path from the Project's Publish & Connect screen rather than being routed back through onboarding |

### 6.5 Publish rejected by Shopify

| Aspect | Detail |
|---|---|
| Trigger | Shopify's own validation (Admin API rejection, theme-install constraints) fails on the Base Theme install or configuration push in Step 16, despite passing Shopforge's own pre-push validation (doc 15-equivalent) — doc 16 covers the specific platform-level failure modes this can stem from (e.g., store-side app/theme limits, permission scope gaps not caught at connect time) |
| System response | Publish is not partially applied — Shopforge only marks the push complete once Shopify confirms activation, so a rejected push leaves the store's prior state (or no theme, on a first publish) untouched; the specific rejection reason is captured and, where it maps to a particular section/setting, surfaced there |
| User-facing message | "Shopify rejected this update: [specific reason]. Your live store was not modified." |
| Recovery path | If the rejection traces to something Shopforge's own validation should have caught, the affected section/setting is flagged for correction before retrying publish; if it traces to a store-side constraint outside Shopforge's control (e.g., a theme/app limit on the merchant's Shopify plan), the user is told plainly what it is and pointed at doc 16's known-constraints list rather than a generic error |
| Data/logging | Rejection recorded on `PublishRecord` with status `rejected` and the raw Shopify error payload retained for support/debugging, distinct from a successful publish record |

## 7. Full journey diagram (ASCII)

```
                    Landing
                       │
                       ▼
        Product URL Input  ──(toggle)──  Describe Instead (§5)
                       │                          │
                       └────────────┬─────────────┘
                                    ▼
                         Sign up / Login (auth gate)
                                    │
                       ┌────────────┴────────────┐
                       ▼                           ▼
             Product Import (scrape)      AI-drafted Product Data (§5)
              ── error: scrape/import              │
                 failure (§6.1)                    │
                       └────────────┬───────────────┘
                                    ▼
                     Product Data Review & Confirm
                                    │
                                    ▼
                AI Generation: Section Selection & Ordering
                                    │
                                    ▼
                AI Generation: Section Settings & Content
              ── error: AI generation timeout/failure (§6.2)
                                    │
                                    ▼
                   Store Configuration Created (v1)
                                    │
                                    ▼
              Visual Editor Opens — LiquidJS Preview Render
              ── error: preview render failure (§6.3)
                                    │
              ┌─────────────────────┼─────────────────────┐
              ▼                     ▼                       ▼
     Click-to-Select Edit   Inline Text Edit        Section Library
      (Steps 10)             (contentEditable, 11)   add/remove/reorder (12)
              │                     │                       │
              └─────────────────────┼───────────────────────┘
                                    ▼
                  AI-Assisted Editing (scoped chat, 13)
              ── error: AI timeout/failure (§6.2)
                                    │
                                    ▼
                Autosave & Configuration Version Checkpoints (14)
                                    │
                                    ▼
                  Connect Shopify (OAuth) — when ready to publish
              ── error: OAuth failure (§6.4)
                                    │
                                    ▼
                                 Publish
              ── error: rejected by Shopify (§6.5)
                                    │
                                    ▼
                    Post-Publish Iteration Loop (17)
                     (returns to editing, Steps 10–14, any time)
                                    │
                                    ▼
                    Version History / Rollback (18, any time)
```
