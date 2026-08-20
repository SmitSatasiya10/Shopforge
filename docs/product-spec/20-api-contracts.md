# API Contracts

The application API surface for Shopforge, organized into seven route groups: `/shopify/*`, `/product/*`,
`/project/*`, `/sections/*`, `/ai/*`, `/editor/*`, `/preview/*`. This document defines, per endpoint: purpose,
input, output, authorization, concurrency behavior, idempotency, and side effects. It also defines the
Organization-role permission model every endpoint is checked against and the concurrency strategy that lets the
Visual Editor and AI operate on the same [Store Configuration](03-store-configuration.md) safely.

## 1. Conventions

- Every request carries an org context resolved from the session (a JWT carrying `userId` and the active
  `organizationId`). Endpoints below omit a common `/api/v1` prefix for brevity.
- Two path segments are kept deliberately distinct and are never abbreviated to a bare `storeId`:
  - `/shopify/shops/:shopifyStoreId/...` — a connected merchant `myshopify.com` shop (`ShopifyStore`,
    [Data Model](19-data-model.md)).
  - `/project/:projectId/...` and `/editor/versions/:storeConfigVersionId/...` — a Shopforge-generated store
    project (`Project` / `StoreConfigVersion`, [Data Model](19-data-model.md)).
- **Common error semantics**, applied consistently across every group below unless an endpoint states otherwise:
  - **Forbidden** — the caller's `OrgMembership.role` is below the endpoint's minimum role (§2), or an
    endpoint-specific precondition blocks the action (e.g. a missing Shopify write-access grant on publish, §6).
  - **Not found** — the target `Project`, `StoreConfigVersion`, `Product`, `ShopifyStore`, section, block, or
    version does not exist or is not in the caller's Organization.
  - **`409 Conflict`** — a `lockVersion` compare-and-swap failed (§3), or a publish/rollback is already
    in-flight for the `Project` (§6).
  - **`402 Payment Required`** — an AI operation's `estimatedCreditCost` exceeds `CreditBalance.currentBalance`
    (§3, §10).
  - Payload-shape/business-rule validation failures (invalid setting value, disallowed section type, etc.) are
    rejected by the shared validation pipeline before a mutation reaches the lock compare-and-swap; the
    validation pipeline's own error shape is defined in
    [Validation and Error Handling](17-validation-and-error-handling.md), not here.

## 2. Roles

Every endpoint is gated by the caller's `OrgMembership.role` for the Organization that owns the target
resource. Four roles, strictly ordered `viewer < editor < admin < owner`; a higher role implicitly has every
permission of the roles below it unless stated otherwise.

| Role | Can do | Cannot do |
|---|---|---|
| **viewer** | Read everything: list connected shops, list projects, view Store Configuration/pages/sections, view Diff & version history, view AI conversations, view publish history. | Any mutation. Cannot send AI messages, run operations, save edits, publish, or manage members/billing. |
| **editor** | Everything viewer can, plus: all content work — import a product, kick off AI store generation, create/branch `StoreConfigVersion`s, all `/editor/*` and `/project/*` mutations, all `/ai/*` conversation/plan/execute/generate endpoints, trigger restores/undo/redo. | Connect/disconnect Shopify OAuth, publish/rollback to the live store, manage org members or billing. |
| **admin** | Everything editor can, plus: connect/disconnect Shopify OAuth (`/shopify/oauth/*`), publish and rollback (`/shopify/shops/.../publish`, `/shopify/shops/.../rollback`), invite/remove members with role editor/viewer/admin. | Delete the Organization, manage the Subscription/billing, change or remove the owner. |
| **owner** | Everything admin can, plus: billing/Subscription management, transfer ownership, delete the Organization. | — |

Publish and Shopify-OAuth-disconnect are the two action classes that affect the live storefront or the store's
connection integrity directly and irreversibly outside Shopforge's own undo system, which is why they require
admin+ rather than editor+. Everything else — drafting, AI edits, saving, even destructive-looking in-app
operations — is fully reversible via Diff/version restore
([Versioning and Undo/Redo](18-versioning-and-undo-redo.md)) and so is safe to leave to any editor.

## 3. Concurrency model

`StoreConfigVersion.lockVersion` is the single concurrency-control point for the whole system. The Visual
Editor and the AI operation executor write through the exact same mutation path, so they share the exact same
lock — this is what lets a user drag-and-drop a section at the same moment an AI plan is executing against the
same `StoreConfigVersion`, without silently losing either party's change.

**Protocol:**

1. Every read of a Store Configuration (`GET .../config`) returns the current `lockVersion` alongside it.
2. Every mutating request that touches a `StoreConfigVersion` (an `/editor/*` or `/project/*` mutation, or AI
   plan execution) must include the `lockVersion` it last read.
3. The server applies the mutation as a compare-and-swap:
   ```sql
   UPDATE store_config_versions
   SET configuration = ?, lock_version = lock_version + 1
   WHERE id = ? AND lock_version = ?
   ```
   Zero rows affected → `409 Conflict`; the response body includes the current `lockVersion` and full
   configuration so the client can rebase.
4. Structural editor operations (`set-setting`, `reorder-section`, etc.) are single-step and resolve the CAS
   synchronously within the request.
5. AI plan execution (`POST /ai/plans/:operationPlanId/execute`) applies several operations in sequence over
   what can be a multi-second job. It re-validates `lockVersion` before **each** operation, not just once at the
   start. If a concurrent editor save lands mid-execution, already-applied operations are **not** rolled back —
   they were honestly applied against a valid lock at the time. Remaining operations are aborted and reported as
   `conflicted` in the job result, and the client is prompted to re-plan the remainder against the now-current
   configuration. Partial-apply is used over full-transaction rollback because every individual operation is
   already independently diffed and reversible — there is no correctness reason to discard successful work.
6. `estimatedCreditCost` is checked against `CreditBalance.currentBalance` before an AI operation/plan starts;
   insufficient balance returns `402 Payment Required` without touching the lock.

## 4. Streaming (Server-Sent Events)

AI chat responses, store-generation progress, and generation-in-progress updates stream to the frontend over
**SSE**, not WebSockets:

- The data flow is fundamentally one-directional (server → client token/event stream); the client's own actions
  (send message, approve plan, answer a clarification) are small, infrequent, ordinary POSTs.
- SSE rides plain HTTP, passing through standard proxies/load balancers without WebSocket upgrade special-casing.
- `EventSource`'s built-in reconnect-with-last-event-id maps directly onto "resume this AI response stream if
  the connection drops," at no extra implementation cost.
- Infra stays simpler — one more long-lived HTTP response held open per active conversation, not a second
  connection protocol to load-balance and keep sticky.

`POST /ai/generate`, `POST /ai/conversations/:id/messages` (and `.../plan`, `.../generate-image`) return
`Content-Type: text/event-stream` and emit named events (`token`, `operation_plan`, `clarification_needed`,
`usage`, `done`, `error`) as the response streams in. A client that is not actively watching (e.g. it reopens
the app mid-generation) falls back to polling `GET /ai/conversations/:id` for the latest persisted `AIMessage`/
`OperationPlan` state — the SSE stream is a live view onto the same persisted rows, never the only source of
truth.

## 5. Long-running operations

Shopforge does not introduce a generic "Job" entity. Every async endpoint's progress is exposed through the
**status field of the domain entity it's already writing to**, so there is one state model per concept instead
of a parallel job-tracking system.

| Operation | Sync or async | Status surfaced via |
|---|---|---|
| Product import | async, `202` | `Product.importStatus` / poll `GET /product/:productId` |
| AI store generation | async, `202` (SSE progress) | `Project.status` + `StoreConfigVersion` row appears |
| AI plan generation | async, `202` (SSE progress) | `OperationPlan.status` |
| AI plan execution | async, `202` (SSE progress) | `OperationPlan.status` + each `StoreOperation.status` |
| AI regenerate section/page | async, `202` (SSE progress) | parent `StoreOperation.status` |
| Generate image | async, `202` (SSE progress) | `GeneratedAsset.status` |
| Generate copy | sync (SSE token stream, resolves in seconds) | inline response |
| Publish | async, `202` | `PublishHistory.status` |
| Rollback | async, `202` | `PublishHistory.status` |
| Restore a version (undo/redo, restore-to-version) | sync, `200` | in-model — the configuration is a JSON document, fast enough not to need a job |
| Editor/project structural mutations | sync, `200` | inline response with new `lockVersion` |
| Server-side preview render | sync or async `202` depending on payload size | see [§12 `/preview/*`](#12-previewshared) |

For clients already holding an open SSE connection on the relevant `AIConversation` (generation, plan
generation, plan execution, and image generation all happen within a conversation), progress and completion are
pushed as SSE events instead of requiring polling. Polling against the resource's own `GET` endpoint is the
universal fallback for everything else, including endpoints outside any conversation (import, publish,
rollback).

**Idempotency:** mutating endpoints that trigger an external side effect — `POST /product/import`,
`POST /ai/generate`, `POST /shopify/shops/.../publish`, `POST /shopify/shops/.../rollback`,
`POST /shopify/oauth/connect` — accept an `Idempotency-Key` header; the server deduplicates retried requests
against a short-lived key store so a network retry can never double-import, double-generate, or double-publish.
Editor/project/AI-operation mutations do not need a separate idempotency key — the `lockVersion` compare-and-swap
already makes a retried request either a no-op (same base state, same result) or a clean `409` (base state moved
on).

---

## 6. `/shopify/*`

OAuth, merchant theme-slot check, install/publish, rollback. This group deliberately does **not** contain
anything that reads or imports the merchant's existing theme content — Shopforge installs its own
[Base Theme](02-base-theme-and-section-library.md) (`themeCreate` from Shopforge's own theme source) rather than
duplicating or parsing whatever the merchant already has. See [Shopify Publishing](14-shopify-publishing.md).

| Method + path | Purpose | Auth |
|---|---|---|
| `POST /shopify/oauth/connect` | Begin OAuth flow for a shop, linking it to an Organization | admin+ |
| `GET /shopify/oauth/callback` | Complete OAuth handshake; creates/updates `ShopifyStore` + `ShopifyInstallation` | validated via Shopify HMAC + state param, not role-gated |
| `GET /shopify/shops/:shopifyStoreId/themes` | List themes currently installed on the merchant's shop (live Admin API call) — used only to check theme-slot availability before install, never to import or parse the merchant's existing theme | viewer+ |
| `POST /shopify/shops/:shopifyStoreId/projects/:projectId/publish` | Install (first time, via `themeCreate` from the Base Theme source) or update (subsequent times) the Base Theme in the shop, apply the Project's current `StoreConfigVersion` onto it via `themeFilesUpsert`, and publish it live via `themePublish` | admin+ |
| `POST /shopify/shops/:shopifyStoreId/projects/:projectId/rollback` | Revert the live theme's applied configuration to a prior `PublishHistory` entry | admin+ |

**`POST /shopify/oauth/connect`**
- Input: `{ organizationId, shopDomain, redirectUri }`
- Output: `{ authorizationUrl }`
- Side effect: none yet — no `ShopifyStore` is created until the callback completes.
- Idempotency: `Idempotency-Key` supported.

**`GET /shopify/oauth/callback`**
- Input (query): `{ code, shop, state, hmac }`
- Output: redirect to app UI; underlying result `{ shopifyStoreId, status, writeThemesExemptionStatus }`
- Validation: Shopify HMAC signature and `state` param must match the initiating `connect` call.
- Side effect: creates/updates `ShopifyStore` + `ShopifyInstallation`.

**`GET /shopify/shops/:shopifyStoreId/themes`**
- Output: `[{ shopifyThemeId, name, role }]` plus a `themeSlotsAvailable: boolean` summary flag (Shopify caps the
  number of themes a shop may hold).
- No `alreadyImported` field — nothing returned here is ever imported.

**`POST /shopify/shops/:shopifyStoreId/projects/:projectId/publish`**
- Input: `{ storeConfigVersionId }`
- Output: `202 { publishHistoryId, status: "pending" }`
- Precondition: `ShopifyInstallation.writeThemesExemptionStatus = "granted"`; otherwise `403` with an
  explanation. **TBD / Decision Required:** the approval criteria and timeline for Shopify's `write_themes`
  exemption on a public app are not finalized — this gates every publish call and is a launch dependency, not
  just a documentation gap.
- Concurrency: server holds a publish lock per `Project` — only one in-flight publish at a time; a second call
  while one is pending returns `409 Conflict`.
- Side effects: installs or updates the merchant's Base Theme copy, writes the Store Configuration onto it as
  Shopify theme JSON/settings, publishes it live, and records a `PublishHistory` entry. Liquid itself is never
  generated or written at this step — only theme JSON/settings.
- Idempotency: `Idempotency-Key` supported (in addition to the publish lock).
- **TBD / Decision Required:** the policy for *when* an already-published store's Base Theme copy gets updated
  to a newer Base Theme version (every publish call vs. an explicit opt-in) is unresolved, as is the settings-
  schema migration path across Base Theme versions for stores already live on an older one.

**`POST /shopify/shops/:shopifyStoreId/projects/:projectId/rollback`**
- Input: `{ publishHistoryId }` (or `{ targetStoreConfigVersionId }`)
- Output: `202 { publishHistoryId, status: "pending" }`
- Concurrency: same per-`Project` publish lock as above.
- Side effect: republishes a prior recorded `PublishHistory` entry onto the live theme.
- Idempotency: `Idempotency-Key` supported.

**TBD / Needs Investigation** for this group as a whole: GraphQL Admin API rate-limit figures for the
`themeCreate`/`themeFilesUpsert`/`themePublish` calls this group makes need re-confirmation at implementation
time; exact `themes/update`/`themes/publish` webhook firing semantics are likewise not finalized.

---

## 7. `/product/*`

Import a product from a URL; read import status/result. This is the entry point of the flow (Product URL →
Product Import/Scraper → Product Data). See [Product Import](05-product-import.md).

| Method + path | Purpose | Auth |
|---|---|---|
| `POST /product/import` | Kick off a product import from a URL — creates a `Project` (status `generating`) and a `Product` row, and triggers the scraper | editor+ |
| `GET /product/:productId` | Fetch import status and, once available, the imported product data | viewer+ |

**`POST /product/import`**
- Input: `{ organizationId, sourceUrl }`
- Output: `202 { projectId, productId, importStatus: "importing" }`
- Idempotency: `Idempotency-Key` — retried calls with the same key return the existing `projectId`/`productId`
  rather than starting a second import.
- Side effects: creates a `Project` and a `Product` row, triggers the scraper.
- **TBD / Decision Required:** MVP supports a small allowlisted set of source shapes rather than arbitrary
  product URLs; the exact allowlist and the criteria for expanding it post-MVP are not finalized. See
  [MVP Scope](24-mvp-scope.md).

**`GET /product/:productId`**
- Output: the `Product` record (see [Data Model](19-data-model.md)), including `importStatus`, `importError`,
  and `importedFieldsMissing` for the pending/partial/failed cases, and the scraped fields once `succeeded`.
- No separate job entity is exposed — import progress lives entirely on `Product.importStatus`.

---

## 8. `/project/*`

Resource-oriented CRUD and lifecycle operations on a Project's configuration: current config, a page's
sections, section/block/setting mutations, version history, restore, undo/redo. The mutation endpoints here are
a convenience subset of the same underlying `StoreOperation` → Diff mutation path described in
[§3](#3-concurrency-model) — intended for the AI store-generation pipeline and non-interactive integrations that
don't hold an open live-editing session. [`/editor/*`](#11-editorshared) is the canonical, full-operation-set
surface used by the live Visual Editor session itself. Both paths require and return `lockVersion`; there is
exactly one mutation path underneath, not two.

### Canonical endpoints

| Method + path | Purpose | Auth |
|---|---|---|
| `GET /project/:projectId/config` | Fetch the current (draft) Store Configuration + `lockVersion` | viewer+ |
| `GET /project/:projectId/pages/:pageId/sections` | Fetch one page's ordered section list (lighter payload than the full config) | viewer+ |
| `POST /project/:projectId/sections` | Apply `add_section` | editor+ |
| `DELETE /project/:projectId/sections/:sectionId` | Apply `remove_section` | editor+ |
| `POST /project/:projectId/sections/:sectionId/reorder` | Apply `reorder_section` | editor+ |
| `PATCH /project/:projectId/sections/:sectionId/settings` | Apply `set_setting` (one or more settings in one call) | editor+ |
| `GET /project/:projectId/versions` | List `StoreConfigVersion` history | viewer+ |
| `POST /project/:projectId/versions/:versionId/restore` | Restore the Project's active version to a prior version's configuration | editor+ |
| `POST /project/:projectId/undo` | Undo the most recent Diff on the active version | editor+ |
| `POST /project/:projectId/redo` | Redo the most recently undone Diff | editor+ |

**`GET /project/:projectId/config`** → `{ configuration: StoreConfiguration, storeConfigVersionId, lockVersion }`
(see [Store Configuration](03-store-configuration.md) for the shape).

**`GET /project/:projectId/pages/:pageId/sections`** → `{ sections: SectionInstance[], lockVersion }`

**`POST /project/:projectId/sections`**
- Input: `{ pageId, sectionType, position, settings?, lockVersion }`
- Output: `200 { sectionId, lockVersion }`
- Validation: `sectionType` must exist in the [Section Library](02-base-theme-and-section-library.md) catalog.

**`DELETE /project/:projectId/sections/:sectionId`**
- Input (query/body): `{ lockVersion }`
- Output: `200 { lockVersion }`

**`POST /project/:projectId/sections/:sectionId/reorder`**
- Input: `{ toIndex, toPageId?, lockVersion }`
- Output: `200 { lockVersion }`

**`PATCH /project/:projectId/sections/:sectionId/settings`**
- Input: `{ settings: { [settingId]: value }, lockVersion }`
- Output: `200 { lockVersion, diff: DiffEntry[] }`
- Validation: each setting value is checked against that section's settings schema
  ([Shared Section Contract](12-shared-section-contract.md)).

**`GET /project/:projectId/versions`** → `[{ id, label, status, producedByType, createdAt, createdByUserId }]`

**`POST /project/:projectId/versions/:versionId/restore`**
- Input: `{ lockVersion }`
- Output: `200 { storeConfigVersionId, lockVersion }`

**`POST /project/:projectId/undo`** / **`POST /project/:projectId/redo`**
- Input: `{ lockVersion }`
- Output: `200 { lockVersion, diff: DiffEntry[] }`

### Supplementary endpoints (block / content / global-style coverage)

| Method + path | Purpose | Auth |
|---|---|---|
| `POST /project/:projectId/sections/:sectionId/blocks` | Apply `add_block` | editor+ |
| `DELETE /project/:projectId/sections/:sectionId/blocks/:blockId` | Apply `remove_block` | editor+ |
| `POST /project/:projectId/sections/:sectionId/blocks/:blockId/reorder` | Apply `reorder_block` | editor+ |
| `PATCH /project/:projectId/sections/:sectionId/blocks/:blockId/settings` | Apply `set_block_setting` | editor+ |
| `PATCH /project/:projectId/sections/:sectionId/content` | Apply `set_content` (copy/text fields) | editor+ |
| `PATCH /project/:projectId/global-style` | Apply `set_global_style` (e.g. `path = "colors.accent"`) | editor+ |

All six follow the same contract as their canonical siblings: a target-identifying payload, `lockVersion` in,
`{ lockVersion, diff? }` out.

Every mutating endpoint in this group is validated by the shared validation pipeline and produces a Diff before
committing — see [Validation and Error Handling](17-validation-and-error-handling.md) and
[Versioning and Undo/Redo](18-versioning-and-undo-redo.md).

---

## 9. `/sections/*`

Read-only access to the fixed [Section Library](02-base-theme-and-section-library.md) catalog
(`SectionDefinition`), for the editor's section picker and for the AI's generation/validation context. No
mutation endpoints — the catalog is maintained by Shopforge, not by merchants or the AI.

| Method + path | Purpose | Auth |
|---|---|---|
| `GET /sections` | List the section catalog | viewer+ |
| `GET /sections/:type` | Fetch one section type's full schema | viewer+ |

**`GET /sections`**
- Input (query): `{ category?, includeDeprecated? }`
- Output: `[{ type, category, name, description, schemaVersion, thumbnailUrl }]`

**`GET /sections/:type`**
- Output: `{ type, schemaVersion, settingsSchema, blocksSchema, liquidTemplateRef }`

---

## 10. `/ai/*`

Store generation, conversation, chat, planning, execution, clarification, regeneration, media/copy generation.
See [AI Architecture](04-ai-architecture.md).

| Method + path | Purpose | Auth |
|---|---|---|
| `POST /ai/generate` | Kick off full AI store generation from an imported `Product` — produces the first `StoreConfigVersion` (section selection, ordering, settings, content) | editor+ |
| `POST /ai/conversations` | Start a new `AIConversation` scoped to a `StoreConfigVersion` | editor+ |
| `GET /ai/conversations/:id` | Fetch conversation + message history | viewer+ (read only) |
| `POST /ai/conversations/:id/messages` | Send a chat message; streams the AI response | editor+ |
| `POST /ai/conversations/:id/plan` | Generate an `OperationPlan` for a request | editor+ |
| `POST /ai/plans/:operationPlanId/execute` | Approve and execute an `OperationPlan`'s operations | editor+ |
| `POST /ai/conversations/:id/clarify-answer` | Answer an AI clarifying question, resuming planning | editor+ |
| `POST /ai/conversations/:id/regenerate-section` | Regenerate one section's content/settings (`regenerate_section`) | editor+ |
| `POST /ai/conversations/:id/regenerate-page` | Regenerate an entire page's section selection/content (`regenerate_page`) | editor+ |
| `POST /ai/conversations/:id/generate-image` | Generate an image asset via AI | editor+ |
| `POST /ai/conversations/:id/generate-copy` | Generate marketing/section copy via AI | editor+ |

**`POST /ai/generate`**
- Input: `{ projectId, productId, preferences? }` (`preferences` — optional style/tone hints)
- Output: `text/event-stream` (`token`, `section_selected`, `usage`, `done`, `error` events) → on completion,
  `Project.status` becomes `draft` and a new `StoreConfigVersion` (`producedByType = ai_generation`) is created;
  also opens an `AIConversation` with `conversationType = initial_generation`.
- Validation: `estimatedCreditCost` checked against `CreditBalance.currentBalance` before starting; `402` if
  insufficient.
- Idempotency: `Idempotency-Key` supported.

**`POST /ai/conversations`**
- Input: `{ storeConfigVersionId, title? }`
- Output: `{ aiConversationId }`

**`GET /ai/conversations/:id`** → `{ conversation: AIConversation, messages: AIMessage[], plans: OperationPlan[] }`

**`POST /ai/conversations/:id/messages`**
- Input: `{ content, attachments?, clientMessageId }` (`clientMessageId` dedupes retried sends)
- Output: `text/event-stream` (`token`, `operation_plan`, `clarification_needed`, `usage`, `done` events); final
  persisted state fetchable via `GET /ai/conversations/:id`.
- Behavior: a natural-language request that is ambiguous (cannot be resolved to a specific section/setting
  operation) emits `clarification_needed` rather than guessing.

**`POST /ai/conversations/:id/plan`**
- Input: `{ prompt }` or `{ messageId }`
- Output: `202` (SSE progress) → `{ operationPlanId, operations: Operation[], rationale, overallRiskLevel, estimatedTotalCreditCost }`

**`POST /ai/plans/:operationPlanId/execute`**
- Input: `{ lockVersion, approvedOperationIds? }` (`approvedOperationIds` supports partial approval of a
  multi-step plan)
- Output: `202 { status: "executing" }` (SSE progress on the parent conversation) → final
  `{ appliedOperationIds, conflictedOperationIds, lockVersion }`
- Concurrency: see [§3](#3-concurrency-model) — requires the current `lockVersion`, re-validated per operation;
  a mid-execution conflict partially applies and reports the rest as `conflicted`.
- Validation: `estimatedTotalCreditCost` checked against `CreditBalance` before starting; `402` if insufficient.

**`POST /ai/conversations/:id/clarify-answer`**
- Input: `{ clarificationId, answer }`
- Output: resumes the SSE stream / produces a revised plan.

**`POST /ai/conversations/:id/regenerate-section`**
- Input: `{ sectionId, prompt?, lockVersion }`
- Output: `202` (SSE progress) → `{ operationId, lockVersion, diff: DiffEntry[] }`
- Behavior: provenance-aware — only `ai`-tagged fields on the section are regenerated by default; `user`-tagged
  fields are never silently overwritten. See [AI Architecture](04-ai-architecture.md).

**`POST /ai/conversations/:id/regenerate-page`**
- Input: `{ pageId, prompt?, lockVersion }`
- Output: `202` (SSE progress) → `{ operationId, lockVersion, diff: DiffEntry[] }`
- Same provenance-aware behavior as `regenerate-section`, applied per section on the page.

**`POST /ai/conversations/:id/generate-image`**
- Input: `{ prompt, targetSectionId?, targetSettingId?, style?, dimensions? }`
- Output: `202 { generatedAssetId, status: "generating" }` (SSE progress) → `GeneratedAsset`
- **TBD:** the final storage provider for generated assets is not finalized.
- Deferred post-MVP — see [MVP Scope](24-mvp-scope.md).

**`POST /ai/conversations/:id/generate-copy`**
- Input: `{ prompt, targetSectionId?, targetSettingId? }`
- Output: `text/event-stream` token stream → `{ text, aiUsageEventId }`

`generate_copy`, `generate_image`, `regenerate_section`, and `regenerate_page` are the four AI-generation
operation types. They are deliberately **not** exposed as direct `/editor/*` endpoints — see [§11](#11-editorshared).

---

## 11. `/editor/*`

Read/write the Store Configuration for a version via the same mutation path AI operations use. Every mutating
endpoint below requires the caller's last-read `lockVersion` and returns the new one. This is the surface the
live Visual Editor session (embedded in the [same-origin preview iframe](08-preview-iframe.md)) binds to. See
[Visual Editor](09-visual-editor.md).

The canonical endpoint list mirrors the core operation types that make up ordinary interactive editing:
`get-config`, `set-setting`, `add-section`, `reorder-section`, `set-block-setting`, `reorder-block`,
`set-global-style`, `save`, `preview-token`. A second table lists supplementary endpoints needed for full
operation-type coverage (e.g. removing a section has no counterpart in the canonical list) — these extend the
group, they do not rename anything in it.

### Canonical endpoints

| Method + path | Purpose | Auth |
|---|---|---|
| `GET /editor/versions/:storeConfigVersionId/config` | Fetch the current Store Configuration + `lockVersion` for the live editing session | viewer+ |
| `POST /editor/versions/:storeConfigVersionId/set-setting` | Apply `set_setting` — change one or more section settings | editor+ |
| `POST /editor/versions/:storeConfigVersionId/add-section` | Apply `add_section` | editor+ |
| `POST /editor/versions/:storeConfigVersionId/reorder-section` | Apply `reorder_section` | editor+ |
| `POST /editor/versions/:storeConfigVersionId/set-block-setting` | Apply `set_block_setting` | editor+ |
| `POST /editor/versions/:storeConfigVersionId/reorder-block` | Apply `reorder_block` | editor+ |
| `POST /editor/versions/:storeConfigVersionId/set-global-style` | Apply `set_global_style` | editor+ |
| `POST /editor/versions/:storeConfigVersionId/save` | Persist a checkpoint of the current configuration state | editor+ |
| `POST /editor/versions/:storeConfigVersionId/preview-token` | Issue a short-lived signed preview URL/token for the LiquidJS Preview Renderer's same-origin iframe | viewer+ |

**`GET /editor/versions/:storeConfigVersionId/config`** → `{ configuration: StoreConfiguration, lockVersion }`

**`POST /editor/versions/:storeConfigVersionId/set-setting`**
- Input: `{ sectionId, settingId, value, lockVersion }`
- Output: `200 { lockVersion, diff: DiffEntry[] }`

**`POST /editor/versions/:storeConfigVersionId/add-section`**
- Input: `{ pageId, sectionType, presetName?, position, lockVersion }`
- Output: `200 { sectionId, lockVersion }`

**`POST /editor/versions/:storeConfigVersionId/reorder-section`**
- Input: `{ sectionId, toIndex, toPageId?, lockVersion }`
- Output: `200 { lockVersion }`

**`POST /editor/versions/:storeConfigVersionId/set-block-setting`**
- Input: `{ sectionId, blockId, settingId, value, lockVersion }`
- Output: `200 { lockVersion, diff: DiffEntry[] }`

**`POST /editor/versions/:storeConfigVersionId/reorder-block`**
- Input: `{ sectionId, blockId, toIndex, lockVersion }`
- Output: `200 { lockVersion }`

**`POST /editor/versions/:storeConfigVersionId/set-global-style`**
- Input: `{ path, value, lockVersion }` (e.g. `path = "colors.accent"`)
- Output: `200 { lockVersion }`

**`POST /editor/versions/:storeConfigVersionId/save`**
- Purpose: an explicit checkpoint. Each individual mutation above is already durable on its own, so `save`
  primarily matters for clients that batch several optimistic local changes before committing, and for
  prompting the LiquidJS Preview Renderer to refresh its preview-ready state.
- Input: `{ lockVersion }`
- Output: `200 { lockVersion, savedAt }`

**`POST /editor/versions/:storeConfigVersionId/preview-token`**
- Output: `200 { previewUrl, token, expiresAt }`
- See [Preview iframe](08-preview-iframe.md).

### Supplementary endpoints (full operation-type coverage)

| Method + path | Purpose | Auth |
|---|---|---|
| `POST /editor/versions/:storeConfigVersionId/remove-section` | Apply `remove_section` | editor+ |
| `POST /editor/versions/:storeConfigVersionId/duplicate-section` | Apply `duplicate_section` | editor+ |
| `POST /editor/versions/:storeConfigVersionId/add-block` | Apply `add_block` | editor+ |
| `POST /editor/versions/:storeConfigVersionId/remove-block` | Apply `remove_block` | editor+ |
| `POST /editor/versions/:storeConfigVersionId/set-content` | Apply `set_content` (copy/text fields, distinct from `set-setting`) | editor+ |

All five follow the same request/response contract as their canonical siblings: a target-identifying payload,
`lockVersion` in, `{ lockVersion, diff? }` out.

`generate_copy`, `generate_image`, `regenerate_section`, and `regenerate_page` — the four AI-generation
operation types — are deliberately **not** exposed as direct `/editor/*` endpoints: raw generation only ever
happens through `/ai/*`, never as a manual editor action, since it always costs AI credit and always runs
through the AI generation/validation pipeline (see [AI Architecture](04-ai-architecture.md) and
[Validation and Error Handling](17-validation-and-error-handling.md)). A manual "swap this image" edit is not a
distinct operation type in this architecture — since Store Configuration settings hold asset URLs rather than
theme file paths, replacing an image is just `set-setting` with a new `url` value, picked from the Project's
asset library.

---

## 12. `/preview/*`

The [LiquidJS Preview Renderer](06-preview-architecture.md) is primarily client-side (same-origin iframe, live
as the user edits), but generating a shareable preview link or a static thumbnail image needs a render that
doesn't depend on a logged-in browser session running the client bundle — so a small server-side invocation of
the same renderer covers those two cases specifically.

| Method + path | Purpose | Auth |
|---|---|---|
| `POST /preview/versions/:storeConfigVersionId/render` | Server-side render one page of the Store Configuration via LiquidJS, returning HTML (for unauthenticated share links) | viewer+ |
| `GET /preview/versions/:storeConfigVersionId/thumbnail` | Fetch (generating and caching if needed) a thumbnail image of a page | viewer+ |

**`POST /preview/versions/:storeConfigVersionId/render`**
- Input: `{ pageId }`
- Output: `200 { html }` for small pages; `202 { renderJobId }` → poll if rendering is queued (e.g. under load).

**`GET /preview/versions/:storeConfigVersionId/thumbnail`**
- Input (query): `{ pageId }`
- Output: `200`, `Content-Type: image/png`, cached by `configHash` so an unchanged version never re-renders.

**TBD / Needs Investigation:** whether the *live-editing-session* preview (the same-origin iframe the Visual
Editor binds to) renders LiquidJS client-side or server-side is unresolved. The server-side render covered by
this group is settled and scoped narrowly to share-link and thumbnail rendering only — it is not a statement
about where live-editing-session rendering happens.

---

## 13. Open questions carried into this contract

These are not resolved by the API surface above and should not be treated as settled when implementing it:

- **`write_themes` exemption approval criteria/timeline** — gates every `/shopify/shops/.../publish` call
  (§6).
- **Base Theme update policy for already-published stores** (auto-update on every publish vs. opt-in) — affects
  the "update (subsequent times)" behavior of publish (§6).
- **Section settings-schema migration path** across Base Theme versions for already-published stores — affects
  publish and rollback for stores on an older Base Theme version (§6).
- **GraphQL Admin API rate-limit figures** for the Shopify calls `/shopify/*` makes — needs re-confirmation at
  implementation time (§6).
- **Exact `themes/update`/`themes/publish` webhook firing semantics** — not covered by any endpoint above (§6).
- **Client-side vs. server-side LiquidJS execution for the live-editing preview** — the `/preview/*` server-side
  render is settled for share-link/thumbnail use only (§12).
- **Final storage provider for generated assets** — affects `GeneratedAsset` records returned by
  `POST /ai/conversations/:id/generate-image` (§10).
- **Exact supported Product Import source allowlist**, and the criteria for expanding it post-MVP — affects
  `POST /product/import` (§7).
