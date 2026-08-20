# 04 — User Flows

## 1. Purpose and scope

This document is the single source of truth for the **end-to-end Shopforge user journey** — every screen a user passes through from first landing on the marketing site to iterating on a published, live Shopify theme. It exists to make one thing unambiguous before any UI or API work starts: **Shopforge's front door is "connect an existing Shopify store and import its live theme," not "paste a product URL and generate a brand-new store."** That is the product's core differentiator versus Dropmagic (dropmagic.ai) and it must shape every screen in this flow, not just the marketing copy.

Every step below uses the same sub-structure — User Action, System Action, AI Action, Data Required, API/Integration, UI Required, Validation, Error States, Loading States, Empty States, Success State — so any step can be scanned in isolation. Data entities referenced are the canonical names from architecture core §5; API groups are the canonical groups from architecture core §6.

## 2. Divergence from Dropmagic — at a glance

Per the Dropmagic research file (`research-dropmagic.md`), Dropmagic's own marketing and independent reviews consistently describe a **generate-from-scratch** flow: paste a product URL (AliExpress/Amazon/Alibaba/Shopify) or describe a niche → AI drafts a brand-new store on a proprietary editor → publish to a *new* Shopify store **[VERIFIED]** (dropmagic.ai homepage). There is no evidence anywhere in that research — verified or otherwise — of Dropmagic reading an existing store's theme code and editing it in place; competitor-store import is explicitly listed as **NOT PUBLICLY VERIFIABLE**, and the product is inferred to be "a standalone build tool that outputs a Shopify store," not "an embedded Shopify-admin app used for ongoing editing" **[INFERENCE, research §6]**.

| Dimension | Dropmagic (per research) | Shopforge |
|---|---|---|
| Entry point | Paste product URL or describe a store concept **[VERIFIED/SELF-REPORTED]** | Connect an existing Shopify store; theme is *parsed*, not generated |
| What AI operates on | A blank canvas; AI drafts all copy/sections/branding from nothing | An existing theme's real `ThemeManifest`/`ThemeModel` (architecture core §1–2); AI edits what's already there (Design Principle 1: preserve the existing theme) |
| Output ownership pre-publish | Build happens on a separate proprietary editor ("hosted on Framer" per one unverified source, research §5) before anything touches Shopify | Every edit is a Liquid/JSON-native `Operation` (architecture core §3) applied to the real theme file tree from the first step — nothing is ever off-platform |
| New-store case | This *is* the only case Dropmagic supports | Supported as a deliberate **secondary** path (§5) — but even here, Shopforge parses a real starter theme (Dawn) rather than generating a store outside the Shopify theme model |
| Post-launch editing | One independent reviewer explicitly describes it as a "one-shot generator with no post-launch optimization" **[VERIFIED, buildyourstore.ai, though contradicted by a lower-confidence source — research §3, §11]** | Iteration is the core loop — publish is not an endpoint, see §4 step 16 |
| Publish gating | Free tier cannot publish at all; publish requires $79/mo Pro **[SEARCH-SNIPPET, consistent across ≥4 sources]** | Publish gating is a Shopforge billing/plan decision (out of scope here — see doc 22), not a structural requirement of the flow itself |

Everywhere below that a step exists *because* Shopforge diverges from Dropmagic's model, it is called out inline with a **Diverges from Dropmagic** note.

## 3. Two entry paths

```
                        ┌─────────────────────┐
                        │   Landing / Signup   │
                        └──────────┬───────────┘
                                   │
                        ┌──────────▼───────────┐
                        │   Onboarding: choose  │
                        │        a path         │
                        └──────────┬───────────┘
                 ┌─────────────────┴─────────────────┐
                 ▼                                     ▼
   ┌───────────────────────────┐         ┌───────────────────────────────┐
   │  PATH A (primary)          │         │  PATH B (secondary)            │
   │  Connect an EXISTING store │         │  Start a NEW store, no theme   │
   │  → import its live theme   │         │  → import Dawn (starter theme) │
   └──────────────┬─────────────┘         └───────────────┬────────────────┘
                  │                                        │
                  └──────────────────┬─────────────────────┘
                                     ▼
                     BOTH PATHS CONVERGE HERE:
                 Theme Import & Parse → Manifest → Model
                    → Overview → Editor/AI Workspace → …
```

Path A is the product's reason for existing and is documented in full in §4. Path B (§5) is a real, deliberately supported use case (a merchant who wants Shopforge's AI-assisted editing experience but has no theme worth preserving) — but it is explicitly a **thin variant that re-enters the same pipeline as Path A at the Import & Parse step**, using Dawn (Shopify's current Online Store 2.0 reference theme) as the input instead of the merchant's own theme. Shopforge never has a separate "generate a store from nothing" code path the way Dropmagic does — this is a deliberate architectural choice, not an oversight, and it is what keeps Design Principles 1–3 (preserve/reuse/minimal-generation) true even for brand-new stores.

## 4. Primary journey — Path A: connect an existing store

### Step 1 — Landing

| Aspect | Detail |
|---|---|
| User action | Arrives at marketing site (organic, ad, referral) and reads value proposition |
| System action | Serves static/marketing page; tracks acquisition source for attribution |
| AI action | None |
| Data required | None (unauthenticated) |
| API/integration | None (marketing site is not app-backed) |
| UI required | Hero messaging centered on "edit your existing Shopify store with AI" (not "build a store in 2 minutes" — that framing is Dropmagic's, see §2); primary CTA "Connect your store"; secondary CTA "Start fresh instead" for Path B |
| Validation | N/A |
| Error states | N/A |
| Loading states | Standard page load; no app-shell wait |
| Empty states | N/A |
| Success state | User clicks a CTA and proceeds to Sign up/Login |

### Step 2 — Sign up / Login

| Aspect | Detail |
|---|---|
| User action | Chooses email/password signup, email/password login, or "Continue with Shopify" (OAuth-first identity) |
| System action | Creates or authenticates `User`; if this is the user's first `Organization`, creates a default `Organization` + `OrgMembership` (role: owner) |
| AI action | None |
| Data required | Email, password (or OAuth identity token), `User`, `Organization`, `OrgMembership` |
| API/integration | Internal auth service; if "Continue with Shopify" chosen, this reuses the same Shopify OAuth handshake as Step 4 (`/shopify/*`) but only to establish identity, not a store connection yet |
| UI required | Tabbed or toggled email-vs-OAuth form; password strength meter on signup; "forgot password" link on login |
| Validation | Email format, password strength/length, duplicate-email detection on signup; credential match on login |
| Error states | Invalid credentials, account already exists (signup), account not found (login), OAuth identity denied/cancelled, email not verified (if verification required before proceeding) |
| Loading states | Submit button spinner while auth request is in flight |
| Empty states | N/A |
| Success state | Session established, user routed into Onboarding (Step 3) if no `Organization`/store exists yet, or straight to Dashboard if returning |

### Step 3 — Onboarding (path choice)

| Aspect | Detail |
|---|---|
| User action | Chooses "Connect your existing Shopify store" (Path A, default/emphasized) or "Start a new store" (Path B, §5) |
| System action | Records chosen path against the `Organization` for analytics/funnel purposes; no store/theme data created yet |
| AI action | None |
| Data required | `Organization` (already created in Step 2) |
| API/integration | None yet |
| UI required | Two-card choice screen; Path A card is visually primary (larger, default-focused) per the product's actual differentiator; Path B card explicitly labeled "no existing theme worth keeping? start from a clean base" |
| Validation | N/A |
| Error states | N/A |
| Loading states | N/A |
| Empty states | N/A |
| Success state | User proceeds to Step 4 (Path A) or jumps to §5 Step B1 (Path B) |
| **Diverges from Dropmagic** | Dropmagic has no equivalent branch — every user is funneled into the same product-URL/niche-description flow **[VERIFIED, research §3]**. Shopforge treats "existing store" as the default because that is the product's actual differentiator; Dropmagic-style greenfield generation is demoted to an opt-in secondary path. |

### Step 4 — Connect Shopify Store (OAuth)

| Aspect | Detail |
|---|---|
| User action | Enters store domain (`*.myshopify.com` or custom domain) or selects from a Shopify-side account picker; approves requested OAuth scopes on Shopify's consent screen |
| System action | Initiates OAuth authorization-code flow against Shopify; on callback, exchanges code for access token, creates `ShopifyStore` + `ShopifyInstallation` (storing token/scopes), links to `Organization` |
| AI action | None |
| Data required | Store domain, OAuth scopes (read/write themes, read products/content as needed by later AI operations), `ShopifyStore`, `ShopifyInstallation` |
| API/integration | `/shopify/*` — oauth connect |
| UI required | Domain entry field with inline "is this a valid Shopify store" check; redirect-out to Shopify's hosted consent screen; redirect-back landing/confirmation screen |
| Validation | Domain resolves to an active Shopify store; store is not already connected to a different `Organization` (or is, with a clear re-link/ownership-transfer prompt); required scopes are all granted (not partially) |
| Error states | Invalid/nonexistent domain; user declines OAuth consent; store already connected elsewhere; Shopify plan too low for required API access (if applicable); OAuth callback token exchange failure (network/Shopify-side error) — see §6.2 for the dedicated OAuth failure flow |
| Loading states | "Connecting to Shopify…" spinner during token exchange after redirect-back |
| Empty states | N/A |
| Success state | `ShopifyStore` + `ShopifyInstallation` persisted; user routed to Step 5 (theme selection) |
| **Diverges from Dropmagic** | Dropmagic's OAuth scope requirements were explicitly **NOT PUBLICLY VERIFIABLE** (research §6) and its "publish" step appears to be a one-way push at the end of the flow, not a connection established up front that every subsequent step depends on. Shopforge's OAuth connection is load-bearing from Step 4 onward — theme import, parsing, preview, and publish all depend on this single live connection. |

### Step 5 — Theme selection (which theme to import)

| Aspect | Detail |
|---|---|
| User action | Picks which theme to import from the connected store's theme list (main/live, unpublished, development, or demo — `shopifyRole`) |
| System action | Calls Shopify Admin API to list themes on the store; renders them with role badges and last-modified metadata |
| AI action | None |
| Data required | `ShopifyInstallation` (for auth), theme list from Shopify |
| API/integration | `/shopify/*` — list themes |
| UI required | Theme list/grid with thumbnail (if Shopify provides one), name, role badge, "Import" button per theme |
| Validation | At least one theme must exist on the store (always true for any real Shopify store) |
| Error states | Shopify API rate-limited or unreachable; token expired/revoked since Step 4 (re-auth prompt) |
| Loading states | Skeleton list while fetching themes |
| Empty states | N/A in practice (Shopify stores always ship with at least one theme) — but if a store somehow returns zero themes, show an explicit "no themes found — try starting fresh instead" state that links into Path B |
| Success state | User selects a theme and confirms import, proceeding to Step 6 |

### Step 6 — Theme Import & Parse

| Aspect | Detail |
|---|---|
| User action | Confirms import; waits (or navigates away and returns later — parsing is async) |
| System action | Downloads the full theme file tree from Shopify, runs the Theme Parser (doc 07) to extract layouts/templates/sections/snippets/settings/assets/locales, computes `themeVersionHash` |
| AI action | None at this stage — parsing is deterministic static analysis, not AI (Design Principle 10: imported data is untrusted, so parsing runs in a sandboxed, non-executing analyzer) |
| Data required | Full theme file tree (from Shopify), `Theme`, initial `ThemeVersion` |
| API/integration | `/shopify/*` — import theme; `/theme/*` — parse |
| UI required | Progress screen with staged messaging ("Downloading theme files… Parsing sections… Building capability map…"); this can also run as a background job with a dashboard notification if the user navigates away |
| Validation | Theme file tree must be well-formed enough to parse (valid JSON templates, resolvable Liquid includes); Online Store 2.0 structure detected (JSON templates + section schema) vs. legacy/vintage structure |
| Error states | **Parse failure on a vintage/pre-OS2.0 theme** (no JSON templates, monolithic `.liquid` templates instead) — this is a first-class, expected error path, detailed in §6.1; malformed/corrupted theme files; Shopify API timeout mid-download |
| Loading states | Staged progress indicator (download → parse → manifest build); estimated time shown for large themes |
| Empty states | N/A |
| Success state | `ThemeManifest` persisted and cached, user routed to Step 7 |
| **Diverges from Dropmagic** | This is the step with no Dropmagic equivalent at all. Dropmagic's underlying theme architecture (Liquid vs. OS 2.0 JSON vs. something proprietary) was explicitly **NOT PUBLICLY VERIFIABLE** (research §6) precisely because it never needs to parse anything — it only ever writes. Shopforge's entire value proposition depends on this step succeeding and being trustworthy. |

### Step 7 — Manifest → Theme Model build

| Aspect | Detail |
|---|---|
| User action | None (passive wait, continuation of Step 6's progress screen) |
| System action | Builds the `ThemeModel` (architecture core §2) from the `ThemeManifest` + current file contents — resolves `SectionInstance`s per template, `GlobalStyles`, current `themeSettings` |
| AI action | Capability derivation may use embedding-based matching in addition to static rules (architecture core §1 `capabilities` block: `hasHeroSection`, `hasReviewsSection`, etc.) — this is the first, narrow AI touchpoint, used only for classification, not generation |
| Data required | `ThemeManifest`, raw theme files, resulting `ThemeVersion` (working copy) |
| API/integration | `/theme/*` — model (read/build) |
| UI required | Same progress screen as Step 6, final stage ("Understanding your theme's capabilities…") |
| Validation | Every `TemplateNode.sectionInstances` reference must resolve to a known `sections[].sectionId` in the Manifest; orphaned/broken references are logged, not fatal |
| Error states | Model build failure due to unresolvable references (rare — indicates a parser bug or a theme with broken includes); surfaced as a degraded-but-usable state rather than a hard stop where possible |
| Loading states | Continuation of Step 6's progress UI |
| Empty states | N/A |
| Success state | `ThemeModel` built and persisted for the initial `ThemeVersion`; user routed to Step 8 |

### Step 8 — Store/Theme Overview (capability summary)

| Aspect | Detail |
|---|---|
| User action | Reviews the capability summary; can drill into any listed capability or proceed directly to editing |
| System action | Renders the `ThemeManifest.capabilities` flags as a human-readable summary: "Your theme already supports: hero sections, product recommendations, an announcement bar. It does not yet have: a reviews section, an FAQ block." |
| AI action | May generate a short natural-language narrative summary from the capability flags (a "standard"-tier chat call, architecture core / doc 10 tiering) — purely descriptive, no operations proposed yet |
| Data required | `ThemeManifest.capabilities`, `Theme`, `ThemeVersion` |
| API/integration | `/theme/*` — manifest (read); `/ai/*` — analyze (for the narrative summary) |
| UI required | Capability grid/checklist (✅ present / ➕ could be added / — not applicable to this store type); CTA into AI Workspace ("Tell us what you want to change") and CTA into Visual Editor ("Open the editor") |
| Validation | N/A (read-only summary) |
| Error states | Narrative-summary AI call failure degrades gracefully to the raw checklist (no narrative text) rather than blocking the page |
| Loading states | Skeleton checklist while capability data loads (should be instant — it's cached Manifest data, not a fresh computation) |
| Empty states | A theme with almost no detected capabilities (e.g., a very minimal custom theme) still renders the grid, just mostly showing "➕ could be added" — never a blank page |
| Success state | User proceeds into either AI Workspace (Step 9a) or Visual Editor (Step 9b) |
| **Diverges from Dropmagic** | This step has no equivalent in Dropmagic's flow because Dropmagic never has an "existing capability" to summarize — every generated store starts from the same blank slate. This screen is the concrete UI expression of Design Principle 2 (reuse existing capabilities) and is the moment a user first sees Shopforge's differentiator made tangible. |

### Step 9 — Entry into AI Workspace or Visual Editor

| Aspect | Detail |
|---|---|
| User action | Chooses chat-first entry (AI Workspace) or canvas-first entry (Visual Editor) — both operate on the identical `ThemeModel`, per Design Principle 7 |
| System action | Loads the current `ThemeModel` for the active `ThemeVersion`; if AI Workspace chosen, creates or resumes an `AIConversation` |
| AI action | None yet (waiting for first user message/edit) |
| Data required | `ThemeVersion`, `ThemeModel`, `AIConversation` (if applicable) |
| API/integration | `/editor/*` — get-model; `/ai/*` — conversation |
| UI required | Two equally-weighted entry CTAs from the Overview screen; both land in the same underlying workspace shell (doc 19 §19.3) — AI Workspace opens with the AI panel focused/expanded, Visual Editor opens with the canvas focused and the AI panel available but collapsed |
| Validation | N/A |
| Error states | Model fetch failure (network/server) — retry with cached last-good model if available |
| Loading states | Editor-shell skeleton (doc 19 §19.4.8 "Loading" state) |
| Empty states | N/A |
| Success state | User is in the live editing surface, ready to converse with AI or interact with the canvas |

### Step 10 — AI conversation / clarification loop

| Aspect | Detail |
|---|---|
| User action | Describes a desired change in natural language (optionally after selecting a section/block on the canvas to scope the request, doc 19 §19.4.6) |
| System action | Routes the message through the Operation Planner (doc 11); if the request is ambiguous or underspecified, triggers the Clarification System (doc 13) instead of guessing (Design Principle 4) |
| AI action | Intent classification (fast tier) → if clear, proceeds to plan generation (Step 11); if ambiguous, generates a targeted clarifying question (e.g., "Add a reviews section — should it go above or below the product description?") |
| Data required | `AIConversation`, `AIMessage` history, selection context (`instanceId`/`blockInstanceId` if scoped), `ThemeModel` slice selected by the Context Selector (doc 12) |
| API/integration | `/ai/*` — message (chat), clarify-answer |
| UI required | Chat composer + message thread in the AI panel; clarifying questions rendered as structured quick-reply chips where possible (e.g., position choices) alongside free-text reply |
| Validation | User's clarifying answer must resolve enough ambiguity to proceed — if not, the AI may ask a follow-up (bounded retry count before falling back to a "let's start over" prompt) |
| Error states | **AI timeout during clarification** — detailed in §6.3; provider error/refusal (surfaced with a retry action, not a raw error) |
| Loading states | Typing/streaming indicator while the AI composes a response or clarifying question |
| Empty states | First message in a new `AIConversation` shows a prompt/example-request starter ("Try: 'Add a reviews section to my product page'") rather than a blank thread |
| Success state | Request is unambiguous enough for the Operation Planner to generate a full plan; proceeds to Step 11 |

### Step 11 — Operation Plan review

| Aspect | Detail |
|---|---|
| User action | Reviews the proposed `Operation Plan` (ordered `Operation[]` + rationale + risk summary); approves, edits scope, or rejects |
| System action | Renders each `Operation` with its `riskLevel` (safe/review/destructive) and human-readable summary; groups `safe` structural operations for one-click batch approval while `review`/`destructive`/`requiresNewCode` operations require explicit per-step confirmation (Design Principle 5) |
| AI action | Full plan generation (standard/premium tier depending on complexity — architecture core / doc 10 §4); for any operation requiring new Liquid/CSS/JS (`create_section_file`, `modify_liquid`, etc.), this is where Design Principle 3 (minimal AI generation) is enforced — the Planner only reaches for generative operations after confirming no existing capability satisfies the request |
| Data required | `OperationPlan`, `ThemeOperation` (persisted per-op), `estimatedCreditCost` per operation |
| API/integration | `/ai/*` — plan |
| UI required | Plan list in the AI panel (doc 19 §19.4.7 step 2–3), each item expandable to see target + payload summary; aggregate cost/credit estimate shown before approval |
| Validation | Every operation's `target` must resolve against the current `ThemeModel` (no stale references if the model changed since planning began); plan-level validation (doc 15) runs before the plan is offered for approval |
| Error states | Planning failure (AI error, budget ceiling exceeded — architecture core / doc 10 §6); plan references a target that no longer exists (stale plan — user prompted to re-request) |
| Loading states | Streaming plan generation (doc 19 §19.4.7 step 2) |
| Empty states | N/A (a plan with zero operations means the Planner determined no change is needed — shown as an explicit "nothing to do" message, not an empty list) |
| Success state | User approves (in whole or per-operation); proceeds to Step 12 |

### Step 12 — Preview

| Aspect | Detail |
|---|---|
| User action | Reviews the visual effect of the approved plan before it's durably applied — inspects the affected section(s) on the canvas |
| System action | Applies the operations to an in-memory/scratch copy of the `ThemeModel` (not yet persisted) and re-renders the affected region for preview |
| AI action | None (preview is deterministic application of already-planned operations) |
| Data required | Scratch `ThemeModel`, `preview-token` for the render surface |
| API/integration | `/editor/*` — preview-token; `/theme/*` — model (read, scratch variant) |
| UI required | Inline before/after overlay or split view on the canvas (doc 19 §19.4.4, §19.4.7 step 3), device switcher remains active so the user can preview across breakpoints |
| Validation | Preview render must succeed for every affected section — a render failure here blocks progression to Apply rather than silently showing a broken preview |
| Error states | Preview render failure (malformed generated Liquid/CSS in a generative operation) — surfaced with the specific failing operation flagged, rest of plan still previewable |
| Loading states | Per-section "rendering preview…" shimmer on affected canvas regions |
| Empty states | N/A |
| Success state | User confirms the preview looks correct; proceeds to Step 13 |

### Step 13 — Apply

| Aspect | Detail |
|---|---|
| User action | Confirms "Apply" (or the plan was pre-approved for auto-batch application of `safe` ops in Step 11) |
| System action | Executes the plan for real against the working `ThemeModel`, in order, via the Executor; each applied operation immediately produces its own `Diff` (architecture core §4) so partial application is never ambiguous (Design Principle 6) |
| AI action | None (execution is deterministic once the plan is approved) |
| Data required | `ThemeOperation` (status transitions: queued → applying → applied/failed), `Diff` per operation |
| API/integration | `/ai/*` — execute-plan; `/editor/*` — save |
| UI required | Per-operation progress list (doc 19 §19.4.7 step 4); canvas updates incrementally as each operation lands |
| Validation | Each operation re-validated immediately before execution (doc 15) in case the model shifted between planning and applying |
| Error states | Mid-plan execution failure — remaining unapplied operations are halted, already-applied ones stay applied (each is independently reversible), user shown exactly which operations succeeded/failed with a retry-remaining or rollback-applied action |
| Loading states | "Applying (2/4)…" progress state |
| Empty states | N/A |
| Success state | All operations applied; `ThemeVersion` working copy updated; proceeds to Step 14 |

### Step 14 — Diff review

| Aspect | Detail |
|---|---|
| User action | Reviews the cumulative `Diff` for this change (or session of changes) before deciding to publish or keep iterating |
| System action | Renders `Diff.entries[]` with `humanSummary` per entry, grouped by the operation/plan that caused them |
| AI action | None |
| Data required | `Diff`, `ThemeVersion` |
| API/integration | `/theme/*` — diff |
| UI required | Diff timeline/list (doc 19 §19.3 "Versions" area), each entry showing before/after values and a link back to the affected section on the canvas |
| Validation | N/A (read-only) |
| Error states | N/A |
| Loading states | N/A (diff data is already computed as a byproduct of Step 13) |
| Empty states | If no net changes exist since the last published version (e.g., user undid everything), shows "No changes to publish" and disables the Publish CTA |
| Success state | User is satisfied and proceeds to Step 15, or returns to Step 10 to request more changes first |

### Step 15 — Publish to Shopify (or keep as draft)

| Aspect | Detail |
|---|---|
| User action | Chooses "Publish live" or "Save as unpublished theme" (keep working without going live) |
| System action | Serializes the current `ThemeModel` back to Liquid/JSON files (Theme Serializer, doc 09 §5), pushes the file set to Shopify via the Admin API, and either sets the theme role to `main` (publish) or leaves it as `unpublished`/`development` on Shopify |
| AI action | None |
| Data required | Serialized theme files, `PublishHistory` record, `ThemeVersion` (marked published or not) |
| API/integration | `/shopify/*` — publish |
| UI required | Publish confirmation dialog summarizing what will go live (count of changed sections/settings, any `destructive`-risk operations included); explicit secondary "Save as draft" action that never touches the live storefront |
| Validation | Full validation pipeline (doc 15) re-run on the complete serialized file set immediately before push — catches anything that slipped past per-operation validation when operations compose |
| Error states | **Publish rejected by Shopify validation** (invalid Liquid, schema violation, theme-check failure) — detailed in §6.4; Shopify API/network failure during push (retryable, theme not left partially published — Shopify's own theme publish is atomic) |
| Loading states | "Publishing to Shopify…" blocking state on the publish dialog with staged messaging (serializing → uploading → activating) |
| Empty states | N/A |
| Success state | Theme is live (or safely saved as an updated unpublished theme); `PublishHistory` entry created; user shown a success confirmation with a "View live store" link and routed toward Step 16 |
| **Diverges from Dropmagic** | Dropmagic gates publish behind its $79/mo Pro tier and free-tier users reportedly cannot publish at all **[SEARCH-SNIPPET, consistent, research §3/§8]**; Shopforge additionally offers a **non-monetary** reason to not-publish — saving as a draft/unpublished theme is a normal, expected iteration state, not a paywall workaround. |

### Step 16 — Post-publish iteration loop

| Aspect | Detail |
|---|---|
| User action | Returns (same session or later) to request further changes |
| System action | Loads the now-published `ThemeVersion` as the new baseline; subsequent edits create a new working `ThemeVersion` derived from it |
| AI action | Same conversational/planning loop as Steps 10–13, now operating against the live theme's current state |
| Data required | Same as Steps 9–13, with `ThemeVersion.parentVersionId`-style lineage tracked |
| API/integration | Same groups as Steps 9–15 |
| UI required | Same Visual Editor/AI Workspace shell; toolbar clearly indicates "editing live theme" vs. "editing draft" state (doc 19 §19.4.2) |
| Validation | Same as prior steps |
| Error states | Same as prior steps |
| Loading states | Same as prior steps |
| Empty states | N/A |
| Success state | Loop continues indefinitely — this is the steady state of product usage, not a terminal step |
| **Diverges from Dropmagic** | This entire loop is the product's second major differentiator. One independent Dropmagic reviewer explicitly characterizes it as "a one-shot generator with no post-launch optimization" **[VERIFIED, research §3/§11, though a lower-confidence contradicting source exists]** — Shopforge is architected around the opposite assumption: publish is a checkpoint, not an ending. |

### Step 17 — Version history / rollback

| Aspect | Detail |
|---|---|
| User action | Browses `ThemeVersion` history, inspects diffs between any two versions, restores a prior version (full rollback) or reverts a single past operation |
| System action | Restores either from a `ThemeSnapshot` (full-file-tree backup taken pre-destructive-operation) or by replaying inverse `Diff` entries for a single-operation revert |
| AI action | None |
| Data required | `ThemeVersion` list, `ThemeSnapshot`, `Diff`, `PublishHistory` |
| API/integration | `/theme/*` — versions, restore, snapshot |
| UI required | Version timeline (doc 19 §19.3 "Versions" area) with per-version publish status, diff-between-versions comparison view, restore confirmation |
| Validation | Restoring to a snapshot that predates a since-changed Shopify-side theme structure (e.g., user manually edited the theme in Shopify's own admin in the meantime) is flagged with a conflict warning rather than silently overwritten |
| Error states | Snapshot restore failure (corrupted/missing snapshot — should be rare given snapshot creation is mandatory pre-destructive-op per Design Principle 6); conflict between Shopforge's last-known state and Shopify's actual current state |
| Loading states | "Restoring version…" blocking state, staged like publish |
| Empty states | A brand-new `Theme` with only its initial imported version shows a single-entry timeline, not an empty state, since the import itself counts as version 1 |
| Success state | Working `ThemeModel` reflects the restored version; user can review (Step 14) and re-publish (Step 15) as normal |

## 5. Secondary journey — Path B: new store, no meaningful existing theme

This path exists for a real Shopforge use case — a merchant setting up a brand-new store, or one whose existing theme is so minimal/broken it isn't worth preserving — while staying true to the product's architecture. **Shopforge does not have a from-scratch generation pipeline.** Instead, Path B re-enters the exact same Import & Parse pipeline as Path A (§4 Steps 6–17), using Shopify's **Dawn** starter theme (or another Shopify-provided Online Store 2.0 base theme) as the input in place of a merchant's own theme.

| Aspect | Detail |
|---|---|
| Step B1 — User action | From Onboarding (§4 Step 3), chooses "Start a new store" |
| Step B1 — System action | Presents a choice of starter base themes (Dawn as the default/recommended, since it is Shopify's actively-maintained OS 2.0 reference theme with full section-schema coverage; other Shopify free themes optionally listed) |
| Step B1 — AI action | None yet |
| Step B1 — Data required | None persisted yet beyond the `Organization` |
| Step B1 — UI required | Starter theme picker with a short description of each ("Dawn — Shopify's modern, minimal default, best AI-editing compatibility") |
| Step B2 — User action | Still connects a Shopify store via OAuth (a Shopify store must exist to eventually publish to) — this reuses §4 Step 4 exactly; the only difference from Path A is *which theme gets imported*, not whether a store connection happens |
| Step B2 — System action | Installs the chosen starter theme onto the connected store (creating it as a new, unpublished theme via the Shopify Admin API) if the store doesn't already have it, then imports it |
| Step B3 onward | Converges fully into §4 Step 6 (Theme Import & Parse) treating the starter theme exactly as any other imported theme — parsed into a `ThemeManifest`, built into a `ThemeModel`, summarized in a Store/Theme Overview, and edited via the identical AI Workspace/Visual Editor loop |
| Optional enrichment | At the Overview step (§4 Step 8), Path B users may optionally be offered a one-time "tell us about your store" prompt (product category, brand tone, optionally a product URL to seed initial copy/imagery) — this is the *closest* Shopforge gets to Dropmagic's product-URL intake, but it feeds into the same `Operation Plan`-driven editing loop as any other AI request, never a separate hidden generation step |
| **Diverges from Dropmagic** | This is the deliberate divergence point. Dropmagic's product-URL/niche-description intake **produces the store directly** on a proprietary editor **[SELF-REPORTED, research §3]**. Shopforge's equivalent intake produces nothing on its own — it is just the first natural-language request fed into the same Operation Planner that handles every other request, operating on a real, parsed Dawn theme from the very first AI turn. There is no point in Path B where Shopforge writes theme code the user cannot see as a reviewable, reversible `Operation`. |

## 6. Error and edge flows (detailed)

### 6.1 Theme parse failure — unsupported/vintage (pre-Online-Store-2.0) theme

| Aspect | Detail |
|---|---|
| Trigger | Theme Parser (doc 07) detects no `templates/*.json` files / no section `{% schema %}` blocks consistent with OS 2.0 — i.e., a legacy theme built entirely from monolithic `.liquid` templates |
| System response | Parser does not silently fail — it completes a best-effort partial parse (locales, assets, theme settings are usually still extractable) and flags the theme as `parseStatus: "unsupported-legacy"` rather than throwing an unrecoverable error |
| User-facing message | "This theme was built before Shopify's Online Store 2.0 update, so Shopforge can only partially map its structure — AI editing will be limited to theme settings and assets, not individual sections. We recommend switching to an OS 2.0 theme (or starting fresh from Dawn) for full AI editing." |
| Recovery path | Three options presented: (1) proceed with limited editing (settings/assets only, no `add_section`/`move_section`/block-level operations since no section schema exists to reason about), (2) pick a different, OS2.0-compatible theme from the same store if one exists, (3) switch into Path B (Dawn-based) and treat the vintage theme as reference only |
| Data/logging | `Theme.parseStatus` persisted so the Overview and Editor consistently gate section-level operations off for this theme without re-detecting on every load |

### 6.2 Shopify OAuth failure

| Aspect | Detail |
|---|---|
| Trigger | User declines consent, OAuth callback returns an error code, token exchange fails, or granted scopes are insufficient for required functionality |
| System response | Callback handler distinguishes failure types: user-declined (no retry needed, just re-offer the connect CTA), scope-insufficient (explain which scope is missing and why it's needed, re-initiate with corrected scope request), transient/network (auto-retry once, then surface manual retry) |
| User-facing message | Scope-insufficient example: "Shopforge needs permission to read and write theme files to import and edit your store. Please grant theme access to continue." |
| Recovery path | "Try connecting again" CTA restarts Step 4 cleanly; no partial `ShopifyStore`/`ShopifyInstallation` record is left in an ambiguous state — either the connection fully succeeds or nothing is persisted |
| Loading/edge note | If the failure happens on a *reconnection* (existing `ShopifyInstallation` whose token was revoked externally), the user sees a distinct "reconnect" messaging path from Store Settings rather than being routed back through Onboarding |

### 6.3 AI timeout during clarification

| Aspect | Detail |
|---|---|
| Trigger | The Clarification System (doc 13) call to the AI Gateway exceeds its latency budget or the provider fails to respond within the configured timeout (doc 10 §7 fallback chain exhausted) |
| System response | AI panel shows a distinct "taking longer than expected…" state after a short grace period, then a definitive timeout state if the fallback chain is exhausted; the in-progress `AIConversation`/`AIMessage` is preserved (not discarded) so the user doesn't lose their original request |
| User-facing message | "We couldn't get a response in time. Your message is saved — you can try again or rephrase your request." |
| Recovery path | "Retry" re-sends the same message through the Gateway (which may route to a fallback provider per doc 10 §4/§7); user can also edit/simplify the original request, which often resolves timeouts caused by overly broad context selection (doc 12) |
| Data/logging | Timeout recorded as an `AIUsageEvent` with `finishReason: "error"` and zero/partial credit charge (no charge for a response that never completed, per Design Principle 9 cost-aware AI) |

### 6.4 Publish rejected by Shopify validation

| Aspect | Detail |
|---|---|
| Trigger | Shopify's own theme validation (Liquid syntax check, `theme-check`-equivalent rules, or Admin API rejection) fails on the serialized file set pushed in Step 15, despite passing Shopforge's own pre-push validation pipeline (doc 15) |
| System response | Publish is not partially applied — Shopify's theme publish is atomic, so the store's live theme is untouched; Shopforge captures Shopify's specific rejection reason(s) and maps them back to the responsible `Operation`(s)/section(s) where possible |
| User-facing message | "Shopify rejected this update: [specific reason, e.g. 'Invalid Liquid syntax in sections/hero-banner.liquid']. The affected change has been flagged for review — your live store was not modified." |
| Recovery path | If the rejection traces to a specific generative operation (`modify_liquid`/`create_section_file`/etc.), that operation is offered for AI-assisted repair (re-generate with the Shopify error as additional context) or manual removal from the plan before retrying publish; if it traces to something outside Shopforge's own changes (e.g., a pre-existing theme issue surfaced only at publish time), the user is clearly told this predates their edits |
| Data/logging | Rejection recorded on `PublishHistory` with status `rejected` and the raw Shopify error payload retained for support/debugging, distinct from a successful publish record |

## 7. Full journey diagram (ASCII)

```
 Landing ──▶ Sign up/Login ──▶ Onboarding (choose path)
                                       │
                 ┌─────────────────────┴─────────────────────┐
                 ▼ Path A                                     ▼ Path B
     Connect Shopify Store (OAuth)              Pick starter theme (Dawn) + Connect Store
                 │                                             │
                 ▼                                             ▼
        Select theme to import                     Starter theme installed on store
                 │                                             │
                 └─────────────────────┬───────────────────────┘
                                       ▼
                        Theme Import & Parse (async job)
                        ── error: unsupported/vintage theme (§6.1)
                                       │
                                       ▼
                          Manifest → Theme Model build
                                       │
                                       ▼
                    Store/Theme Overview (capability summary)
                                       │
                    ┌──────────────────┴──────────────────┐
                    ▼                                       ▼
             AI Workspace entry                     Visual Editor entry
                    └──────────────────┬──────────────────┘
                                       ▼
                     AI conversation / clarification loop
                     ── error: AI timeout (§6.3)  ── loops until unambiguous
                                       │
                                       ▼
                         Operation Plan review (risk-tiered)
                                       │
                                       ▼
                                    Preview
                                       │
                                       ▼
                                     Apply
                     ── partial-failure: per-op rollback, rest stays applied
                                       │
                                       ▼
                                 Diff review
                                       │
                          ┌────────────┴────────────┐
                          ▼                           ▼
                 Publish to Shopify            Save as draft/unpublished
                 ── error: rejected by                  │
                    Shopify validation (§6.4)            │
                          │                              │
                          └──────────────┬────────────────┘
                                        ▼
                       Post-publish / continued iteration loop
                                        │
                                        ▼
                          Version history / rollback (any time)
```
