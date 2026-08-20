# 05 — Information Architecture

## 1. Purpose and scope

This document is the full sitemap of Shopforge: every top-level and sub-area a user can navigate to, what data backs each screen (canonical entity names introduced by doc 08, Store Configuration Schema, and doc 17, Database Model), and the navigation hierarchy that governs where things live relative to each other. It complements doc 04 (which describes the *sequence* a user moves through) by describing the *structure* they can move around within at any time — the persistent shell, not a one-way journey.

The single structural decision this document exists to pin down, updated from the previous revision: **a Shopify store connection is no longer the root of the hierarchy.** The unit a user builds, edits, and iterates on is a **`Project`** — an AI-generated store seeded from a product URL or description, holding a versioned **Store Configuration** (doc 08). A `Project` may or may not yet be linked to a **`ShopifyStore`**; that link is established only when the user chooses to publish (doc 04 §4 Step 15), not up front. Every nested area below (Visual Editor, Version History, Publish & Connect) is scoped to a `Project`, not to a pre-existing Shopify connection.

## 2. Navigation hierarchy — nested, not flat

The primary hierarchy is **nested**: `Organization → Project → StoreConfiguration (working version) → {Visual Editor | Version History | Publish & Connect}`. A user cannot open the Visual Editor without a `Project` existing first, but — unlike the previous architecture — that `Project` does not require a connected `ShopifyStore` to exist. Build and preview are fully available on a `Project` with zero Shopify connection; the Shopify link attaches later, inside the same `Project`, at the Publish & Connect screen.

Three areas are intentionally **flat/org-level**, sitting outside any project scope, because they aggregate across all of them: **AI Usage & Billing**, **Team/Org Settings**, and **Account Settings**. A fourth, **Dashboard**, is the flat landing surface a user returns to that summarizes across the nested hierarchy without living inside it. A fifth, **Connected Stores**, is a thin org-level reference list of every `ShopifyStore` linked to any of the organization's projects — useful for an organization managing several published stores, but not an entry point: a `ShopifyStore` is always reached *through* the `Project` that publishes to it, never navigated to directly to start building.

```
Flat (org-level)              Nested (project-scoped)
─────────────────             ──────────────────────────────────────
Dashboard                     Projects
AI Usage & Billing              └── Project Overview
Team/Org Settings                    ├── Product Import (status/review)
Account Settings                     ├── AI Generation (progress)
Connected Stores (reference)         ├── Visual Editor       (scoped to a StoreConfiguration version)
                                      │     ├── Store/Page Navigator
                                      │     ├── Section Library browser
                                      │     ├── Inspector (Section/Block/Setting)
                                      │     └── AI panel
                                      ├── Version History
                                      ├── Publish & Connect Shopify
                                      └── Project Settings
```

## 3. ASCII sitemap tree

```
Shopforge
│
├── (unauthenticated) Marketing site
│   └── Landing (product URL input in hero), pricing, docs
│
├── Auth
│   ├── Sign Up            (email or OAuth identity)
│   ├── Login
│   └── Password Reset
│
├── Onboarding                              (product URL / describe-instead input, pre- and post-auth)
│
├── Dashboard                               (org home / post-login landing)
│   ├── Recent activity feed
│   ├── Quick links → Projects / AI Usage
│   └── Org health summary (in-progress generations, credit balance, pending clarifications)
│
├── Projects                                (org-level list)
│   └── [Project: e.g. "acme wireless earbuds"]
│       ├── Project Overview                (product data snapshot, generation status, current version)
│       ├── Product Import                  (scrape status / review & confirm)
│       ├── AI Generation                   (progress: section selection, ordering, content)
│       ├── Visual Editor                   (scoped to active StoreConfiguration version)
│       │     ├── Store/Page Navigator      (which pages + sections exist)
│       │     ├── Section Library browser   (add a section from the catalog, doc 07)
│       │     ├── Inspector                 (selected Section/Block/Setting controls)
│       │     └── AI panel                  (scoped chat, AI-assisted editing)
│       ├── Version History                 (StoreConfiguration version timeline, diffs)
│       ├── Publish & Connect Shopify        (OAuth connect, publish confirmation, publish history)
│       └── Project Settings                (rename, delete, re-run product import)
│
├── Connected Stores                        (flat, org-level reference list of linked ShopifyStores)
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

Each row: the screen, its location in the hierarchy, the entities (doc 08/17) it is backed by, and the API groups (doc 04's convention) it primarily calls.

| Screen | Location | Backed by (entities) | Primary API group(s) |
|---|---|---|---|
| Dashboard | Flat, org-level | `Organization`, `Project` (summary), `AIUsageEvent` (summary), `CreditBalance` | `/config/*`, `/ai/*` (read/summary calls) |
| Projects (list) | Flat, org-level | `Project` | `/config/*` |
| Project Overview | Nested, per-project | `Project`, `ProductData`, `StoreConfiguration` (current version summary) | `/import/*`, `/config/*` |
| Product Import | Nested, per-project | `ProductImportJob`, `ProductData` | `/import/*` |
| AI Generation | Nested, per-project | `GenerationJob`, `StoreConfiguration` (in progress) | `/ai/*` |
| Visual Editor | Nested, per-project, scoped to one `StoreConfiguration` version | `StoreConfiguration`, `Page`, `SectionInstance`, `BlockInstance`, `Setting`, `PreviewSession` | `/config/*`, `/preview/*`, `/editor/*`, `/ai/*` |
| Section Library browser | Nested, within Visual Editor | Section catalog (doc 07), `StoreConfiguration` (write target) | `/config/*` (doc 07 for the catalog read) |
| Version History | Nested, per-project | `ConfigurationVersion`, `PublishRecord` | `/config/*` (versions, restore) |
| Publish & Connect Shopify | Nested, per-project | `ShopifyStore`, `ShopifyInstallation`, `PublishRecord` | `/shopify/*` |
| Project Settings | Nested, per-project | `Project`, `ProductData` (re-import trigger) | `/import/*`, `/config/*` |
| Connected Stores | Flat, org-level reference | `ShopifyStore`, `ShopifyInstallation` (joined to `Project` for display) | `/shopify/*` |
| AI Usage & Billing | Flat, org-level | `AIUsageEvent`, `CreditBalance`, `Plan`/`Subscription` | `/ai/*` (usage read), billing service (out of scope here) |
| Team / Org Settings — Members | Flat, org-level | `OrgMembership`, `User` | internal org/identity service |
| Team / Org Settings — Audit Log | Flat, org-level | `AuditLog` | internal org/identity service |
| Account Settings | Flat, user-level (cross-org) | `User`, `OrgMembership` (for the org switcher) | internal auth/identity service |

## 5. Where the Visual Editor lives, precisely

Because a single `Project` accumulates many `ConfigurationVersion`s (the initial AI-generated draft, in-progress working edits, published snapshots, rolled-back restores), the Visual Editor is **not** a top-level destination. It is always reached by resolving a scope chain that — unlike the previous architecture — does **not** require a Shopify connection to resolve:

```
Project              (which project — a Project can exist, be fully built, and be
                       previewed with zero ShopifyStore link)
     └── StoreConfiguration   (which working version — defaults to "current," switchable)
              └── Visual Editor
```

Practical consequences of this:

- **Entry always carries scope in the URL/route** (e.g. `/projects/{projectId}/editor?version={configurationVersionId}`), never a bare `/editor`. Deep links, bookmarks, and "resume where I left off" all depend on this.
- **The AI panel lives inside the Visual Editor, not as a separate destination.** The previous architecture treated "AI Workspace" and "Visual Editor" as two sibling entry surfaces sharing one model. That distinction is retired: direct manipulation (click-to-select, `contentEditable`, Section Library) and AI-assisted editing now write to the same `StoreConfiguration` through the same surface, side by side in one shell (canvas + inspector + AI panel, doc 06/09/19) — there is no separate chat-first entry point to choose between.
- **The version switcher lives inside the editor toolbar** (doc 19), not as a separate top-level nav item — switching `StoreConfiguration` versions reloads the canvas in place rather than navigating elsewhere.
- **Publish & Connect Shopify is a sibling of the Visual Editor under `Project`, not a prerequisite for reaching it.** A `Project` with no `ShopifyStore` link yet still has a fully functional Visual Editor, Version History, and Section Library — the only screen gated on a Shopify connection is Publish & Connect itself, and only its actual publish action is plan-gated (doc 22).
- **Version History is project-scoped, not version-scoped** — its entire purpose is comparing *across* versions, so it sits one level up from the editor surface, as a direct sibling under `Project`, alongside Publish & Connect and Project Settings.
- A `Project` that hasn't finished AI Generation yet (mid Product Import or Generation) shows its own staged progress screen instead of the Visual Editor — the editor route for that project simply doesn't resolve until a `StoreConfiguration` exists (doc 04 §4 Steps 4–8).

## 6. Cross-cutting navigation patterns

- **Breadcrumb chain** mirrors the scope chain exactly: `Project name › Version label`, present on every nested screen so the user always knows which project/version they're looking at — critical for organizations managing several in-progress or published projects with similar names.
- **Context switcher**: a persistent project/version picker in the app shell (not just the breadcrumb) lets a user jump laterally — e.g. from editing one project's live configuration directly to another project still mid-generation — without returning to the Dashboard first.
- **Flat areas (AI Usage, Team Settings, Account Settings, Connected Stores) always exit the scope chain** — navigating to them from inside a `Project`'s editor doesn't discard editor state; returning via the context switcher or a "back to editor" affordance restores exactly where the user left off (ties to doc 19 editor state persistence).
- **"Projects" is a launch pad, not a workspace** — selecting a project from the flat list always drops the user into Project Overview first (product data + generation status + current version), not straight into the editor, so a user re-orients on what was built before jumping back into editing (doc 04 §4 Step 8) — the same principle the old capability-map orientation step served, adapted to the new content.
- **Connected Stores is read-only navigation** — clicking a `ShopifyStore` there routes into the owning `Project`'s Publish & Connect screen (reconnect, view publish history); it is never an alternative way to start building, since building never required a Shopify connection to begin with.
