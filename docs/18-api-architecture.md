# 18. API Architecture

Full API surface for Shopforge, organized by the four groups defined in architecture core §6: `/shopify/*`, `/theme/*`, `/ai/*`, `/editor/*`. This doc also defines the org-role permission model those endpoints are checked against, the concurrency strategy for concurrent editor/AI writes to the same `ThemeVersion`, how streaming AI output reaches the frontend, and how long-running operations are represented.

All endpoints are namespaced under a store/org context resolved from the session (JWT carrying `userId` + active `organizationId`); path segments below omit a common `/api/v1` prefix for brevity.

---

## Roles

Every endpoint below is gated by the caller's `OrgMembership.role` for the Organization that owns the target `ShopifyStore`. Four roles, strictly ordered `viewer < editor < admin < owner`; a higher role implicitly has every permission of the roles below it unless stated otherwise.

| Role | Can do | Cannot do |
|---|---|---|
| **viewer** | Read everything: list stores/themes, view ThemeModel/manifest, view diff & version history, view AI conversations, view publish history, view snapshots. | Any mutation. Cannot send AI messages, run operations, save edits, publish, or manage members/billing. |
| **editor** | Everything viewer can, plus: all content work — import a theme, create/branch ThemeVersions, all `/editor/*` mutations, all `/ai/*` conversation/plan/execute/generate endpoints, trigger snapshots and restores. | Connect/disconnect Shopify OAuth, publish/rollback to the live store, manage org members or billing. |
| **admin** | Everything editor can, plus: connect/disconnect Shopify OAuth (`/shopify/oauth/*`), publish and rollback (`/shopify/.../publish`, `/shopify/.../rollback`), invite/remove members with role editor/viewer/admin. | Delete the Organization, manage the Subscription/billing, change or remove the owner. |
| **owner** | Everything admin can, plus: billing/Subscription management, transfer ownership, delete the Organization. | — |

Rationale for the editor/admin split: publish and OAuth-disconnect are the two action classes that affect the **live storefront or the store's connection integrity** directly and irreversibly outside of Shopforge's own undo system — everything else (drafting, AI edits, saving, even destructive-looking in-app operations) is fully reversible via Diff/Snapshot and so is safe to leave to any editor.

---

## Concurrency model

`ThemeVersion.lockVersion` (doc 17 §7) is the single concurrency-control point for the whole system. Both the visual editor and the AI operation executor write through the exact same mutation path (Principle 7), so they share the exact same lock.

**Protocol:**
1. Every read of a `ThemeModel` (`GET .../model`) returns the current `lockVersion` alongside it.
2. Every mutating request that touches a `ThemeVersion` (an `/editor/*` mutation, or AI plan execution) must include the `lockVersion` it last read.
3. The server applies the mutation as a compare-and-swap: `UPDATE theme_versions SET theme_model = ?, lock_version = lock_version + 1 WHERE id = ? AND lock_version = ?`. Zero rows affected → `409 Conflict`, response body includes the current `lockVersion` and full model so the client can rebase.
4. Structural editor ops (`update-setting`, `move-section`, etc.) are single-step and resolve the CAS synchronously in the request.
5. AI plan execution (`POST /ai/plans/:id/execute`) applies several operations in sequence over what can be a multi-second job. It re-validates `lockVersion` before **each** operation, not just once at the start. If a concurrent editor save lands mid-execution, already-applied operations are **not** rolled back (they were honestly applied against a valid lock at the time); remaining operations are aborted and reported as `conflicted` in the job result, and the client is prompted to re-plan the remainder against the now-current model. This partial-apply approach is preferred over full-transaction rollback because every individual operation is already independently diffed and reversible — there's no correctness reason to discard successful work.
6. `estimatedCreditCost` is checked against `CreditBalance.currentBalance` before an AI operation/plan starts; insufficient balance returns `402 Payment Required` without touching the lock.

This uniform handling is what lets a user drag-and-drop a section in the editor at the same moment an AI plan is executing against the same `ThemeVersion` without silently losing either party's change.

---

## Streaming: Server-Sent Events (SSE)

AI chat responses, plan-generation progress, and generation-in-progress updates are streamed to the frontend over **SSE**, not WebSockets. Justification:

- The data flow is fundamentally one-directional (server → client token/event stream); the client's own actions (send message, approve plan, answer a clarification) are small, infrequent, and naturally fit as ordinary POSTs rather than needing a persistent duplex channel.
- SSE rides plain HTTP, so it passes through standard proxies/load balancers and browser network stacks without upgrade-handshake special-casing that WebSockets sometimes need.
- `EventSource` has built-in reconnect-with-last-event-id, which maps directly onto "resume this AI response stream if the connection drops," at no extra implementation cost.
- Infra stays simpler: one more long-lived HTTP response to hold open per active conversation, not a second connection protocol to load-balance and keep sticky.

Concretely: `POST /ai/conversations/:id/messages` (and `/plan`, `/generate-image`) return `Content-Type: text/event-stream` and emit named events (`token`, `operation_plan`, `clarification_needed`, `usage`, `done`, `error`) as the response streams in. A client that isn't actively watching (e.g. reopens the app mid-generation) falls back to polling `GET /ai/conversations/:id` for the latest persisted `AIMessage`/`OperationPlan` state — the SSE stream is a live view onto the same persisted rows, never the only source of truth.

---

## Long-running operations

Shopforge does not introduce a generic "Job" entity — every async endpoint's progress is exposed through the **status field of the domain entity it's already writing to** (doc 17), so there's one state model per concept instead of a parallel job-tracking system.

| Operation | Sync or async | Status surfaced via |
|---|---|---|
| Theme parse | async, `202` | `Theme.lastParsedAt` / poll `GET /theme/:themeId/manifest` |
| Theme import | async, `202` | `Theme` row appears + `Theme.lastParsedAt` advances |
| AI plan generation | async, `202` (SSE progress) | `OperationPlan.status` |
| AI plan execution | async, `202` (SSE progress) | `OperationPlan.status` + each `ThemeOperation.status` |
| Generate image | async, `202` (SSE progress) | `GeneratedAsset.status` |
| Generate copy | sync (SSE token stream, resolves in seconds) | inline response |
| Publish | async, `202` | `PublishHistory.status` |
| Rollback | async, `202` | `PublishHistory.status` |
| Snapshot creation | async, `202` | poll `GET .../snapshots` for the new row's presence |
| Restore from snapshot | async, `202` | `ThemeVersion.lockVersion` change + poll |
| Restore from diff (undo) | sync, `200` | in-model, fast enough not to need a job |
| Editor structural mutations | sync, `200` | inline response with new `lockVersion` |

For clients already holding an open SSE connection on the relevant `AIConversation` (plan generation, plan execution, image generation all happen within a conversation), progress and completion are pushed as SSE events instead of requiring polling. Polling against the resource's own `GET` endpoint is the universal fallback for everything else, including endpoints outside any conversation (parse, import, publish, rollback).

**Idempotency:** mutating endpoints that trigger an external side effect on Shopify's own API (`import`, `publish`, `rollback`, `oauth/connect`) accept an `Idempotency-Key` header; the server deduplicates retried requests against a short-lived key store so a network retry can never double-import or double-publish. Editor/AI mutations don't need a separate idempotency key — the `lockVersion` compare-and-swap already makes a retried request either a no-op (same base state, same result) or a clean `409` (base state moved on).

---

## `/shopify/*`

OAuth, theme discovery/import, publish, rollback.

| Method + path | Purpose | Auth |
|---|---|---|
| `POST /shopify/oauth/connect` | Begin OAuth flow for a shop, linking it to an Organization | admin+ |
| `GET /shopify/oauth/callback` | Complete OAuth handshake; creates/updates `ShopifyStore` + `ShopifyInstallation` | validated via Shopify HMAC + state param, not role-gated |
| `GET /shopify/stores/:storeId/themes` | List themes on the Shopify store (live Admin API call, cross-referenced against local `Theme` rows) | viewer+ |
| `POST /shopify/stores/:storeId/themes/import` | Pull a Shopify theme's files into Shopforge, creating `Theme` and triggering initial parse | editor+ |
| `POST /shopify/stores/:storeId/themes/:themeId/publish` | Push a `ThemeVersion`'s serialized files live as the store's published theme | admin+ |
| `POST /shopify/stores/:storeId/themes/:themeId/rollback` | Revert the live store theme to a prior `PublishHistory` entry | admin+ |

**Details**

`POST /shopify/oauth/connect`
- Request: `{ organizationId, shopDomain, redirectUri }`
- Response: `{ authorizationUrl }`

`GET /shopify/oauth/callback`
- Request (query): `{ code, shop, state, hmac }`
- Response: redirect to app UI; underlying result `{ shopifyStoreId, status }`

`GET /shopify/stores/:storeId/themes`
- Request (query): `{ includeUnpublished? }`
- Response: `[{ shopifyThemeId, name, role, alreadyImported: boolean }]`

`POST /shopify/stores/:storeId/themes/import`
- Request: `{ shopifyThemeId }`
- Response: `202 { themeId, status: "importing" }`
- Idempotent per `(storeId, shopifyThemeId)` via `unique(shopifyStoreId, shopifyThemeId)` on `Theme` — re-import returns the existing `Theme` and triggers a re-parse rather than duplicating.

`POST /shopify/stores/:storeId/themes/:themeId/publish`
- Request: `{ themeVersionId }`
- Response: `202 { publishHistoryId, status: "pending" }`
- Concurrency: server holds a publish lock per `Theme` — only one in-flight publish at a time; a second call while one is pending returns `409`.

`POST /shopify/stores/:storeId/themes/:themeId/rollback`
- Request: `{ publishHistoryId }` (or `{ targetThemeVersionId }`)
- Response: `202 { publishHistoryId, status: "pending" }`
- Same publish lock as above.

---

## `/theme/*`

Parse, manifest, model reads, version history, diff, restore, snapshot.

| Method + path | Purpose | Auth |
|---|---|---|
| `POST /theme/:themeId/parse` | (Re-)run the Theme Parser to regenerate `ThemeManifest` | editor+ |
| `GET /theme/:themeId/manifest` | Fetch the latest cached `ThemeManifest` | viewer+ |
| `GET /theme/versions/:themeVersionId/model` | Fetch the current `ThemeModel` for a version | viewer+ |
| `GET /theme/:themeId/versions` | List `ThemeVersion` history for a theme | viewer+ |
| `POST /theme/:themeId/versions` | Create a new `ThemeVersion` (branch from a parent) | editor+ |
| `GET /theme/versions/:themeVersionId/diff` | Fetch `Diff` history for a version | viewer+ |
| `POST /theme/versions/:themeVersionId/restore` | Undo to a prior `Diff` or `ThemeSnapshot` point | editor+ |
| `POST /theme/versions/:themeVersionId/snapshot` | Manually trigger a full file-tree `ThemeSnapshot` | editor+ |
| `GET /theme/versions/:themeVersionId/snapshots` | List snapshots for a version | viewer+ |

**Details**

`POST /theme/:themeId/parse`
- Request: `{ force?: boolean }`
- Response: `202 { jobId: themeId, status: "queued" }` — poll `GET /theme/:themeId/manifest`

`GET /theme/:themeId/manifest`
- Request (query): `{ themeVersionId? }`
- Response: `ThemeManifest` (architecture core §1 shape)

`GET /theme/versions/:themeVersionId/model`
- Response: `{ model: ThemeModel, lockVersion }`

`GET /theme/:themeId/versions`
- Response: `[{ id, label, status, createdAt, createdByUserId }]`

`POST /theme/:themeId/versions`
- Request: `{ parentThemeVersionId?, label? }`
- Response: `{ themeVersionId, status: "draft" }`

`GET /theme/versions/:themeVersionId/diff`
- Request (query): `{ sinceOperationId?, diffId? }`
- Response: `Diff[]`

`POST /theme/versions/:themeVersionId/restore`
- Request: `{ lockVersion, toDiffId? , toSnapshotId? }`
- Response: `200 { themeVersionId, lockVersion }` for diff-based undo (fast, in-model); `202 { status: "restoring" }` for snapshot-based restore (rewrites the full file tree)
- Concurrency: requires current `lockVersion`; `409` if stale.

`POST /theme/versions/:themeVersionId/snapshot`
- Response: `202 { snapshotId, status: "creating" }`

`GET /theme/versions/:themeVersionId/snapshots`
- Response: `[{ id, reason, createdAt, sizeBytes }]`

---

## `/ai/*`

Conversation, chat, analysis, planning, execution, clarification, generation.

| Method + path | Purpose | Auth |
|---|---|---|
| `POST /ai/conversations` | Start a new `AIConversation` scoped to a `ThemeVersion` | editor+ |
| `GET /ai/conversations/:id` | Fetch conversation + message history | viewer+ (read only) |
| `POST /ai/conversations/:id/messages` | Send a chat message; streams the AI response | editor+ |
| `POST /ai/conversations/:id/analyze` | Read-only AI analysis of current `ThemeModel`/`ThemeManifest` against a request (capability-gap detection, Principle 2/3) | editor+ |
| `POST /ai/conversations/:id/plan` | Generate an `OperationPlan` for a request | editor+ |
| `POST /ai/plans/:operationPlanId/execute` | Approve and execute an `OperationPlan`'s operations | editor+ |
| `POST /ai/conversations/:id/clarify-answer` | Answer an AI clarifying question, resuming planning | editor+ |
| `POST /ai/conversations/:id/generate-image` | Generate an image asset via AI | editor+ |
| `POST /ai/conversations/:id/generate-copy` | Generate marketing/section copy via AI | editor+ |

**Details**

`POST /ai/conversations`
- Request: `{ themeVersionId, title? }`
- Response: `{ aiConversationId }`

`GET /ai/conversations/:id`
- Response: `{ conversation: AIConversation, messages: AIMessage[], plans: OperationPlan[] }`

`POST /ai/conversations/:id/messages`
- Request: `{ content, attachments?, clientMessageId }` (`clientMessageId` dedupes retried sends)
- Response: `text/event-stream` (`token`, `operation_plan`, `clarification_needed`, `usage`, `done` events); final persisted state fetchable via `GET /ai/conversations/:id`

`POST /ai/conversations/:id/analyze`
- Request: `{ prompt }`
- Response: `{ capabilitiesMatched: string[], gapsFound: string[], summary }` (consumes AI credit, so gated at editor+ rather than viewer+ despite being read-only against the theme)

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

`POST /ai/conversations/:id/generate-image`
- Request: `{ prompt, targetAssetFile?, style?, dimensions? }`
- Response: `202 { generatedAssetId, status: "generating" }` (SSE progress) → `GeneratedAsset`

`POST /ai/conversations/:id/generate-copy`
- Request: `{ prompt, targetSettingId? }`
- Response: `text/event-stream` token stream → `{ text, aiUsageEventId }`

---

## `/editor/*`

Read/write the `ThemeModel` for a version via the same mutation path AI operations use (Principle 7). Every mutating endpoint below requires the caller's last-read `lockVersion` and returns the new one.

The canonical endpoint list (architecture core §6) is `get-model, update-setting, add-section, move-section, update-block, reorder-block, update-global-style, save, preview-token`. Those nine are documented first, using their exact names. A second table lists **supplementary endpoints** needed for full coverage of the `OperationType` set from §3 (e.g. removing a section has no counterpart in the canonical list) — these extend the group, they do not rename anything in it.

### Canonical endpoints

| Method + path | Purpose | Auth |
|---|---|---|
| `GET /editor/versions/:themeVersionId/model` | Fetch the current `ThemeModel` + `lockVersion` for the live editing session | viewer+ |
| `POST /editor/versions/:themeVersionId/update-setting` | Apply `update_setting` — change one section setting | editor+ |
| `POST /editor/versions/:themeVersionId/add-section` | Apply `add_section` | editor+ |
| `POST /editor/versions/:themeVersionId/move-section` | Apply `move_section` | editor+ |
| `POST /editor/versions/:themeVersionId/update-block` | Apply `update_block_setting` | editor+ |
| `POST /editor/versions/:themeVersionId/reorder-block` | Apply `reorder_block` | editor+ |
| `POST /editor/versions/:themeVersionId/update-global-style` | Apply `update_global_style` | editor+ |
| `POST /editor/versions/:themeVersionId/save` | Persist a checkpoint of the current model state | editor+ |
| `POST /editor/versions/:themeVersionId/preview-token` | Issue a short-lived signed preview URL for the unpublished version | viewer+ |

**Details**

`GET /editor/versions/:themeVersionId/model`
- Response: `{ model: ThemeModel, lockVersion }`

`POST /editor/versions/:themeVersionId/update-setting`
- Request: `{ instanceId, settingId, value, lockVersion }`
- Response: `200 { lockVersion, diff: DiffEntry[] }`

`POST /editor/versions/:themeVersionId/add-section`
- Request: `{ templateKey, sectionType, presetName?, position, lockVersion }`
- Response: `200 { instanceId, lockVersion }`

`POST /editor/versions/:themeVersionId/move-section`
- Request: `{ instanceId, toIndex, toTemplateKey?, lockVersion }`
- Response: `200 { lockVersion }`

`POST /editor/versions/:themeVersionId/update-block`
- Request: `{ instanceId, blockInstanceId, settingId, value, lockVersion }`
- Response: `200 { lockVersion, diff: DiffEntry[] }`

`POST /editor/versions/:themeVersionId/reorder-block`
- Request: `{ instanceId, blockInstanceId, toIndex, lockVersion }`
- Response: `200 { lockVersion }`

`POST /editor/versions/:themeVersionId/update-global-style`
- Request: `{ path, value, lockVersion }` (e.g. `path = "colors.accent"`)
- Response: `200 { lockVersion }`

`POST /editor/versions/:themeVersionId/save`
- Purpose: an explicit checkpoint — durably persists the working `ThemeModel` (each individual mutation above is already durable, so `save` primarily matters for clients that batch several optimistic local changes before committing, and for triggering the Theme Serializer to refresh preview-ready draft files).
- Request: `{ lockVersion }`
- Response: `200 { lockVersion, savedAt }`

`POST /editor/versions/:themeVersionId/preview-token`
- Response: `200 { previewUrl, token, expiresAt }`

### Supplementary endpoints (full `OperationType` coverage)

| Method + path | Purpose | Auth |
|---|---|---|
| `POST /editor/versions/:themeVersionId/remove-section` | Apply `remove_section` | editor+ |
| `POST /editor/versions/:themeVersionId/duplicate-section` | Apply `duplicate_section` | editor+ |
| `POST /editor/versions/:themeVersionId/add-block` | Apply `add_block` | editor+ |
| `POST /editor/versions/:themeVersionId/remove-block` | Apply `remove_block` | editor+ |
| `POST /editor/versions/:themeVersionId/update-theme-setting` | Apply `update_theme_setting` | editor+ |
| `POST /editor/versions/:themeVersionId/update-asset` | Apply `update_asset` (manual, non-AI asset swap) | editor+ |

All six follow the same request/response contract as their canonical siblings: a target-identifying payload per `Operation.target`/`payload` shape from architecture core §3, plus `lockVersion` in, `{ lockVersion, diff? }` out. `create_section_file`, `modify_liquid`, `modify_css`, `modify_js` — the four "generative" `OperationType`s — are deliberately **not** exposed as direct `/editor/*` endpoints: per Principle 3, raw-code generation only ever happens through `/ai/*` (plan → execute), never as a manual editor action, since it always requires the validation pipeline (doc 15) and always costs AI credit.
