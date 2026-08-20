# 16 — Shopify Integration

## 1. Purpose and Scope

This document specifies how Shopforge connects to a merchant's Shopify store and gets Shopforge's own generated storefront live there: OAuth connect and app installation, theme listing (for slot-awareness and merchant visibility), installing and updating Shopforge's own Base Theme in the merchant's store, writing the Store Configuration onto it, preview, publish, and rollback.

Every factual claim about Shopify's platform below carries a verification tag — **[Verified]**, **[Inferred]**, or **[Not found]** — traceable to `research-shopify-platform.md` (cited inline as `research §X.Y`). Nothing here states as fact anything the research could not confirm from an official Shopify source. Where the research itself flagged a claim as community-corroborated-only or partially verified, that caveat is carried forward rather than smoothed over.

This document feeds the entity names and API surface used by doc 08 (Store Configuration Schema) and doc 07 (Section Library): `ShopifyStore`, `ShopifyInstallation` (OAuth tokens/scopes), `Theme` (Shopforge's installed Base Theme instance in a given merchant's store), `PublishHistory`, `AuditLog`, and the `/shopify/*` API group (OAuth connect, list themes, install/update Base Theme, publish Store Configuration, rollback). See doc 18 (API Architecture) for request/response shapes and doc 17 (Database Model) for persistence; neither is redefined here.

**This document contains the definitive treatment of the single largest platform risk in the Shopforge architecture: the `write_themes` exemption requirement for public App Store apps (§8).** Every later doc that assumes Shopforge can install/update its own theme in a merchant's store and publish the Store Configuration onto it (docs 07, 08, 09, 18) is implicitly relying on the resolution path described there. Docs 23 (MVP scope) and 25 (final architecture) should treat §8 and §9 as load-bearing, not background reading.

---

## 2. OAuth Connect Flow & App Installation

**[Verified]** Shopify apps authenticate via OAuth against the Admin API; scopes map to specific GraphQL objects, not arbitrary strings — theme access specifically maps to the `OnlineStoreTheme` object (research §3.5, quoting the access-scopes reference: "read_themes, write_themes | OnlineStoreTheme").

### 2.1 Required scopes

| Scope | Grants | Status for a public App-Store app | Research ref |
|---|---|---|---|
| `read_themes` | Read access to `OnlineStoreTheme` — list themes, read theme metadata, read theme files | Freely grantable via standard OAuth scope request | **[Verified]** research §3.3, §3.5 |
| `write_themes` | Write access to `OnlineStoreTheme` — create themes, upsert/delete theme files, publish themes | **Gated.** Since Admin API 2023-04, apps distributed via the Shopify App Store need a **Shopify-granted exemption** beyond simply requesting the scope | **[Verified, community-corroborated]** research §3.5 — see §8 below |

**Design decision:** Shopforge continues to request `read_themes` even though, unlike the old architecture, it no longer needs to read the *content* of a merchant's existing theme files at all. The remaining use is narrower but still real: listing the merchant's themes to check remaining slot availability against the 20-theme cap, and showing the merchant what already exists in their store before Shopforge installs its own Base Theme (§3, §4). If a future iteration drops that listing UI entirely, `read_themes` could in principle be dropped too — but requesting it costs nothing extra in the OAuth consent flow, so the default is to keep it.

The legacy REST equivalent is a single `themes` scope covering both read and write of the Theme/Asset resources (**[Verified]**, research §3.1–3.2). REST Admin API is legacy as of Oct 1, 2024, and new public apps must build on GraphQL Admin API from April 1, 2025 onward (**[Verified]**, research §3.3, §3.5) — Shopforge's OAuth/scope design should therefore be written in terms of the GraphQL scopes (`read_themes`/`write_themes`), with REST treated as a non-path.

### 2.2 Connect flow (Shopforge-specific design, built on verified Shopify mechanics)

1. Merchant initiates "Connect Shopify store" from Shopforge. Shopforge redirects into Shopify's standard OAuth authorization flow, requesting `read_themes` and `write_themes`.
2. Shopify presents the merchant with the scope consent screen. **[Inferred]** — the research did not deep-dive OAuth consent-screen mechanics specifically, but this is standard Shopify OAuth behavior referenced throughout the docs ecosystem; the theme-specific detail worth flagging is that `write_themes` consent from the merchant is necessary but **not sufficient** — it does not by itself grant working `write_themes` API access for a public app (§8).
3. On approval, Shopify redirects back with an authorization code; Shopforge exchanges it for an access token and persists it on `ShopifyInstallation` (doc 17), scoped to the `ShopifyStore`.
4. Shopforge registers the mandatory `app/uninstalled` webhook (**[Verified]** research §3.7 — "mandatory webhook topic every Shopify app must handle; used to clean up session/access data when a merchant uninstalls the app") to revoke/clean up the `ShopifyInstallation` record on uninstall.
5. Shopforge should also register `themes/publish` (**[Verified]** research §3.7, exists in the `WebhookSubscriptionTopic` enum) so Shopforge's own `Theme`/`PublishHistory` records stay in sync if the merchant publishes a different theme directly from Shopify admin, outside Shopforge — e.g. switching back to a pre-existing theme, which would demote Shopforge's installed theme from `MAIN`. See §10 for caveats on webhook firing-condition wording.

### 2.3 Post-install state

After install, `ShopifyInstallation` holds: access token, granted scopes (which may show `write_themes` as "granted" at the OAuth layer even before/without the App Store write exemption — see §8.2 on why "scope granted" ≠ "writes work"), and shop domain. No theme data is pulled at this stage; theme listing (§3) is a separate, explicit step, typically triggered the first time a merchant is ready to install Shopforge's Base Theme into their store.

---

## 3. Theme Listing

**[Verified]** The GraphQL Admin API exposes a paginated `themes(...)` query on the shop, filterable by role/name and orderable, alongside a single-theme `theme(id:)` query (research §3.3). Both require `read_themes`.

| Call | Purpose | Scope | Research ref |
|---|---|---|---|
| `themes(first:, query:, sortKey:)` (GraphQL) | List all themes in the store with id, name, role, processing status | `read_themes` | **[Verified]** research §3.3 |
| `theme(id:)` (GraphQL) | Single theme's metadata | `read_themes` | **[Verified]** research §3.3 |
| `GET /admin/api/latest/themes.json` (REST, legacy) | List all themes | `themes` (legacy) | **[Verified]** research §3.1 — not the build target per §2.1 |

Each `OnlineStoreTheme` returned carries `id`, `name`, `prefix`, `createdAt`, `updatedAt`, `role` (`MAIN` / `UNPUBLISHED` / `DEMO` / `DEVELOPMENT`), `processing`, `processingFailed`, `themeStoreId` (**[Verified]** research §3.3). In the new architecture, Shopforge lists themes primarily to check slot availability and show the merchant what's already in their store — **not** to let them pick an arbitrary theme to import or parse, which is no longer something Shopforge does at all. The listing UI surfaces `role` prominently so the merchant understands which theme is currently live (`MAIN`) before Shopforge installs its own Base Theme alongside it (§4).

**[Verified]** A store has a hard cap of 20 themes total (research §3.1), and only one theme can hold `role: main` (published) at a time (research §3.1, REST-documented; the GraphQL role enum mirrors this — **[Inferred]** that the same one-`MAIN`-at-a-time constraint applies identically on the GraphQL object, since both surfaces represent the same underlying store data). This cap matters directly for Shopforge's install strategy (§4): installing the Base Theme consumes one of the merchant's 20 theme slots, and Shopforge's UI/backend should track remaining slots and warn before an install would fail. Unlike the old duplicate-per-import model, the new architecture needs at most **one** slot per store for the lifetime of the connection (§4.2), so this is a much smaller ongoing concern than it used to be.

---

## 4. Installing the Base Theme

**Design decision:** Shopforge owns a single **Base Theme** — one controlled `layout/`, `sections/`, `snippets/`, `assets/`, `config/`, `templates/`, `locales/` tree containing a fixed library of ~40–60 **Sections** (Liquid Shopforge writes and maintains — never AI-generated; doc 07). Every generated store is built on this one foundation. Shopforge is not, at MVP, trying to support or edit an arbitrary merchant's pre-existing theme; the merchant's existing theme(s), if any, are only ever listed (§3), never read or written.

### 4.1 Mechanism

**[Verified]** The GraphQL Admin API exposes `themeCreate(source:, name:)`, which can create a new theme in a store from a staged/external ZIP source rather than duplicating an in-store theme (research §3.3). This is the mechanism Shopforge uses to install its Base Theme: `source` points at a ZIP/asset bundle of Shopforge's own Base Theme, built and hosted by Shopforge, not derived from anything in the merchant's store.

| Call | Purpose | Scope | Verification |
|---|---|---|---|
| `themeCreate(source:, name:)` | Create a new theme in the merchant's store from Shopforge's own Base Theme bundle | `write_themes` (+ exemption, §8) | **[Verified]** mutation exists; research §3.3 |
| `themeDuplicate(id:, name:)` | Clone an existing in-store theme — **not used** in the new architecture, since Shopforge no longer duplicates a merchant's arbitrary existing theme. Documented here only because it's the mutation the old architecture relied on. | `write_themes` (+ exemption, §8) | **[Verified]** mutation exists; research §3.3 |

**[Verified]** New themes created via `themeCreate` default to `role: UNPUBLISHED` (research §3.3). Shopforge relies on this default and does not attempt to request `MAIN` at creation time; whether the mutation additionally supports specifying `role: DEVELOPMENT` explicitly at creation was not independently confirmed — treat `UNPUBLISHED` as the safe assumed outcome unless verified otherwise against the live schema. Either way, the installed theme is never `MAIN` until an explicit Publish (§7).

### 4.2 Why install-as-a-new-theme is the right default

- **Design decision:** Keeps the merchant's existing storefront untouched by construction — their pre-existing theme(s) are never read beyond listing (§3) and never written to at all. This is a stronger safety property than the old model, which at least read a merchant's theme file tree.
- **Matches how Shopify itself models risk**: only one theme can be `role: MAIN` at a time (§3), and Shopify's own workflow guidance (CLI: pull → dev → push → publish, **[Verified]** research §2.1) treats "live" and "in-progress" as separate theme objects, not separate states of one theme object. Shopforge mirrors that model.
- **Bounded cost, and simpler than the old model**: each installed Base Theme consumes one of the store's 20-theme slots (§3), but — unlike the old duplicate-per-import model, which could mint a new theme per session — Shopforge needs at most **one** installed `Theme` per store for the entire lifetime of the connection. Install once; after that, updates happen in place via `themeFilesUpsert` (§4.4, §5) as the Base Theme evolves or the merchant's Store Configuration changes. This is meaningfully slot-safer than the architecture it replaces.
- **Consistent with the write-access story in §8**: installing into a separate, not-yet-`MAIN` theme is the lower-risk pattern Shopify's own review guidance gestures toward (research §4.4) — it keeps the merchant's live storefront untouched by construction, independent of Shopforge's own bug surface.

### 4.3 What stays on the installed theme vs. what reaches `MAIN`

All Base Theme installs/updates (§4.4) and all Store-Configuration-derived writes (§5) target the installed theme's `shopifyThemeId` via `themeFilesUpsert`. The merchant's own pre-existing theme(s), and the installed theme itself prior to Publish, are unaffected by these writes. The installed theme is only pushed live via the explicit Publish action (§7), which the merchant triggers deliberately — never automatically, never as a side effect of editing the Store Configuration.

### 4.4 Updating an already-installed Base Theme

This is genuinely new territory relative to the old architecture, which never had to "update" an imported theme after the fact — it only ever wrote merchant-specific edits on top of a one-time duplicate. Under the new model, Shopforge itself ships new versions of the Base Theme and its Section library over time (bug fixes, new sections, improved defaults), and every store that has already installed an earlier version needs a path to receive that update in its already-installed, in-store theme copy.

**Design decision (mechanism):** Shopify's `theme(id:)`/`themeFilesUpsert`/`themeFilesDelete` mutations (§5) operate on any existing theme the app has write access to, not only on themes it just created — so updating an already-installed Base Theme is mechanically the same API surface as the initial install, just targeted at the existing `shopifyThemeId` instead of a freshly created one. Shopforge computes the bounded set of Liquid files that changed between the store's currently-installed Base Theme version and the new one (a diff of Shopforge's own versioned bundle — Shopforge-internal, not a Shopify API concern) and pushes only that changed/added set via `themeFilesUpsert`, plus `themeFilesDelete` for any removed files, batching per the 50-files-per-request cap. This keeps updates bounded and incremental rather than reinstalling the whole theme.

Several real questions here don't yet have confident answers and are called out explicitly rather than guessed at (see also §9):

- **Status: Needs Investigation.** Whether an already-*published* (`MAIN`) merchant store should ever receive a Base Theme update automatically, versus only ever being updated as part of a fresh, merchant-initiated publish action. Auto-updating a live storefront's Liquid files outside of an explicit publish would be a meaningful departure from the "publish is the only path to `MAIN`-visible change" principle (§4.3, §7) and needs a deliberate decision, not a default.
- **Status: Needs Investigation.** How to handle a Section's settings schema changing shape across Base Theme versions (e.g. a setting renamed or removed) without breaking a merchant's existing Store Configuration, which references that section's settings by name (doc 08). This likely needs a migration/versioning strategy at the Store Configuration level, not just at the Liquid-file level, but the exact mechanism is undecided.
- Doc 17 will need a field recording which Base Theme version a given store's installed `Theme` is currently running, so updates can be computed against the correct baseline.

---

## 5. Theme Update / File Writes

**[Verified]** The GraphQL mutation for writing theme files is `themeFilesUpsert(themeId:, files:)` — batch create/update, max **50 files per request**, each file specifying a `filename` and a `body` of type `TEXT` (plain text — Liquid/JSON/CSS/etc.), `BASE64` (binary), or `URL` (fetch from remote URL). Returns `upsertedThemeFiles`, an optional async `job` for large/bulk operations, and `userErrors`. Requires `write_themes` (research §3.3) — **and the App Store write exemption for public apps** (§8).

| Call | Purpose | Batch limit | Scope | Verification |
|---|---|---|---|---|
| `themeFilesUpsert(themeId:, files:)` | Create/update theme files (replaces legacy REST `PUT .../assets.json`) | 50 files/request | `write_themes` (+ exemption) | **[Verified]** research §3.2–3.3 |
| `themeFilesDelete` | Delete theme files (replaces legacy REST `DELETE .../assets.json`) | Not independently confirmed in depth | `write_themes` (+ exemption) | **[Verified]** mutation referenced as the GraphQL replacement; **not individually fetched in depth** (research §3.3) |
| `themeFilesCopy` | Copy/duplicate theme files | Not independently confirmed in depth | `write_themes` (+ exemption) | **[Verified]** mutation referenced as the GraphQL replacement; **not individually fetched in depth** (research §3.3) |
| `themeUpdate` | Modify theme-level attributes (name, etc.) | — | `write_themes` (+ exemption, for attribute mutation generally) | **[Verified]** research §3.3 |

**[Verified]** Protected/required theme files (e.g. `layout/theme.liquid`) cannot be deleted via the Asset API — returns 403 Forbidden (research §3.2, §4.4). This constraint should be assumed to carry over to `themeFilesDelete` even though it wasn't independently re-confirmed on the GraphQL mutation specifically (**[Inferred]**, same underlying protected-file concept).

**What actually gets written.** Shopforge writes to a merchant's installed theme in exactly two circumstances: (a) installing or updating Shopforge's own versioned Liquid **Section** files, when the Base Theme/Section library (doc 07) itself changes (§4.4) — infrequent, bounded, and entirely first-party content Shopforge wrote and reviewed, never AI-generated at publish time; and (b) writing **Store Configuration**-derived JSON — section order and settings equivalent to `settings_data.json`, plus per-page JSON templates (doc 08) — on every publish (§7). Both paths batch through `themeFilesUpsert` against the installed theme's `shopifyThemeId`, chunking to respect the 50-files-per-request cap. Category (b) is by far the more frequent of the two, and because it is JSON rather than Liquid, it is also the simpler and lower-risk of the two to generate correctly — Shopforge is not generating or writing arbitrary Liquid at publish time.

---

## 6. Theme Preview

**Design decision:** The primary preview mechanism in the new architecture does not depend on Shopify at all. The Store Configuration (doc 08) is rendered live via LiquidJS in a same-origin iframe (doc 09) — rendering happens against Shopforge's own Section library, entirely within Shopforge's own infrastructure, with no round-trip to a merchant's Shopify store. Preview is therefore available continuously while editing, well before anything is installed or published to Shopify, and does not depend on any Shopify-side preview mechanism.

**[Verified]** Shopify CLI ships `theme open` ("Returns preview links for a specified theme"), `theme share` ("Uploads local theme as a new unpublished theme in the theme library — shareable preview link"), and `theme preview` ("Applies a JSON overrides file to a theme and creates/updates a preview") (research §2.1). These confirm Shopify has a preview-link mechanism for unpublished themes as a general platform capability.

**[Not found]** The research did not confirm the exact server-side Admin API mechanism (mutation/field, or the preview URL's construction) that a **hosted third-party app** would use to generate or display a preview link for an unpublished theme at runtime. The CLI commands above are developer-tooling-oriented and were not confirmed to have a direct GraphQL Admin API equivalent callable from a server.

Because preview no longer round-trips through Shopify, this question is downgraded from a load-bearing MVP dependency — which it was under the old architecture, where a Shopify-side preview link was the *only* way to show a merchant their edited theme before publish — to a secondary, lower-priority nice-to-have: does the merchant want an optional last-look, Shopify-side draft preview of the installed theme (with the current Store Configuration already written onto it, before `themePublish` flips it to `MAIN`) as an extra confidence check on top of the LiquidJS preview they've already been using throughout editing? The `[Not found]` caveat on the exact mechanism is retained, but resolving it is no longer a prerequisite for MVP preview functionality — see §9.

---

## 7. Theme Publish

**[Verified]** `themePublish(id:)` publishes a theme — makes it live, sets `role: MAIN`. Requires `write_themes` **and the Shopify-granted exemption** (research §3.3, citing "per docs synthesis" on the exemption requirement specifically for `themePublish`).

| Call | Purpose | Scope | Verification |
|---|---|---|---|
| `themePublish(id:)` | Publish a theme (set `role: MAIN`) | `write_themes` (+ exemption, §8) | **[Verified]** research §3.3 |
| `PUT /admin/api/latest/themes/{id}.json` with `role` field (REST, legacy) | Update a theme incl. publishing | `themes` (legacy) | **[Verified]** research §3.1 — not the build target |

**[Verified]** Publishing a new theme completes only after async file-extraction finishes, which "can take minutes" (research §3.1, REST-documented; **[Inferred]** the same async-completion behavior applies to the GraphQL `themePublish` path, since it operates on the same underlying processing pipeline — `processing`/`processingFailed` fields exist on `OnlineStoreTheme` per research §3.3). Shopforge's Publish flow should poll/await theme processing completion rather than treating the mutation's return as instantaneous success, and should record a `PublishHistory` entry (doc 17) only once processing is confirmed complete.

In Shopforge's model (§4.3), Publish is the single point where the installed theme's content — Shopforge's Base Theme plus the merchant's current Store Configuration written onto it (§5) — becomes the merchant's live storefront. It is the only Shopify write that should ever target/produce a `role: MAIN` outcome, and it happens only on explicit merchant action, never automatically.

---

## 8. The `write_themes` Exemption — Critical Path

This is the single most consequential platform-risk finding for Shopforge. It gates the product's core promise and is treated here as a first-order business/architecture risk, not a footnote.

### 8.1 The finding, stated precisely

**[Verified, community-corroborated]** Since Admin API 2023-04, **apps distributed via the Shopify App Store need a Shopify-granted exemption** to perform theme-file write operations using `write_themes` — this covers legacy REST Asset `PUT`/`DELETE`, and the GraphQL `themeFilesUpsert`, `themeFilesDelete`, `themeFilesCopy`, and `themePublish` mutations (research §3.2, §3.5, §4.4). Requesting/being granted the `write_themes` **scope** in the Partner Dashboard or `shopify.app.toml` is necessary but **not sufficient** — real write access additionally requires an explicit, separate approval from Shopify.

**[Verified]** The App Store review guidance states directly: "Modifications to an online store theme must use theme app extensions" — listed as a common app-review failure point for "Online store apps" (research §1.14, §4.4). This is the officially sanctioned default integration path for third-party apps: **Theme App Extensions** (app blocks placed inside sections, and app embed blocks toggled site-wide), not direct theme-file rewriting (research §1.12–1.14, §4.4).

**[Verified, community-corroborated only — flagged by the research as not confirmed on a single canonical shopify.dev page]** Several 2024–2025 developer-forum threads report `write_themes`/`themeFilesUpsert` calls being blocked by an undocumented `write_themes_assets`-style permission error even after the scope shows as granted, indicating this approval gate is a live, ongoing friction point for third-party developers, not a one-time formality (research §3.5).

### 8.2 Why Theme App Extensions alone cannot satisfy Shopforge's core promise — and why the new architecture's write surface is easier to justify, not harder

Shopforge's core promise is now: install and maintain Shopforge's own first-party **Base Theme** (a fixed, versioned library of ~40–60 **Sections** Shopforge wrote and maintains) in a merchant's store, and apply a structured, machine-generated **Store Configuration** (JSON — section order, settings, blocks, content; doc 08) onto it. Theme App Extensions are still structurally the wrong shape for this:

- **[Verified]** App blocks/embeds are *additive* content the app supplies, which the **merchant** places into a section (or toggles site-wide) via the theme editor (research §1.12–1.14, §4.1–4.2). The app does not choose where they go, and an app block only works inside a section already built to accept `@app`-type blocks (research §1.12) — it cannot install or replace an entire theme, only contribute UI within one that already exists.
- **[Verified]** App blocks are only supported in JSON-template-driven (OS 2.0) sections, not statically-rendered sections, and cannot render on checkout pages at all (research §1.12, §1.14).
- Installing a complete `layout/`/`sections/`/`snippets/`/`templates/`/`config/`/`locales/` tree as a distinct, first-party theme — Shopforge's actual mechanism (§4) — has no Theme-App-Extension equivalent at all; extensions presuppose a theme already exists and only add to it.

**Design decision (argument, not a verified platform fact):** Under the old architecture, Shopforge's write surface was open-ended — arbitrary edits to an unknown, arbitrary set of files inside a merchant's own pre-existing theme, whose contents Shopforge did not author and could not fully characterize in advance. Under the new architecture, the write surface is categorically smaller and more legible: (1) a small, bounded, versioned set of Liquid files Shopforge itself wrote and controls, installed as a distinct, clearly-identifiable, non-`MAIN` theme (§4), and (2) JSON configuration data generated from a well-defined schema (doc 08), never arbitrary Liquid, written on every publish (§5, §7). This is arguably an **easier** case to make to Shopify's review team than the old one, not a harder one: the exemption request can point to a specific, inspectable, versioned codebase (Shopforge's own theme) rather than an open-ended claim to edit anything in any merchant's theme. Whether Shopify's review process actually treats a first-party, versioned theme install more favorably than open-ended arbitrary-file writes was not something the research could confirm — carried forward as part of open question #1 (§9).

### 8.3 The precedent: this exemption is evidently obtainable

**[Inferred, based on Shopforge's competitor research — not part of `research-shopify-platform.md`]** Established page/theme-builder apps live on the Shopify App Store today — Replo (confirmed by Shopforge's separate competitor research to write real Liquid files), and by the same operating model, GemPages, PageFly, and Shogun — are functioning App Store apps that write directly to merchant theme files. Their existence demonstrates the `write_themes` exemption is a **standard, if gated, approval path for legitimate theme/page-builder apps**, not a hard platform blocker. This is a business-development dependency (an approval relationship with Shopify), not an unsolved engineering problem — but it is a **dependency with its own timeline and risk**, not a formality to defer.

### 8.4 Recommendation: Phase 0/Phase 1 gating milestone, not a later step

Given §8.1–8.3, Shopforge should:

1. **Start the `write_themes` exemption application in parallel with earliest engineering, as an explicit Phase 0/Phase 1 milestone** — not something requested after the product is built. Apply to Shopify Partner support with a clear, specific stated use case ("Installing and maintaining Shopforge's own first-party theme — a fixed, versioned Liquid Section library we wrote and maintain — in a merchant's store, and applying structured JSON configuration on top of it via an interactive editor with per-change preview and rollback"), framed around the same safety properties this document specifies: install into a distinct, non-`MAIN` theme first, never touch `MAIN` directly until explicit publish, full diff/undo history. The precedent in §8.3 and the bounded-write-surface argument in §8.2 suggest a well-scoped, safety-conscious use case is approvable, but the exact criteria are unconfirmed (§9).
2. **De-risk engineering so it is not blocked on the partner-approval timeline**, by validating against two paths that do not depend on the App Store exemption at all:
   - **Local development against Shopforge's own Base Theme source (doc 07)** — since Shopforge authors its Sections directly rather than parsing a merchant's theme, most Section-library engineering needs no live Shopify write access at all. This is a meaningfully lighter validation burden than the old architecture, which needed pulled merchant themes to exercise its Parser.
   - **A Shopify development store**, where `themeCreate` / `themeFilesUpsert` / `themePublish` can be exercised directly against Shopforge's own Base Theme end-to-end — install, update, write Store Configuration JSON, publish — without the public-App-Store exemption gate, since dev stores / unlisted custom apps are understood to sit outside the App-Store-distribution restriction that triggers the exemption requirement (**[Inferred]** — the research confirmed dev stores exist as the standard partner sandbox for building/testing themes and apps, research §2.2, and separately confirmed the exemption requirement is specifically scoped to "apps distributed via the Shopify App Store," research §3.5 — the inference that a non-App-Store-distributed installation on a dev store is not subject to the same gate follows from those two facts but was not independently confirmed as a single explicit statement in the research).
   - This lets Section Library, Store Configuration, and Publish engineering (docs 07, 08, 09, 16, 18) proceed on their own timeline while the exemption application runs in parallel, rather than in sequence.
3. **Treat the Theme Access app model** (a free App Store app issuing merchants a one-time, `write_themes`-scoped, time-limited password — **[Verified]** research §3.5) as a possible interim/fallback distribution shape worth evaluating if the public-app exemption stalls, though it changes the installation UX (merchant-issued password vs. standard OAuth) and was not evaluated in depth here.

---

## 9. Open Questions for Direct Confirmation with Shopify

Ranked by architectural/business impact. Items 1, 3, 5, and 7 are gaps the original research explicitly could not close from official docs alone (research §6); items 2 and 6 are new, surfaced by the architecture rewrite in this document rather than by the underlying research.

1. **`write_themes` exemption — apply and secure it. [Top priority, gating milestone per §8.4.]** The existence of the gate is verified; the *exact* approval criteria, required application materials, and expected timeline are not (research §3.5, §4.4, §6.1). The bounded-write-surface argument in §8.2 should be part of the application materials, but its persuasiveness to Shopify's review team is itself unconfirmed. This is the #1 item to resolve directly with Shopify Partner support.
2. **Policy and mechanism for propagating Base Theme updates to already-installed merchant copies (§4.4). Status: Needs Investigation.** Specifically: whether an already-published (`MAIN`) store should ever receive a Base Theme update automatically vs. only via a fresh merchant-initiated publish; and how to handle a Section's settings schema changing shape across Base Theme versions without breaking a merchant's existing Store Configuration. This is new territory the old architecture never had to address.
3. **Exact GraphQL Admin API rate-limit figures.** Two conflicting sets of points/second numbers surfaced during research — 50/100/500 vs. 100/200/1000/2000 by plan tier — with the higher figures coming from a direct fetch of the official limits page but flagged as needing re-confirmation at implementation time since these numbers are known to change (research §3.6, §6.2). Needed to size `themeFilesUpsert` batching for Base Theme installs/updates (§4, §5).
4. **Exact `write_themes` exemption approval criteria**, beyond "an exemption exists." Community-forum-sourced use-case categories (theme backup/restore, adding Liquid to repeating blocks, SEO/content-locking/dev-tooling) were found but not confirmed as an official, current, or exhaustive list (research §3.2, §3.5). Whether "install and maintain a first-party theme, publish JSON-only configuration on top of it" cleanly fits an approved category, or needs bespoke justification, is unknown until asked directly.
5. **`themes/update` webhook topic and exact `themes/publish` firing semantics.** `themes/publish`'s existence is confirmed in the `WebhookSubscriptionTopic` enum, but its precise firing-condition wording was sourced from community discussion rather than a direct fetch of the enum's field description; `themes/update` was referenced only in a community-thread title and not independently confirmed to exist at all (research §3.7, §6.4). Needed for keeping Shopforge's `Theme`/`PublishHistory` records in sync with out-of-band changes (§2.2, step 5).
6. **Exact shape/hosting requirements of `themeCreate`'s `source` parameter**, used to install the Base Theme (§4.1). The mutation's existence and the `source`/`name` arguments are confirmed, but the original research did not detail whether `source` must be a publicly-fetchable HTTPS URL to a ZIP, any size limits, or whether a staging-upload step is required before calling the mutation. Needs direct confirmation against the live schema before the install pipeline is built.
7. *(Secondary, lower immediate impact)* REST Admin API call-limit specifics (≈40 calls/sec, `X-Shopify-Shop-Api-Call-Limit` header) — largely moot given the GraphQL-first mandate (§2.1), but worth confirming if any REST fallback is ever planned (research §6.3).

---

## 10. Rate Limits & Webhooks

**Rate limits [Verified, with flagged discrepancy]**: The GraphQL Admin API uses cost-based ("leaky bucket") limiting, not simple call counts — every schema field has an assigned cost, a query's total cost is statically analyzed before execution, and cost is deducted from a per-shop bucket that refills at a plan-dependent points/second rate. A single query cannot exceed 1,000 points regardless of plan. Array-type input arguments are capped at 250 items across all Admin GraphQL APIs; pagination is capped at 25,000 objects. The plan-tier refill rates themselves have a confirmed discrepancy across sources (open question #3, §9) — do not hard-code specific numbers into rate-limit handling logic without re-confirming at implementation time. (research §3.6)

The Storefront API has no documented per-request rate limit (**[Verified]**, and separately confirms it is not the theme-editing surface — research §3.4). The Bulk Operations API is reported to have no max-cost/per-query limit, but this is **[partially verified]** — secondary-sourced, not independently fetched from a dedicated official page (research §3.6).

**Webhooks [Verified except where noted]**:

| Topic | Purpose | Verification |
|---|---|---|
| `app/uninstalled` | Mandatory; clean up `ShopifyInstallation`/session data on uninstall | **[Verified]** research §3.7 |
| `themes/publish` | Fires when a theme with `main` (or deprecated `mobile`) role is published | **[Verified]** topic exists in `WebhookSubscriptionTopic`; exact firing-condition wording is community-sourced, not a direct enum-field quote — **[flagged, re-verify at implementation time]** (research §3.7) |
| `themes/update` | Presumed to cover other theme file changes | **[Not found]** — referenced only in a community-thread title, not confirmed against an official enum page (research §3.7) |

Webhooks can be declared statically in `shopify.app.toml` for app-scoped subscriptions, or created per-shop via a GraphQL mutation (name inferred as `webhookSubscriptionCreate` by standard Shopify API convention — **[Inferred]**, not independently fetched, research §3.7).

---

## 11. What Shopify Magic Already Does (Baseline Competitor Reference)

**[Verified]**, per Shopify's own Help Center and Changelog (research §5), Shopify Magic — a free, plan-independent suite of AI features built into Shopify itself — currently covers:

- **Text generation**: product descriptions, email subject lines, headings.
- **Media generation**: background removal, logo generation, banner creation.
- **Theme editor content generation**: merchant enters a prompt (e.g. for a headline/subtitle/announcement) and Magic generates matching copy directly inside existing theme editor fields.
- **Theme block generation**: merchant describes a custom theme block in natural language; Magic generates the underlying Liquid for a *new* theme block on the spot (Horizon and other theme-block-supporting themes).
- **Theme generation**: AI-generated starter theme, from the Themes page in admin.
- **Sidekick**: Shopify's broader chat-based commerce assistant — Designer/Photo Editor/Writer/Tech Support/Marketer capabilities, plus admin task automation (pricing analysis, performance summaries, discount setup, etc.) — a distinct product surface from "Shopify Magic" branding.
- **Privacy**: Shopify states it does not use one merchant's store-level data to power Magic for other merchants.

**[Inferred conclusion from the verified feature list above, snapshot as of 2026-08-19]**: Shopify Magic's scope today is (1) generating/editing on-page copy inside existing theme editor fields, (2) generating brand-new theme blocks from a description, and (3) generating a single initial starter theme via a one-shot admin flow. It does not appear, per available docs, to offer a curated, quality-controlled Section library that a merchant can assemble and re-arrange across an entire multi-page store, with a continuously live, structured, iteratively-editable configuration and instant preview. Shopforge's plausible differentiation area is no longer "editing an existing arbitrary theme's files" (the old framing) — it is the quality and breadth of a first-party Section library plus a fast, structured, whole-store editing and preview experience built on it (consistent with doc 01 §4's framing). That differentiation still depends on resolving §8: none of it reaches a real storefront without the write access this document describes. Shopify could expand Magic's scope at any time; this is a point-in-time baseline, not a permanent competitive moat.

---

## Sources

All citations above trace to `research-shopify-platform.md` (dated 2026-08-19), which lists full source URLs (shopify.dev, help.shopify.com, and clearly-labeled secondary/community sources used only for corroboration). Refer to that file's "Sources" section for the underlying shopify.dev/help.shopify.com links behind each `research §X.Y` reference in this document.
