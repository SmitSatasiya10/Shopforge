# 18. API Architecture

Full API surface for Shopforge, organized into six groups: `/shopify/*`, `/product/*`, `/project/*`, `/sections/*`, `/ai/*`, `/editor/*`. This doc also defines the org-role permission model those endpoints are checked against, the concurrency strategy for concurrent editor/AI writes to the same `StoreConfigVersion`, how streaming AI output reaches the frontend, and how long-running operations are represented.

All endpoints are namespaced under an org context resolved from the session (JWT carrying `userId` + active `organizationId`); path segments below omit a common `/api/v1` prefix for brevity.

Two similarly-named path segments appear below and are kept deliberately distinct: `/shopify/shops/:shopifyStoreId/...` addresses a connected merchant `myshopify.com` shop (`ShopifyStore`, doc 17); `/project/:projectId/...` and `/editor/versions/:storeConfigVersionId/...` address a Shopforge-generated store project (`Project` / `StoreConfigVersion`, doc 17). Field and path names always spell out `shopifyStoreId` vs. `projectId` in full — never a bare `storeId` — to keep the two unambiguous.

---

## Roles

Every endpoint below is gated by the caller's `OrgMembership.role` for the Organization that owns the target resource. Four roles, strictly ordered `viewer < editor < admin < owner`; a higher role implicitly has every permission of the roles below it unless stated otherwise.

| Role | Can do | Cannot do |
|---|---|---|
| **viewer** | Read everything: list connected shops, list stores, view Store Configuration/pages/sections, view diff & version history, view AI conversations, view publish history. | Any mutation. Cannot send AI messages, run operations, save edits, publish, or manage members/billing. |
| **editor** | Everything viewer can, plus: all content work — import a product, kick off AI store generation, create/branch `StoreConfigVersion`s, all `/editor/*` and `/project/*` mutations, all `/ai/*` conversation/plan/execute/generate endpoints, trigger restores/undo/redo. | Connect/disconnect Shopify OAuth, publish/rollback to the live store, manage org members or billing. |
| **admin** | Everything editor can, plus: connect/disconnect Shopify OAuth (`/shopify/oauth/*`), publish and rollback (`/shopify/shops/.../publish`, `/shopify/shops/.../rollback`), invite/remove members with role editor/viewer/admin. | Delete the Organization, manage the Subscription/billing, change or remove the owner. |
| **owner** | Everything admin can, plus: billing/Subscription management, transfer ownership, delete the Organization. | — |

Rationale for the editor/admin split: publish and OAuth-disconnect are the two action classes that affect the **live storefront or the store's connection integrity** directly and irreversibly outside of Shopforge's own undo system — everything else (drafting, AI edits, saving, even destructive-looking in-app operations) is fully reversible via Diff/version restore (doc 14) and so is safe to leave to any editor.

---

## Concurrency model

`StoreConfigVersion.lockVersion` (doc 17 §8) is the single concurrency-control point for the whole system. Both the visual editor and the AI operation executor write through the exact same mutation path (doc 11), so they share the exact same lock.

**Protocol:**
1. Every read of a Store Configuration (`GET .../config`) returns the current `lockVersion` alongside it.
2. Every mutating request that touches a `StoreConfigVersion` (an `/editor/*` or `/project/*` mutation, or AI plan execution) must include the `lockVersion` it last read.
3. The server applies the mutation as a compare-and-swap: `UPDATE store_config_versions SET configuration = ?, lock_version = lock_version + 1 WHERE id = ? AND lock_version = ?`. Zero rows affected → `409 Conflict`, response body includes the current `lockVersion` and full configuration so the client can rebase.
4. Structural editor ops (`set-setting`, `reorder-section`, etc.) are single-step and resolve the CAS synchronously in the request.
5. AI plan execution (`POST /ai/plans/:id/execute`) applies several operations in sequence over what can be a multi-second job. It re-validates `lockVersion` before **each** operation, not just once at the start. If a concurrent editor save lands mid-execution, already-applied operations are **not** rolled back (they were honestly applied against a valid lock at the time); remaining operations are aborted and reported as `conflicted` in the job result, and the client is prompted to re-plan the remainder against the now-current configuration. This partial-apply approach is preferred over full-transaction rollback because every individual operation is already independently diffed and reversible — there's no correctness reason to discard successful work.
6. `estimatedCreditCost` is checked against `CreditBalance.currentBalance` before an AI operation/plan starts; insufficient balance returns `402 Payment Required` without touching the lock.

This uniform handling is what lets a user drag-and-drop a section in the editor at the same moment an AI plan is executing against the same `StoreConfigVersion` without silently losing either party's change.

---

## Streaming: Server-Sent Events (SSE)

AI chat responses, store-generation progress, and generation-in-progress updates are streamed to the frontend over **SSE**, not WebSockets. Justification:

- The data flow is fundamentally one-directional (server → client token/event stream); the client's own actions (send message, approve plan, answer a clarification) are small, infrequent, and naturally fit as ordinary POSTs rather than needing a persistent duplex channel.
- SSE rides plain HTTP, so it passes through standard proxies/load balancers and browser network stacks without upgrade-handshake special-casing that WebSockets sometimes need.
- `EventSource` has built-in reconnect-with-last-event-id, which maps directly onto "resume this AI response stream if the connection drops," at no extra implementation cost.
- Infra stays simpler: one more long-lived HTTP response to hold open per active conversation, not a second connection protocol to load-balance and keep sticky.

Concretely: `POST /ai/generate`, `POST /ai/conversations/:id/messages` (and `/plan`, `/generate-image`) return `Content-Type: text/event-stream` and emit named events (`token`, `operation_plan`, `clarification_needed`, `usage`, `done`, `error`) as the response streams in. A client that isn't actively watching (e.g. reopens the app mid-generation) falls back to polling `GET /ai/conversations/:id` for the latest persisted `AIMessage`/`OperationPlan` state — the SSE stream is a live view onto the same persisted rows, never the only source of truth.

---

## Long-running operations

Shopforge does not introduce a generic "Job" entity — every async endpoint's progress is exposed through the **status field of the domain entity it's already writing to** (doc 17), so there's one state model per concept instead of a parallel job-tracking system.

| Operation | Sync or async | Status surfaced via |
|---|---|---|
| Product import | async, `202` | `Product.importStatus` / poll `GET /product/:productId` |
| AI store generation | async, `202` (SSE progress) | `Store.status` + `StoreConfigVersion` row appears |
| AI plan generation | async, `202` (SSE progress) | `OperationPlan.status` |
| AI plan execution | async, `202` (SSE progress) | `OperationPlan.status` + each `StoreOperation.status` |
| AI regenerate section/page | async, `202` (SSE progress) | parent `StoreOperation.status` |
| Generate image | async, `202` (SSE progress) | `GeneratedAsset.status` |
| Generate copy | sync (SSE token stream, resolves in seconds) | inline response |
| Publish | async, `202` | `PublishHistory.status` |
| Rollback | async, `202` | `PublishHistory.status` |
| Restore a version (undo/redo, restore-to-version) | sync, `200` | in-model, fast enough not to need a job — configuration is a JSON document, not a file tree |
| Editor/store structural mutations | sync, `200` | inline response with new `lockVersion` |
| Server-side preview render | sync or async `202` depending on payload size | see `/preview/*` below |

For clients already holding an open SSE connection on the relevant `AIConversation` (generation, plan generation, plan execution, image generation all happen within a conversation), progress and completion are pushed as SSE events instead of requiring polling. Polling against the resource's own `GET` endpoint is the universal fallback for everything else, including endpoints outside any conversation (import, publish, rollback).

**Idempotency:** mutating endpoints that trigger an external side effect (`POST /product/import`, `POST /ai/generate`, `POST /shopify/shops/.../publish`, `POST /shopify/shops/.../rollback`, `POST /shopify/oauth/connect`) accept an `Idempotency-Key` header; the server deduplicates retried requests against a short-lived key store so a network retry can never double-import, double-generate, or double-publish. Editor/store/AI-operation mutations don't need a separate idempotency key — the `lockVersion` compare-and-swap already makes a retried request either a no-op (same base state, same result) or a clean `409` (base state moved on).

---

## `/shopify/*`

OAuth, merchant theme-slot check, install/publish, rollback. This group deliberately does **not** contain anything that reads or imports the merchant's existing theme content — Shopforge installs its own Base Theme (`themeCreate` from our own theme source) rather than duplicating or parsing whatever the merchant already has (doc 16).

| Method + path | Purpose | Auth |
|---|---|---|
| `POST /shopify/oauth/connect` | Begin OAuth flow for a shop, linking it to an Organization | admin+ |
| `GET /shopify/oauth/callback` | Complete OAuth handshake; creates/updates `ShopifyStore` + `ShopifyInstallation` | validated via Shopify HMAC + state param, not role-gated |
| `GET /shopify/shops/:shopifyStoreId/themes` | List themes currently installed on the merchant's shop (live Admin API call) — used only to check theme-slot availability before install, never to import or parse the merchant's existing theme | viewer+ |
| `POST /shopify/shops/:shopifyStoreId/projects/:projectId/publish` | Install (first time, via `themeCreate` from our Base Theme source) or update (subsequent times) our Base Theme in the shop, apply the Project's current `StoreConfigVersion` onto it via `themeFilesUpsert`, and publish it live via `themePublish` | admin+ |
| `POST /shopify/shops/:shopifyStoreId/projects/:projectId/rollback` | Revert the live theme's applied configuration to a prior `PublishHistory` entry | admin+ |

**Details**

`POST /shopify/oauth/connect`
- Request: `{ organizationId, shopDomain, redirectUri }`
- Response: `{ authorizationUrl }`

`GET /shopify/oauth/callback`
- Request (query): `{ code, shop, state, hmac }`
- Response: redirect to app UI; underlying result `{ shopifyStoreId, status, writeThemesExemptionStatus }`

`GET /shopify/shops/:shopifyStoreId/themes`
- Response: `[{ shopifyThemeId, name, role }]` plus a `themeSlotsAvailable: boolean` summary flag (Shopify caps the number of themes a shop may hold)
- No `alreadyImported` field — nothing here is ever imported.

`POST /shopify/shops/:shopifyStoreId/projects/:projectId/publish`
- Request: `{ storeConfigVersionId }`
- Response: `202 { publishHistoryId, status: "pending" }`
- Preconditions: `ShopifyInstallation.writeThemesExemptionStatus = "granted"` (doc 16); otherwise `403` with an explanation.
- Concurrency: server holds a publish lock per `Project` — only one in-flight publish at a time; a second call while one is pending returns `409`.

`POST /shopify/shops/:shopifyStoreId/projects/:projectId/rollback`
- Request: `{ publishHistoryId }` (or `{ targetStoreConfigVersionId }`)
- Response: `202 { publishHistoryId, status: "pending" }`
- Same publish lock as above.

---

## `/product/*`

Import a product from a URL; read import status/result. This is the entry point of the flow (Product URL → Product Import/Scraper → Product Data).

| Method + path | Purpose | Auth |
|---|---|---|
| `POST /product/import` | Kick off a product import from a URL — creates a `Project` (status `generating`) and a `Product` row, and triggers the scraper | editor+ |
| `GET /product/:productId` | Fetch import status and, once available, the imported product data | viewer+ |

**Details**

`POST /product/import`
- Request: `{ organizationId, sourceUrl }`
- Response: `202 { projectId, productId, importStatus: "importing" }`
- Idempotent per `Idempotency-Key`; retried calls with the same key return the existing `projectId`/`productId` rather than starting a second import.

`GET /product/:productId`
- Response: `Product` (doc 17 §6 shape) — includes `importStatus`, `importError`, `importedFieldsMissing` for the pending/partial/failed cases, and the scraped fields once `succeeded`.

---

## `/project/*`

Resource-oriented CRUD and lifecycle operations on a Project's configuration: current config, a page's sections, section/block/setting mutations, version history, restore, undo/redo. The mutation endpoints here are a convenience subset of the same underlying `StoreOperation` → `StoreConfigDiff` mutation path described in "Concurrency model" above — intended for the AI store-generation pipeline and non-interactive integrations that don't hold an open live-editing session. `/editor/*` (below) is the canonical, full-`OperationType`-complete surface used by the live Visual Editor session itself. Both paths require and return `lockVersion`; there is exactly one mutation path underneath, not two.

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
| `POST /project/:projectId/undo` | Undo the most recent `StoreConfigDiff` on the active version | editor+ |
| `POST /project/:projectId/redo` | Redo the most recently undone `StoreConfigDiff` | editor+ |

**Details**

`GET /project/:projectId/config`
- Response: `{ configuration: StoreConfiguration, storeConfigVersionId, lockVersion }` (doc 08 shape)

`GET /project/:projectId/pages/:pageId/sections`
- Response: `{ sections: Section[], lockVersion }`

`POST /project/:projectId/sections`
- Request: `{ pageId, sectionType, position, settings?, lockVersion }`
- Response: `200 { sectionId, lockVersion }`

`DELETE /project/:projectId/sections/:sectionId`
- Request (query/body): `{ lockVersion }`
- Response: `200 { lockVersion }`

`POST /project/:projectId/sections/:sectionId/reorder`
- Request: `{ toIndex, toPageId?, lockVersion }`
- Response: `200 { lockVersion }`

`PATCH /project/:projectId/sections/:sectionId/settings`
- Request: `{ settings: { [settingId]: value }, lockVersion }`
- Response: `200 { lockVersion, diff: DiffEntry[] }`

`GET /project/:projectId/versions`
- Response: `[{ id, label, status, producedByType, createdAt, createdByUserId }]`

`POST /project/:projectId/versions/:versionId/restore`
- Request: `{ lockVersion }`
- Response: `200 { storeConfigVersionId, lockVersion }`

`POST /project/:projectId/undo` / `POST /project/:projectId/redo`
- Request: `{ lockVersion }`
- Response: `200 { lockVersion, diff: DiffEntry[] }`

### Supplementary endpoints (block / content / global-style coverage)

| Method + path | Purpose | Auth |
|---|---|---|
| `POST /project/:projectId/sections/:sectionId/blocks` | Apply `add_block` | editor+ |
| `DELETE /project/:projectId/sections/:sectionId/blocks/:blockId` | Apply `remove_block` | editor+ |
| `POST /project/:projectId/sections/:sectionId/blocks/:blockId/reorder` | Apply `reorder_block` | editor+ |
| `PATCH /project/:projectId/sections/:sectionId/blocks/:blockId/settings` | Apply `set_block_setting` | editor+ |
| `PATCH /project/:projectId/sections/:sectionId/content` | Apply `set_content` (copy/text fields) | editor+ |
| `PATCH /project/:projectId/global-style` | Apply `set_global_style` (e.g. `path = "colors.accent"`) | editor+ |

All six follow the same contract as their canonical siblings: a target-identifying payload, `lockVersion` in, `{ lockVersion, diff? }` out.

---

## `/sections/*`

Read-only access to the fixed Section Library catalog (`SectionDefinition`, doc 17 §9 / doc 07), for the editor's section picker and for the AI's generation/validation context. No mutation endpoints — the catalog is maintained by us, not by merchants or the AI.

| Method + path | Purpose | Auth |
|---|---|---|
| `GET /sections` | List the section catalog | viewer+ |
| `GET /sections/:type` | Fetch one section type's full schema | viewer+ |

**Details**

`GET /sections`
- Request (query): `{ category?, includeDeprecated? }`
- Response: `[{ type, category, name, description, schemaVersion, thumbnailUrl }]`

`GET /sections/:type`
- Response: `{ type, schemaVersion, settingsSchema, blocksSchema, liquidTemplateRef }`

---

## `/ai/*`

Store generation, conversation, chat, planning, execution, clarification, regeneration, media/copy generation.

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

**Details**

`POST /ai/generate`
- Request: `{ projectId, productId, preferences? }` (`preferences` — optional style/tone hints)
- Response: `text/event-stream` (`token`, `section_selected`, `usage`, `done`, `error` events) → on completion, `Store.status` becomes `draft` and a new `StoreConfigVersion` (`producedByType = ai_generation`) is created; also opens an `AIConversation` with `conversationType = initial_generation`
- Cost: gated on `CreditBalance` before starting; `402` if insufficient.

`POST /ai/conversations`
- Request: `{ storeConfigVersionId, title? }`
- Response: `{ aiConversationId }`

`GET /ai/conversations/:id`
- Response: `{ conversation: AIConversation, messages: AIMessage[], plans: OperationPlan[] }`

`POST /ai/conversations/:id/messages`
- Request: `{ content, attachments?, clientMessageId }` (`clientMessageId` dedupes retried sends)
- Response: `text/event-stream` (`token`, `operation_plan`, `clarification_needed`, `usage`, `done` events); final persisted state fetchable via `GET /ai/conversations/:id`

`POST /ai/conversations/:id/plan`
- Request: `{ prompt }` or `{ messageId }`
- Response: `202` (SSE progress) → `{ operationPlanId, operations: Operation[], rationale, overallRiskLevel, estimatedTotalCreditCost }`

`POST /ai/plans/:operationPlanId/execute`
- Request: `{ lockVersion, approvedOperationIds? }` (`approvedOperationIds` supports partial approval of a multi-step plan)
- Response: `202 { status: "executing" }` (SSE progress on the parent conversation) → final `{ appliedOperationIds, conflictedOperationIds, lockVersion }`
- Concurrency: see "Concurrency model" above — requires current `lockVersion`, re-validated per operation.
- Cost: `estimatedTotalCreditCost` checked against `CreditBalance` before starting; `402` if insufficient.

`POST /ai/conversations/:id/clarify-answer`
- Request: `{ clarificationId, answer }`
- Response: resumes the SSE stream / produces a revised plan

`POST /ai/conversations/:id/regenerate-section`
- Request: `{ sectionId, prompt?, lockVersion }`
- Response: `202` (SSE progress) → `{ operationId, lockVersion, diff: DiffEntry[] }`

`POST /ai/conversations/:id/regenerate-page`
- Request: `{ pageId, prompt?, lockVersion }`
- Response: `202` (SSE progress) → `{ operationId, lockVersion, diff: DiffEntry[] }`

`POST /ai/conversations/:id/generate-image`
- Request: `{ prompt, targetSectionId?, targetSettingId?, style?, dimensions? }`
- Response: `202 { generatedAssetId, status: "generating" }` (SSE progress) → `GeneratedAsset`

`POST /ai/conversations/:id/generate-copy`
- Request: `{ prompt, targetSectionId?, targetSettingId? }`
- Response: `text/event-stream` token stream → `{ text, aiUsageEventId }`

---

## `/editor/*`

Read/write the Store Configuration for a version via the same mutation path AI operations use (doc 11). Every mutating endpoint below requires the caller's last-read `lockVersion` and returns the new one. This is the surface the live Visual Editor session (embedded in the same-origin preview iframe) binds to.

The canonical endpoint list mirrors the core `OperationType`s that make up ordinary interactive editing: `get-config, set-setting, add-section, reorder-section, set-block-setting, reorder-block, set-global-style, save, preview-token`. Those nine are documented first, using their exact names. A second table lists **supplementary endpoints** needed for full coverage of the `OperationType` set (doc 11) — e.g. removing a section has no counterpart in the canonical list — these extend the group, they do not rename anything in it.

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
| `POST /editor/versions/:storeConfigVersionId/preview-token` | Issue a short-lived signed preview URL/token for the LiquidJS Preview Renderer's same-origin iframe (doc 09) | viewer+ |

**Details**

`GET /editor/versions/:storeConfigVersionId/config`
- Response: `{ configuration: StoreConfiguration, lockVersion }`

`POST /editor/versions/:storeConfigVersionId/set-setting`
- Request: `{ sectionId, settingId, value, lockVersion }`
- Response: `200 { lockVersion, diff: DiffEntry[] }`

`POST /editor/versions/:storeConfigVersionId/add-section`
- Request: `{ pageId, sectionType, presetName?, position, lockVersion }`
- Response: `200 { sectionId, lockVersion }`

`POST /editor/versions/:storeConfigVersionId/reorder-section`
- Request: `{ sectionId, toIndex, toPageId?, lockVersion }`
- Response: `200 { lockVersion }`

`POST /editor/versions/:storeConfigVersionId/set-block-setting`
- Request: `{ sectionId, blockId, settingId, value, lockVersion }`
- Response: `200 { lockVersion, diff: DiffEntry[] }`

`POST /editor/versions/:storeConfigVersionId/reorder-block`
- Request: `{ sectionId, blockId, toIndex, lockVersion }`
- Response: `200 { lockVersion }`

`POST /editor/versions/:storeConfigVersionId/set-global-style`
- Request: `{ path, value, lockVersion }` (e.g. `path = "colors.accent"`)
- Response: `200 { lockVersion }`

`POST /editor/versions/:storeConfigVersionId/save`
- Purpose: an explicit checkpoint — durably persists the working configuration (each individual mutation above is already durable, so `save` primarily matters for clients that batch several optimistic local changes before committing, and for prompting the LiquidJS Preview Renderer to refresh its preview-ready state).
- Request: `{ lockVersion }`
- Response: `200 { lockVersion, savedAt }`

`POST /editor/versions/:storeConfigVersionId/preview-token`
- Response: `200 { previewUrl, token, expiresAt }`

### Supplementary endpoints (full `OperationType` coverage)

| Method + path | Purpose | Auth |
|---|---|---|
| `POST /editor/versions/:storeConfigVersionId/remove-section` | Apply `remove_section` | editor+ |
| `POST /editor/versions/:storeConfigVersionId/duplicate-section` | Apply `duplicate_section` | editor+ |
| `POST /editor/versions/:storeConfigVersionId/add-block` | Apply `add_block` | editor+ |
| `POST /editor/versions/:storeConfigVersionId/remove-block` | Apply `remove_block` | editor+ |
| `POST /editor/versions/:storeConfigVersionId/set-content` | Apply `set_content` (copy/text fields, distinct from `set-setting`) | editor+ |

All five follow the same request/response contract as their canonical siblings: a target-identifying payload per `StoreOperation.target`/`payload` shape (doc 17 §10), plus `lockVersion` in, `{ lockVersion, diff? }` out. `generate_copy`, `generate_image`, `regenerate_section`, `regenerate_page` — the four AI-generation `OperationType`s — are deliberately **not** exposed as direct `/editor/*` endpoints: raw generation only ever happens through `/ai/*`, never as a manual editor action, since it always costs AI credit and always runs through the generation/validation pipeline (doc 11, doc 15). A manual "swap this image" edit is not a distinct operation type in this architecture — since Store Configuration settings hold asset URLs rather than theme file paths, replacing an image is just `set_setting` with a new `url` value, picked from the Project's `Asset` library (doc 17 §17).

---

## `/preview/*`

Warranted as a small group: the LiquidJS Preview Renderer (doc 09) is primarily client-side (same-origin iframe, live as the user edits), but generating a shareable preview link or a static thumbnail image needs a render that doesn't depend on a logged-in browser session running the client bundle — so a server-side invocation of the same renderer is needed for those two cases specifically.

| Method + path | Purpose | Auth |
|---|---|---|
| `POST /preview/versions/:storeConfigVersionId/render` | Server-side render one page of the Store Configuration via LiquidJS, returning HTML (for unauthenticated share links) | viewer+ |
| `GET /preview/versions/:storeConfigVersionId/thumbnail` | Fetch (generating and caching if needed) a thumbnail image of a page | viewer+ |

**Details**

`POST /preview/versions/:storeConfigVersionId/render`
- Request: `{ pageId }`
- Response: `200 { html }` for small pages; `202 { renderJobId }` → poll if rendering is queued (e.g. under load)

`GET /preview/versions/:storeConfigVersionId/thumbnail`
- Request (query): `{ pageId }`
- Response: `200`, `Content-Type: image/png`, cached by `configHash` so an unchanged version never re-renders
</content>
