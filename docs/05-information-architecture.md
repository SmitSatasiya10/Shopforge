# 05 — Information Architecture

## 1. Purpose and scope

This document is the full sitemap of Shopforge: every top-level and sub-area a user can navigate to, what data backs each screen (canonical entity names from architecture core §5), and the navigation hierarchy that governs where things live relative to each other. It complements doc 04 (which describes the *sequence* a user moves through) by describing the *structure* they can move around within at any time — the persistent shell, not a one-way journey.

The single structural decision this document exists to pin down: **a Shopify store can hold multiple themes, and a theme accumulates multiple versions over time — so "the editor" is never a single global place. It is always scoped to one specific `ThemeVersion` of one specific `Theme` of one specific `ShopifyStore`.** Every nested area below (Visual Editor, AI Workspace, Assets, Version History) inherits that scope.

## 2. Navigation hierarchy — nested, not flat

The primary hierarchy is **nested**: `Organization → ShopifyStore → Theme → ThemeVersion (working copy) → {Visual Editor | AI Workspace | Assets | Version History}`. A user cannot open a Visual Editor or AI Workspace without that context chain being resolved first — there is no such thing as "the editor" in the abstract.

Three areas are intentionally **flat/org-level**, sitting outside any store/theme scope, because they aggregate across all of them: **AI Usage & Billing**, **Team/Org Settings**, and **Account Settings**. A fourth, **Dashboard**, is the flat landing surface a user returns to that summarizes across the nested hierarchy without living inside it.

One convenience flattening exists inside the nested hierarchy: a global **"All Themes"** list (Themes area) shows every `Theme` across every connected `ShopifyStore` in one table for organizations managing several stores, so a user doesn't have to drill into each store individually just to find a theme. It is a filtered view over the same `Theme` records the nested Store → Themes screen shows — not a separate data model.

```
Flat (org-level)              Nested (store/theme-scoped)
─────────────────             ──────────────────────────────────────
Dashboard                     Stores
AI Usage & Billing              └── Store Detail
Team/Org Settings                    └── Themes (this store)
Account Settings                          └── Theme Detail
Themes (all, cross-store)                      ├── Theme Overview / Capability Map
                                                ├── Visual Editor        (scoped to a ThemeVersion)
                                                ├── AI Workspace         (scoped to a ThemeVersion)
                                                ├── Assets
                                                ├── Version History
                                                └── Theme Settings
```

## 3. ASCII sitemap tree

```
Shopforge
│
├── (unauthenticated) Marketing site
│   └── Landing pages, pricing, docs
│
├── Auth
│   ├── Sign Up            (email or "Continue with Shopify")
│   ├── Login
│   └── Password Reset
│
├── Onboarding                              (first-run only, per Organization)
│   ├── Path A: Connect Existing Store
│   └── Path B: Start New Store (Dawn-based)
│
├── Dashboard                               (org home / post-login landing)
│   ├── Recent activity feed
│   ├── Quick links → Stores / Themes / AI Usage
│   └── Org/store health summary (parse status, credit balance, pending clarifications)
│
├── Stores                                  (org-level list of ShopifyStore)
│   └── [Store: e.g. "acme-outfitters"]
│       ├── Store Overview                  (connection health, plan tier, granted scopes)
│       ├── Themes                          (Theme list for this store)
│       │   └── [Theme: e.g. "Dawn — Live"]
│       │       ├── Theme Overview / Capability Map
│       │       ├── Visual Editor           (scoped to active ThemeVersion; version switcher inside)
│       │       ├── AI Workspace            (scoped to active ThemeVersion; version switcher inside)
│       │       ├── Assets
│       │       ├── Version History         (Diff timeline, Snapshots, Publish History)
│       │       └── Theme Settings          (rename, re-sync, change role, delete)
│       └── Store Settings                  (disconnect, reconnect OAuth, scope review)
│
├── Themes (all)                            (flat, cross-store convenience view — same Theme records)
│
├── AI Usage & Billing                      (org-level)
│   ├── Credit Ledger                       (AIUsageEvent history, running CreditBalance)
│   ├── Plan / Subscription
│   └── Invoices / payment method
│
├── Team / Org Settings
│   ├── Members                             (OrgMembership + roles)
│   ├── Invitations
│   ├── Org Profile
│   └── Audit Log                           (AuditLog)
│
└── Account Settings                        (User-level, cross-organization)
    ├── Profile
    ├── Security                            (password, 2FA, connected OAuth identities)
    ├── Notification Preferences
    └── Organizations                       (switch between orgs / accept invites)
```

## 4. Screen-by-screen reference

Each row: the screen, its location in the hierarchy, the entities (architecture core §5) it is backed by, and the API groups (architecture core §6) it primarily calls.

| Screen | Location | Backed by (entities) | Primary API group(s) |
|---|---|---|---|
| Dashboard | Flat, org-level | `Organization`, `ShopifyStore` (summary), `Theme` (summary), `AIUsageEvent` (summary), `CreditBalance` | `/theme/*`, `/ai/*` (read/summary calls) |
| Stores (list) | Flat, org-level | `ShopifyStore`, `ShopifyInstallation` | `/shopify/*` |
| Store Overview | Nested, per-store | `ShopifyStore`, `ShopifyInstallation` | `/shopify/*` |
| Store Settings | Nested, per-store | `ShopifyStore`, `ShopifyInstallation` | `/shopify/*` |
| Themes (per-store list) | Nested, under Store | `Theme` (filtered by `ShopifyStore`) | `/shopify/*` (list themes), `/theme/*` (parse status) |
| Themes (all, cross-store) | Flat convenience view | `Theme` (unfiltered, joined to `ShopifyStore` for display) | `/theme/*` |
| Theme Overview / Capability Map | Nested, per-theme | `Theme`, `ThemeVersion`, `ThemeManifest` | `/theme/*` (manifest read), `/ai/*` (narrative summary) |
| Visual Editor | Nested, per-theme, scoped to one `ThemeVersion` | `ThemeVersion`, `ThemeManifest`, in-memory/persisted `ThemeModel`, `ThemeOperation`, `Diff` | `/editor/*`, `/ai/*` |
| AI Workspace | Nested, per-theme, scoped to one `ThemeVersion` | `AIConversation`, `AIMessage`, `OperationPlan`, `ThemeOperation`, `ThemeModel` (read) | `/ai/*`, `/editor/*` (read-only model context) |
| Assets | Nested, per-theme | `Asset`, `GeneratedAsset` | `/theme/*` (asset refs), `/ai/*` (generate-image) |
| Version History | Nested, per-theme | `ThemeVersion`, `Diff`, `ThemeSnapshot`, `PublishHistory` | `/theme/*` (versions, diff, restore, snapshot) |
| Theme Settings | Nested, per-theme | `Theme`, `ThemeManifest` (re-sync trigger) | `/theme/*`, `/shopify/*` |
| AI Usage & Billing | Flat, org-level | `AIUsageEvent`, `CreditBalance`, `Plan`/`Subscription` | `/ai/*` (usage read), billing service (out of scope here) |
| Team / Org Settings — Members | Flat, org-level | `OrgMembership`, `User` | internal org/identity service |
| Team / Org Settings — Audit Log | Flat, org-level | `AuditLog` | internal org/identity service |
| Account Settings | Flat, user-level (cross-org) | `User`, `OrgMembership` (for the org switcher) | internal auth/identity service |

## 5. Where the Visual Editor and AI Workspace live, precisely

Because a single `Theme` can have many `ThemeVersion`s (imported baseline, in-progress working copies, published snapshots, rolled-back restores), and a single `ShopifyStore` can have many `Theme`s (main, unpublished, development, demo — `shopifyRole`), the Visual Editor and AI Workspace are **not** top-level destinations. They are always reached by resolving a full scope chain:

```
ShopifyStore  (which store)
     └── Theme          (which theme lineage — main / unpublished / dev / demo)
              └── ThemeVersion   (which working copy — defaults to "current," switchable)
                       └── Visual Editor  |  AI Workspace
```

Practical consequences of this:

- **Entry always carries scope in the URL/route** (e.g. `/stores/{storeId}/themes/{themeId}/editor?version={themeVersionId}`), never a bare `/editor`. Deep links, bookmarks, and "resume where I left off" all depend on this.
- **The version switcher lives inside the Editor/Workspace toolbar** (doc 19 §19.4.2), not as a separate top-level nav item — switching `ThemeVersion` reloads the `ThemeModel` in place rather than navigating to a different section of the app, because Editor and Workspace are two faces of the same scoped session (Design Principle 7: they share the model).
- **AI Workspace and Visual Editor are siblings, not parent/child** — a user can jump between them for the same `ThemeVersion` without losing conversation or selection state (doc 19 §19.3), which is why they're listed as two separate leaf nodes under the same `Theme` in §3's tree rather than one nested inside the other.
- **Assets and Version History are theme-scoped, not version-scoped** — an `Asset`/`GeneratedAsset` can be referenced by multiple `ThemeVersion`s, and Version History's entire purpose is comparing *across* versions, so both sit one level up from the editor surfaces, as direct siblings under `Theme`.
- A store with zero imported themes yet (mid-Onboarding) shows the Themes area with only an "Import a theme" empty state — Visual Editor/AI Workspace routes for that store simply don't resolve until at least one `Theme`+`ThemeVersion` exists.

## 6. Cross-cutting navigation patterns

- **Breadcrumb chain** mirrors the scope chain exactly: `Store name › Theme name › Version label`, present on every nested screen so the user always knows which store/theme/version they're looking at — critical given how easy it is to have several similarly-named themes across stores.
- **Context switcher**: a persistent store/theme/version picker in the app shell (not just the breadcrumb) lets a user jump laterally — e.g. from editing Store A's live theme directly to Store B's development theme — without returning to the Dashboard first.
- **Flat areas (AI Usage, Team Settings, Account Settings) always exit the scope chain** — navigating to them from inside a Theme's editor doesn't discard editor state; returning via the context switcher or a "back to editor" affordance restores exactly where the user left off (ties to doc 19 §19.4.8 editor state persistence).
- **"Themes (all)" is a launch pad, not a workspace** — selecting a theme from the flat cross-store list always drops the user into the nested Theme Detail screen (Theme Overview first, not straight into the editor), so the capability-map orientation step (doc 04 §4 Step 8) is never skipped just because the user entered via the flat shortcut.
