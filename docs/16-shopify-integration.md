# 16 — Shopify Integration

## 1. Purpose and Scope

This document specifies how Shopforge connects to a merchant's Shopify store, imports their existing theme, and reads/writes theme files: OAuth connect and app installation, theme listing, theme selection/import, theme duplication (the safe-default working-copy model), file reads/writes, preview, publish, and rollback.

Every factual claim about Shopify's platform below carries a verification tag — **[Verified]**, **[Inferred]**, or **[Not found]** — traceable to `research-shopify-platform.md` (cited inline as `research §X.Y`). Nothing here states as fact anything the research could not confirm from an official Shopify source. Where the research itself flagged a claim as community-corroborated-only or partially verified, that caveat is carried forward rather than smoothed over.

This document feeds the entity names and API surface defined in `architecture-core.md` §5–6: `ShopifyStore`, `ShopifyInstallation` (OAuth tokens/scopes), `Theme`, `ThemeVersion`, `ThemeSnapshot`, `PublishHistory`, `AuditLog`, and the `/shopify/*` API group (oauth connect, list themes, import theme, publish, rollback).

**This document contains the definitive treatment of the single largest platform risk in the Shopforge architecture: the `write_themes` exemption requirement for public App Store apps (§10).** Every later doc that assumes Shopforge can write arbitrary theme files (docs 07–15, 19) is implicitly relying on the resolution path described there. Docs 23 (MVP scope) and 25 (final architecture) should treat §10 and §11 as load-bearing, not background reading.

---

## 2. OAuth Connect Flow & App Installation

**[Verified]** Shopify apps authenticate via OAuth against the Admin API; scopes map to specific GraphQL objects, not arbitrary strings — theme access specifically maps to the `OnlineStoreTheme` object (research §3.5, quoting the access-scopes reference: "read_themes, write_themes | OnlineStoreTheme").

### 2.1 Required scopes

| Scope | Grants | Status for a public App-Store app | Research ref |
|---|---|---|---|
| `read_themes` | Read access to `OnlineStoreTheme` — list themes, read theme metadata, read theme files | Freely grantable via standard OAuth scope request | **[Verified]** research §3.3, §3.5 |
| `write_themes` | Write access to `OnlineStoreTheme` — create/duplicate themes, upsert/delete theme files, publish themes | **Gated.** Since Admin API 2023-04, apps distributed via the Shopify App Store need a **Shopify-granted exemption** beyond simply requesting the scope | **[Verified, community-corroborated]** research §3.5 — see §10 below |

The legacy REST equivalent is a single `themes` scope covering both read and write of the Theme/Asset resources (**[Verified]**, research §3.1–3.2). REST Admin API is legacy as of Oct 1, 2024, and new public apps must build on GraphQL Admin API from April 1, 2025 onward (**[Verified]**, research §3.3, §3.5) — Shopforge's OAuth/scope design should therefore be written in terms of the GraphQL scopes (`read_themes`/`write_themes`), with REST treated as a non-path.

### 2.2 Connect flow (Shopforge-specific design, built on verified Shopify mechanics)

1. Merchant initiates "Connect Shopify store" from Shopforge. Shopforge redirects into Shopify's standard OAuth authorization flow, requesting `read_themes` and `write_themes`.
2. Shopify presents the merchant with the scope consent screen. **[Inferred]** — the research did not deep-dive OAuth consent-screen mechanics specifically, but this is standard Shopify OAuth behavior referenced throughout the docs ecosystem; the theme-specific detail worth flagging is that `write_themes` consent from the merchant is necessary but **not sufficient** — it does not by itself grant working `write_themes` API access for a public app (§10).
3. On approval, Shopify redirects back with an authorization code; Shopforge exchanges it for an access token and persists it on `ShopifyInstallation` (per `architecture-core.md` §5), scoped to the `ShopifyStore`.
4. Shopforge registers the mandatory `app/uninstalled` webhook (**[Verified]** research §3.7 — "mandatory webhook topic every Shopify app must handle; used to clean up session/access data when a merchant uninstalls the app") to revoke/clean up the `ShopifyInstallation` record on uninstall.
5. Shopforge should also register `themes/publish` (**[Verified]** research §3.7, exists in the `WebhookSubscriptionTopic` enum) so Shopforge's own `Theme`/`PublishHistory` records stay in sync if the merchant publishes a different theme directly from Shopify admin, outside Shopforge. See §12 for caveats on webhook firing-condition wording.

### 2.3 Post-install state

After install, `ShopifyInstallation` holds: access token, granted scopes (which may show `write_themes` as "granted" at the OAuth layer even before/without the App Store write exemption — see §10.2 on why "scope granted" ≠ "writes work"), and shop domain. No theme data is pulled at this stage; theme listing (§3) is a separate, explicit step triggered from the Shopforge UI.

---

## 3. Theme Listing

**[Verified]** The GraphQL Admin API exposes a paginated `themes(...)` query on the shop, filterable by role/name and orderable, alongside a single-theme `theme(id:)` query (research §3.3). Both require `read_themes`.

| Call | Purpose | Scope | Research ref |
|---|---|---|---|
| `themes(first:, query:, sortKey:)` (GraphQL) | List all themes in the store with id, name, role, processing status | `read_themes` | **[Verified]** research §3.3 |
| `theme(id:)` (GraphQL) | Single theme's metadata + file access | `read_themes` | **[Verified]** research §3.3 |
| `GET /admin/api/latest/themes.json` (REST, legacy) | List all themes | `themes` (legacy) | **[Verified]** research §3.1 — not the build target per §2.1 |

Each `OnlineStoreTheme` returned carries `id`, `name`, `prefix`, `createdAt`, `updatedAt`, `role` (`MAIN` / `UNPUBLISHED` / `DEMO` / `DEVELOPMENT`), `processing`, `processingFailed`, `themeStoreId` (**[Verified]** research §3.3). Shopforge's theme-picker UI lists all themes returned, surfacing `role` prominently so the merchant understands which one is currently live (`MAIN`) before selecting one to import.

**[Verified]** A store has a hard cap of 20 themes total (research §3.1), and only one theme can hold `role: main` (published) at a time (research §3.1, REST-documented; the GraphQL role enum mirrors this — **[Inferred]** that the same one-`MAIN`-at-a-time constraint applies identically on the GraphQL object, since both surfaces represent the same underlying store data). This cap matters directly for Shopforge's duplication strategy (§4): each import consumes one of the merchant's 20 theme slots, and Shopforge's UI/backend should track remaining slots and warn before an import would fail.

---

## 4. Theme Selection, Import & Full File Download

Once the merchant picks a theme from the list (§3), Shopforge must pull its entire file tree to feed the Theme Parser (doc 07).

**[Verified]** Shopify's own recommended GraphQL replacement for the legacy REST "get asset content" pattern is the `theme(id:)` query, which exposes a `files` connection (`OnlineStoreThemeFile`) filterable by filename and paginated (research §3.2–3.3: "GraphQL replacements recommended by Shopify: ... `theme` query (replaces GET)"). This is the intended mechanism for reading a theme's full file tree.

**[Not found]** — The research confirmed the existence and filterability of the `files` connection but did not confirm, from a directly fetched schema page, whether each `OnlineStoreThemeFile` node returns full file **content** (body) inline or only metadata (path, size, checksum) requiring a further per-file fetch. The now-legacy REST Asset API explicitly only returned metadata on its list endpoint and required a separate `GET` per asset for content (**[Verified]** research §3.2). Whether the GraphQL `files` connection avoids that N+1 pattern, or reproduces it, needs direct confirmation against the live `OnlineStoreThemeFile` schema before the Parser's ingestion layer (doc 07 §2) is finalized — this affects import latency and rate-limit budget for large themes (hundreds of files).

### 4.1 Import call sequence (as currently understood)

| Step | Call | Scope | Verification |
|---|---|---|---|
| 1 | `theme(id:)` — fetch theme metadata | `read_themes` | **[Verified]** research §3.3 |
| 2 | `theme(id:).files(first:, filenames:)` — enumerate + fetch file tree, paginated | `read_themes` | **[Verified]** connection exists and is filterable/paginated; **[Not found]** whether content is inline (see above) |
| 3 | Normalize into the flat `{ relativePath: rawContentBuffer }` shape (doc 07 §2) | — | Shopforge-internal, not a Shopify API concern |

**[Verified]** Pagination across Admin GraphQL APIs generally is capped at 25,000 objects (research §3.6) — theoretically enough headroom for even very large themes' file counts, though this cap applies broadly, not confirmed theme-files-specifically.

Import writes a `Theme` + first `ThemeManifest` (via the Parser) into Shopforge's own DB; the raw imported file tree is not yet a Shopforge working copy at this point — see §5.

---

## 5. Theme Duplication — The Safe-Default Working Copy Model

**Design decision: Shopforge never edits the merchant's live (`role: MAIN`) theme directly. Every import creates a duplicate "Shopforge working copy" theme, and all Operations (doc 11), Diffs (doc 14), and edits apply to that duplicate until the merchant explicitly publishes.** This is the default and, for the MVP, the *only* mode — there is no "edit live theme directly" toggle.

### 5.1 Mechanism

**[Verified]** The GraphQL Admin API exposes `themeDuplicate` — "clone an existing theme, optional new name" (research §3.3). New themes created via `themeCreate` default to `role: UNPUBLISHED` (**[Verified]** research §3.3); the same is true of duplication in practice per the theme role model. The Shopify CLI has an analogous local-tooling command, `theme duplicate` — "Copies an existing theme locally after pushing it to Shopify" (**[Verified]** research §2.1), useful for Phase 0 engineering validation (§10.4) but not the runtime path for a hosted app.

| Call | Purpose | Scope | Verification |
|---|---|---|---|
| `themeDuplicate(id:, name:)` | Create the Shopforge working-copy theme from the merchant's selected theme | `write_themes` (+ exemption, §10) | **[Verified]** mutation exists; research §3.3 |
| `themeCreate(source:, name:)` | Alternate path: create from a staged/external ZIP upload rather than duplicating an in-store theme | `write_themes` (+ exemption, §10) | **[Verified]** research §3.3 |

Shopforge names the duplicate distinctly (e.g. `"{original name} — Shopforge Draft"`) and records it as a new `Theme`/`ThemeVersion` pair pointing at the new `shopifyThemeId`, distinct from the original theme's `Theme` record. Role at creation is `UNPUBLISHED` (or `DEVELOPMENT`, one of the four confirmed role values — research §3.1/§3.3); the exact role Shopforge should request is an implementation detail to pin down against live `themeDuplicate` behavior, not something the research confirmed at the level of "which role does `themeDuplicate` default new copies to."

### 5.2 Why duplicate-first is the right default

- **Matches Design Principle 1** (`architecture-core.md` §7 — "Preserve the existing theme") and Principle 6 ("Everything is reversible"): a duplicate that the merchant hasn't published is inherently safe to iterate on; nothing storefront-visible changes until Publish.
- **Matches how Shopify itself models risk**: only one theme can be `role: MAIN` at a time (§3), and Shopify's own workflow guidance (CLI: pull → dev → push → publish, **[Verified]** research §2.1) treats "live" and "in-progress" as separate theme objects, not separate states of one theme object. Shopforge mirrors that model rather than inventing a new one.
- **Bounded cost**: each duplicate consumes one of the store's 20-theme cap (§3) — Shopforge should let a merchant reuse/overwrite an existing Shopforge working-copy theme across a session rather than minting a fresh duplicate per edit, to avoid exhausting the cap on long engagements.
- **Consistent with the write-access story in §10**: whether or not the `write_themes` exemption is secured, duplicating *into* a separate unpublished theme (rather than mutating `MAIN` in place) is the lower-risk pattern Shopify's own review guidance gestures toward (research §4.4) — it keeps the merchant's live storefront untouched by construction, independent of Shopforge's own bug surface.

### 5.3 What stays on the duplicate vs. what reaches `MAIN`

All `Operation`/`Diff` writes (`architecture-core.md` §3–4) target the working-copy theme's files via `themeFilesUpsert` (§6). The original imported theme (and the merchant's live `MAIN` theme, if different) are never touched by these writes. The working copy is only pushed live via the explicit Publish action (§8), which the merchant triggers deliberately — never automatically, never as a side effect of an AI Operation being accepted into the model.

---

## 6. Theme File Reads (Parser Input)

Covered in detail in §4 (import) — the same `theme(id:).files` mechanism (**[Verified]** connection exists; **[Not found]** content-inline question, research §3.2–3.3) is used both for the initial import and for any later re-sync (e.g. detecting drift if the merchant edits the working-copy theme directly in Shopify's own theme editor while a Shopforge session is open). Re-sync triggers and drift-detection logic are a Shopforge-internal design (doc 07 §7, `themeVersionHash`), not a Shopify API concern.

---

## 7. Theme Update / File Writes

**[Verified]** The GraphQL mutation for writing theme files is `themeFilesUpsert(themeId:, files:)` — batch create/update, max **50 files per request**, each file specifying a `filename` and a `body` of type `TEXT` (plain text — Liquid/JSON/CSS/etc.), `BASE64` (binary), or `URL` (fetch from remote URL). Returns `upsertedThemeFiles`, an optional async `job` for large/bulk operations, and `userErrors`. Requires `write_themes` (research §3.3) — **and the App Store write exemption for public apps** (§10).

| Call | Purpose | Batch limit | Scope | Verification |
|---|---|---|---|---|
| `themeFilesUpsert(themeId:, files:)` | Create/update theme files (replaces legacy REST `PUT .../assets.json`) | 50 files/request | `write_themes` (+ exemption) | **[Verified]** research §3.2–3.3 |
| `themeFilesDelete` | Delete theme files (replaces legacy REST `DELETE .../assets.json`) | Not independently confirmed in depth | `write_themes` (+ exemption) | **[Verified]** mutation referenced as the GraphQL replacement; **not individually fetched in depth** (research §3.3) |
| `themeFilesCopy` | Copy/duplicate theme files | Not independently confirmed in depth | `write_themes` (+ exemption) | **[Verified]** mutation referenced as the GraphQL replacement; **not individually fetched in depth** (research §3.3) |
| `themeUpdate` | Modify theme-level attributes (name, etc.) | — | `write_themes` (+ exemption, for attribute mutation generally) | **[Verified]** research §3.3 |

**[Verified]** Protected/required theme files (e.g. `layout/theme.liquid`) cannot be deleted via the Asset API — returns 403 Forbidden (research §3.2, §4.4). This constraint should be assumed to carry over to `themeFilesDelete` even though it wasn't independently re-confirmed on the GraphQL mutation specifically (**[Inferred]**, same underlying protected-file concept).

Shopforge's Theme Serializer (doc 09/14's write-back path) batches `Diff`-derived file changes into `themeFilesUpsert` calls against the working-copy theme's `shopifyThemeId`, respecting the 50-files-per-request cap by chunking large multi-file Operations (e.g. a full theme-wide style change touching many section files).

---

## 8. Theme Preview

**[Verified]** Shopify CLI ships `theme open` ("Returns preview links for a specified theme"), `theme share` ("Uploads local theme as a new unpublished theme in the theme library — shareable preview link"), and `theme preview` ("Applies a JSON overrides file to a theme and creates/updates a preview") (research §2.1). These confirm that Shopify has a preview-link mechanism for unpublished themes as a general platform capability.

**[Not found]** The research did not confirm the exact server-side Admin API mechanism (mutation/field, or the preview URL's construction) that a **hosted third-party app** (as opposed to a developer running the CLI locally) would use to generate or display a preview link for an unpublished theme at runtime. The CLI commands above are developer-tooling-oriented and were not confirmed to have a direct GraphQL Admin API equivalent callable from a server. Before building the in-app "Preview" button, this needs direct confirmation against the live Admin API docs (likely candidates: a preview-URL field on `OnlineStoreTheme`, or a themed-store URL pattern using the theme's numeric id — neither confirmed here).

Until confirmed, Shopforge's design should treat "generate/display a live preview of the working-copy theme" as depending on a to-be-verified API detail, not an already-confirmed integration point — flagged for the engineering spike in §10.4.

---

## 9. Theme Publish

**[Verified]** `themePublish(id:)` publishes a theme — makes it live, sets `role: MAIN`. Requires `write_themes` **and the Shopify-granted exemption** (research §3.3, citing "per docs synthesis" on the exemption requirement specifically for `themePublish`).

| Call | Purpose | Scope | Verification |
|---|---|---|---|
| `themePublish(id:)` | Publish a theme (set `role: MAIN`) | `write_themes` (+ exemption, §10) | **[Verified]** research §3.3 |
| `PUT /admin/api/latest/themes/{id}.json` with `role` field (REST, legacy) | Update a theme incl. publishing | `themes` (legacy) | **[Verified]** research §3.1 — not the build target |

**[Verified]** Publishing a new theme completes only after async file-extraction finishes, which "can take minutes" (research §3.1, REST-documented; **[Inferred]** the same async-completion behavior applies to the GraphQL `themePublish` path, since it operates on the same underlying processing pipeline — `processing`/`processingFailed` fields exist on `OnlineStoreTheme` per research §3.3). Shopforge's Publish flow should poll/await theme processing completion rather than treating the mutation's return as instantaneous success, and should record a `PublishHistory` entry (`architecture-core.md` §5) only once processing is confirmed complete.

In Shopforge's model (§5.3), Publish is the single point where the working-copy theme's content becomes the merchant's live storefront — it is the only Shopify write that should ever target/produce a `role: MAIN` outcome, and it happens only on explicit merchant action, never automatically.

---

## 10. The `write_themes` Exemption — Critical Path

This is the single most consequential platform-risk finding for Shopforge. It gates the product's core promise and is treated here as a first-order business/architecture risk, not a footnote.

### 10.1 The finding, stated precisely

**[Verified, community-corroborated]** Since Admin API 2023-04, **apps distributed via the Shopify App Store need a Shopify-granted exemption** to perform theme-file write operations using `write_themes` — this covers legacy REST Asset `PUT`/`DELETE`, and the GraphQL `themeFilesUpsert`, `themeFilesDelete`, `themeFilesCopy`, and `themePublish` mutations (research §3.2, §3.5, §4.4). Requesting/being granted the `write_themes` **scope** in the Partner Dashboard or `shopify.app.toml` is necessary but **not sufficient** — real write access additionally requires an explicit, separate approval from Shopify.

**[Verified]** The App Store review guidance states directly: "Modifications to an online store theme must use theme app extensions" — listed as a common app-review failure point for "Online store apps" (research §1.14, §4.4). This is the officially sanctioned default integration path for third-party apps: **Theme App Extensions** (app blocks placed inside sections, and app embed blocks toggled site-wide), not direct arbitrary theme-file rewriting (research §1.12–1.14, §4.4).

**[Verified, community-corroborated only — flagged by the research as not confirmed on a single canonical shopify.dev page]** Several 2024–2025 developer-forum threads report `write_themes`/`themeFilesUpsert` calls being blocked by an undocumented `write_themes_assets`-style permission error even after the scope shows as granted, indicating this approval gate is a live, ongoing friction point for third-party developers, not a one-time formality (research §3.5).

### 10.2 Why Theme App Extensions alone cannot satisfy Shopforge's core promise

Shopforge's core promise is: parse a merchant's *existing* theme and make *minimal, targeted edits to its actual files* — adjusting an existing section's settings, restructuring templates, generating or modifying an existing section's Liquid, tweaking global styles in `settings_data.json` (`architecture-core.md` §2–3, the `ThemeModel`/`Operation` system). Theme App Extensions are structurally the wrong shape for this:

- **[Verified]** App blocks/embeds are *additive* content the app supplies, which the **merchant** places into a section (or toggles site-wide) via the theme editor (research §1.12–1.14, §4.1–4.2). The app does not choose where they go, and critically, the app cannot use them to reach into and rewrite a section file the merchant already has — an app block only works inside a section already built to accept `@app`-type blocks (research §1.12).
- **[Verified]** App blocks are only supported in JSON-template-driven (OS 2.0) sections, not statically-rendered sections, and cannot render on checkout pages at all (research §1.12, §1.14).
- **[Verified]** `isAppBlockCompatible` (an existing `ThemeManifest` field, `architecture-core.md` §1) already encodes this asymmetry: it is a **derived flag on section entries**, because whether a given section can even accept an app block is a per-section fact of the merchant's theme code, not something Shopforge or any app controls.

In short: Operations like `update_setting` on an *existing* hero section's headline, `modify_liquid` on an *existing* product-card snippet, or `update_global_style` against `settings_data.json` are edits to files the merchant already has — none of these are expressible as "drop an app block into a slot," because there is no slot for "change this file that already exists." Theme App Extensions solve a different problem (an app contributing new, merchant-placed UI), not Shopforge's problem (an AI editing the merchant's own theme code). **[Inferred conclusion, built from the verified building blocks above.]**

### 10.3 The precedent: this exemption is evidently obtainable

**[Inferred, based on Shopforge's competitor research — not part of `research-shopify-platform.md`]** Established page/theme-builder apps live on the Shopify App Store today — Replo (confirmed by Shopforge's separate competitor research to write real Liquid files), and by the same operating model, GemPages, PageFly, and Shogun — are functioning App Store apps that write directly to merchant theme files. Their existence demonstrates the `write_themes` exemption is a **standard, if gated, approval path for legitimate theme/page-builder apps**, not a hard platform blocker. This is a business-development dependency (an approval relationship with Shopify), not an unsolved engineering problem — but it is a **dependency with its own timeline and risk**, not a formality to defer.

### 10.4 Recommendation: Phase 0/Phase 1 gating milestone, not a later step

Given §10.1–10.3, Shopforge should:

1. **Start the `write_themes` exemption application in parallel with earliest engineering, as an explicit Phase 0/Phase 1 milestone** — not something requested after the product is built. Apply to Shopify Partner support with a clear, specific stated use case ("AI-assisted customization of a merchant's existing theme files, via an interactive editor with per-change preview and rollback" — framed around the same safety properties this document specifies: duplicate-first working copies, never touching `MAIN` directly, full diff/undo history). The precedent in §10.3 suggests a well-scoped, safety-conscious use case is approvable, but the exact criteria are unconfirmed (§11).
2. **De-risk engineering so it is not blocked on the partner-approval timeline**, by validating the full pipeline — Theme Parser → Manifest → Model → AI Operation → Serializer (docs 07–15) — against two environments that do not depend on the App Store exemption:
   - **Locally-downloaded / Shopify-CLI-pulled theme files** (`theme pull`, **[Verified]** research §2.1) — exercises the Parser/Manifest/Model/Diff logic entirely offline, no live write-scope needed at all.
   - **A Shopify development store**, where `write_themes` mutations can be exercised directly without the public-App-Store exemption gate, since dev stores / unlisted custom apps are understood to sit outside the App-Store-distribution restriction that triggers the exemption requirement (**[Inferred]** — the research confirmed dev stores exist as the standard partner sandbox for building/testing themes and apps, research §2.2, and separately confirmed the exemption requirement is specifically scoped to "apps distributed via the Shopify App Store," research §3.5 — the inference that a non-App-Store-distributed installation on a dev store is not subject to the same gate follows from those two facts but was not independently confirmed as a single explicit statement in the research).
   - This lets Theme Parser/Model/Operation/Diff/Serializer engineering (docs 07–15) proceed on its own timeline while the exemption application runs in parallel, rather than in sequence.
3. **Treat the Theme Access app model** (a free App Store app issuing merchants a one-time, `write_themes`-scoped, time-limited password — **[Verified]** research §3.5) as a possible interim/fallback distribution shape worth evaluating if the public-app exemption stalls, though it changes the installation UX (merchant-issued password vs. standard OAuth) and was not evaluated in depth here.

---

## 11. Open Questions for Direct Confirmation with Shopify

Ranked by architectural/business impact. All are gaps the research explicitly could not close from official docs alone (research §6).

1. **`write_themes` exemption — apply and secure it. [Top priority, gating milestone per §10.4.]** The existence of the gate is verified; the *exact* approval criteria, required application materials, and expected timeline are not (research §3.5, §4.4, §6.1). This is the #1 item to resolve directly with Shopify Partner support, and the one this whole document treats as the primary open risk.
2. **Exact GraphQL Admin API rate-limit figures.** Two conflicting sets of points/second numbers surfaced during research — 50/100/500 vs. 100/200/1000/2000 by plan tier — with the higher figures coming from a direct fetch of the official limits page but flagged as needing re-confirmation at implementation time since these numbers are known to change (research §3.6, §6.2). Needed to size `themeFilesUpsert` batching and import-time file-fetch throughput (§4, §7).
3. **Exact `write_themes` exemption approval criteria**, beyond "an exemption exists." Community-forum-sourced use-case categories (theme backup/restore, adding Liquid to repeating blocks, SEO/content-locking/dev-tooling) were found but not confirmed as an official, current, or exhaustive list (research §3.2, §3.5). Whether "AI-assisted theme editing" cleanly fits an approved category, or needs bespoke justification, is unknown until asked directly.
4. **`themes/update` webhook topic and exact `themes/publish` firing semantics.** `themes/publish`'s existence is confirmed in the `WebhookSubscriptionTopic` enum, but its precise firing-condition wording was sourced from community discussion rather than a direct fetch of the enum's field description; `themes/update` was referenced only in a community-thread title and not independently confirmed to exist at all (research §3.7, §6.4). Needed for keeping Shopforge's `Theme`/`PublishHistory` records in sync with out-of-band changes (§2.5).
5. *(Secondary, lower immediate impact)* REST Admin API call-limit specifics (≈40 calls/sec, `X-Shopify-Shop-Api-Call-Limit` header) — largely moot given the GraphQL-first mandate (§2.1), but worth confirming if any REST fallback is ever planned (research §6.3).
6. *(Secondary)* Whether the GraphQL `theme(id:).files` connection returns file content inline or requires a further per-file fetch (§4) — affects import performance engineering but not the product's viability.

---

## 12. Rate Limits & Webhooks

**Rate limits [Verified, with flagged discrepancy]**: The GraphQL Admin API uses cost-based ("leaky bucket") limiting, not simple call counts — every schema field has an assigned cost, a query's total cost is statically analyzed before execution, and cost is deducted from a per-shop bucket that refills at a plan-dependent points/second rate. A single query cannot exceed 1,000 points regardless of plan. Array-type input arguments are capped at 250 items across all Admin GraphQL APIs; pagination is capped at 25,000 objects. The plan-tier refill rates themselves have a confirmed discrepancy across sources (open question #2, §11) — do not hard-code specific numbers into rate-limit handling logic without re-confirming at implementation time. (research §3.6)

The Storefront API has no documented per-request rate limit (**[Verified]**, and separately confirms it is not the theme-editing surface — research §3.4). The Bulk Operations API is reported to have no max-cost/per-query limit, but this is **[partially verified]** — secondary-sourced, not independently fetched from a dedicated official page (research §3.6).

**Webhooks [Verified except where noted]**:

| Topic | Purpose | Verification |
|---|---|---|
| `app/uninstalled` | Mandatory; clean up `ShopifyInstallation`/session data on uninstall | **[Verified]** research §3.7 |
| `themes/publish` | Fires when a theme with `main` (or deprecated `mobile`) role is published | **[Verified]** topic exists in `WebhookSubscriptionTopic`; exact firing-condition wording is community-sourced, not a direct enum-field quote — **[flagged, re-verify at implementation time]** (research §3.7) |
| `themes/update` | Presumed to cover other theme file changes | **[Not found]** — referenced only in a community-thread title, not confirmed against an official enum page (research §3.7) |

Webhooks can be declared statically in `shopify.app.toml` for app-scoped subscriptions, or created per-shop via a GraphQL mutation (name inferred as `webhookSubscriptionCreate` by standard Shopify API convention — **[Inferred]**, not independently fetched, research §3.7).

---

## 13. What Shopify Magic Already Does (Baseline Competitor Reference)

**[Verified]**, per Shopify's own Help Center and Changelog (research §5), Shopify Magic — a free, plan-independent suite of AI features built into Shopify itself — currently covers:

- **Text generation**: product descriptions, email subject lines, headings.
- **Media generation**: background removal, logo generation, banner creation.
- **Theme editor content generation**: merchant enters a prompt (e.g. for a headline/subtitle/announcement) and Magic generates matching copy directly inside existing theme editor fields.
- **Theme block generation**: merchant describes a custom theme block in natural language; Magic generates the underlying Liquid for a *new* theme block on the spot (Horizon and other theme-block-supporting themes).
- **Theme generation**: AI-generated starter theme, from the Themes page in admin.
- **Sidekick**: Shopify's broader chat-based commerce assistant — Designer/Photo Editor/Writer/Tech Support/Marketer capabilities, plus admin task automation (pricing analysis, performance summaries, discount setup, etc.) — a distinct product surface from "Shopify Magic" branding.
- **Privacy**: Shopify states it does not use one merchant's store-level data to power Magic for other merchants.

**[Inferred conclusion from the verified feature list above, snapshot as of 2026-08-19]**: Shopify Magic's scope today is (1) generating/editing on-page copy inside existing theme editor fields, (2) generating brand-new theme blocks from a description, and (3) generating an initial starter theme. It does not appear, per available docs, to do open-ended, multi-file, whole-theme autonomous editing or refactoring of an existing complex theme's full file tree, or conversational iterative editing across multiple sections/templates at once. That gap is Shopforge's plausible differentiation area — and it is also exactly the capability that depends on resolving §10. Shopify could expand Magic's scope at any time; this is a point-in-time baseline, not a permanent competitive moat.

---

## Sources

All citations above trace to `research-shopify-platform.md` (dated 2026-08-19), which lists full source URLs (shopify.dev, help.shopify.com, and clearly-labeled secondary/community sources used only for corroboration). Refer to that file's "Sources" section for the underlying shopify.dev/help.shopify.com links behind each `research §X.Y` reference in this document.
