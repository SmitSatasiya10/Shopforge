# 19. Frontend Architecture

## 19.1 Purpose and scope

This document describes the application-level structure of the Shopforge frontend: the areas a user navigates between, the detailed layout and behavior of the Visual Editor (the product's core surface), the state a UI must represent while editing a theme, and the conceptual approach to client-side state management. It does not prescribe a specific framework brand — see §19.2 — because the architectural questions that matter (single source of truth, optimistic mutation, selection-driven AI scoping, reconciliation) are framework-independent and must hold regardless of implementation choice.

The Visual Editor and the AI Workspace are not two products bolted together. Per Design Principle 7 ("Visual editor and AI use the same model"), both read and write the same client-side representation of the `ThemeModel` (architecture core §2) through the same mutation path, and in the Visual Editor they are rendered **side by side in one screen**, not as separate tabs — this is the central design commitment of this document.

## 19.2 Technology approach

Shopforge's frontend is a component-based single-page application (SPA) built with a modern reactive UI framework (e.g. React or an equivalent component/hooks-based framework), paired with a client-side state store for shared application state (theme model, selection, AI conversation, editor status) and a data-fetching/cache layer for server communication (`/editor/*`, `/ai/*`, `/theme/*`, `/shopify/*`). The live preview surface (the canvas) renders through an isolated iframe/sandboxed rendering context so that theme CSS/JS never leaks into or conflicts with the editor chrome. Beyond these constraints, the specific framework is an implementation detail left to the engineering team; nothing in this document depends on it.

## 19.3 Application areas (Dashboard)

The Dashboard is the shell around every non-editor screen. Its primary navigation exposes the following areas:

| Area | Purpose |
|---|---|
| **Projects** | The top-level workspace grouping: a Project bundles one Shopify Store connection, the Theme(s) being worked on, its AI Workspace conversation history, and Version history into one place a user returns to. This is the "home" a user lands on after login and the unit that appears in cross-org navigation. |
| **Shopify Stores** | Manage store connections: initiate/review OAuth connection (see doc 20 §20.2), see connection health, scopes granted, and disconnect/reconnect a store. |
| **Themes** | Lists themes imported from a connected store (per Shopify `shopifyRole`: main, unpublished, development, demo), shows parse/manifest status, and is the entry point into the Visual Editor or AI Workspace for a given `Theme`/`ThemeVersion`. |
| **AI Workspace** | The chat-first entry point: a conversation-oriented view of `AIConversation`/`AIMessage` history for a theme, usable independently of the Visual Editor for users who prefer describing changes over clicking through a canvas. Selecting "open in editor" from any AI Workspace message drops the user into the Visual Editor with that conversation attached as the AI panel. |
| **Visual Editor** | The canvas + structure + inspector + AI panel workspace described in depth in §19.4. This is where most day-to-day editing happens. |
| **Assets** | Browse/manage `Asset` and `GeneratedAsset` records for a theme: uploaded images/fonts, AI-generated images, usage references (which sections/blocks reference which asset), replace/delete actions. |
| **Versions** | `ThemeVersion` history, `Diff` timeline, `ThemeSnapshot` restore points, and `PublishHistory`. Supports reviewing what changed between two versions and rolling back (Design Principle 6: everything is reversible). |
| **AI Usage** | `AIUsageEvent` credit ledger: consumption by conversation/operation, running balance, cost breakdown by operation type (structural ops are ≈0 cost; generative ops consume credits — architecture core §3), and links into `Plan`/`Subscription`/`CreditBalance`. |
| **Settings** | Organization, membership/role management (ties to org roles — see doc 20 §20.4), API/integration settings, notification preferences, billing. |

Navigation between these areas is persistent (a left rail or equivalent), while the Visual Editor itself claims the full viewport when opened, since it is a dense, focus-mode workspace.

## 19.4 The Visual Editor

### 19.4.1 Layout overview

The Visual Editor is a four-region layout plus a top toolbar:

```
┌───────────────────────────────────────────────────────────────────┐
│ Toolbar: theme/version • undo/redo • device switcher • preview •   │
│          save status • publish                                     │
├───────────┬───────────────────────────────────┬─────────┬─────────┤
│ Structure │                                     │ Inspec- │   AI    │
│  (Layers) │           Canvas                    │  tor    │ Panel   │
│  panel    │       (live preview)                │ panel   │(chat +  │
│           │                                     │         │ plan)   │
│           │                                     │         │         │
└───────────┴───────────────────────────────────┴─────────┴─────────┘
```

The Structure panel and AI panel are both collapsible (a user doing pure AI-driven editing can hide Structure; a user doing pure point-and-click editing can hide the AI panel), but neither is ever destroyed — collapsing preserves scroll position, conversation state, and selection so re-opening is instant. The Inspector panel appears/disappears based on whether something is selected; with nothing selected it shows theme-level (global styles / theme settings) controls instead of being empty.

### 19.4.2 Toolbar

Left-to-right: theme name + `ThemeVersion` label (with a version switcher), undo/redo buttons (see §19.5), a save-status indicator (see §19.5), a device switcher (desktop / tablet / mobile — drives both the canvas viewport and the `visibility` flags surfaced in the inspector), a preview-mode toggle (see §19.5), and a publish action gated by org role and by outstanding unsaved/unvalidated changes.

### 19.4.3 Structure (Layers) panel

Renders the current `TemplateNode` as a tree, driven directly off the client's in-memory `ThemeModel`:

- Top level: the active template (`templateKey`, e.g. `product`, `index`, `collection.summer-sale`), with header/footer `sectionGroups` shown as pinned nodes above/below the template body.
- Each node under the template body is a `SectionInstance`, labeled by its section's human name (from the Manifest's `schemaName`, resolved via `sectionType`) — not by its raw file name — with a secondary label showing custom section naming if the user has set one.
- Each `SectionInstance` expands to its `blocks` array (`blockInstanceId`/`blockType`), in order.
- Drag-and-drop reordering within the tree issues `move_section` / `reorder_block` operations (architecture core §3) through the same mutation path as any other edit — the tree is a view onto the model, not an independent source of truth for order.
- Per-node affordances: visibility toggle (writes `visibility.{desktop,tablet,mobile}`), disable toggle (`disabled`), duplicate, delete, and an "ask AI about this" shortcut that opens the AI panel pre-scoped to that node (see §19.4.6).
- Sections/blocks currently disabled or hidden for the active device render dimmed, matching their canvas state.

### 19.4.4 Canvas (live preview)

The canvas renders the theme through the same rendering path a real storefront would use, scoped to the current `ThemeVersion` working copy and device viewport. It is not merely a screenshot — it is interactive:

- Clicking any rendered section/block selects it: this sets a single piece of cross-cutting **selection state** (`selectedInstanceId`, optional `selectedBlockInstanceId`) that the Structure panel highlights, the Inspector panel reads to decide what to render, and the AI panel reads to decide scope (§19.4.6).
- Hover outlines the section/block boundary before click, so users can see structure without leaving the canvas.
- The device switcher in the toolbar controls canvas viewport width and which `visibility` flag governs what's shown; sections hidden for the active device are visibly excluded (not just dimmed), matching what a real visitor on that device would see.
- While an AI operation is executing, the canvas is the surface that shows the diff preview (§19.4.7) — either as an inline before/after overlay on the affected section, or a split view, depending on how localized the change is.

### 19.4.5 Inspector panel

Shows editable controls for whatever is selected:

- **Section selected**: renders one input per `SettingDef` in that section's schema (from the Manifest), bound to `SectionInstance.settings`, plus block management (add/remove/reorder shortcuts mirroring the Structure panel) and the visibility/disabled toggles.
- **Block selected**: renders one input per `SettingDef` in that block type's schema, bound to the specific `blockInstanceId`'s `settings`.
- **Nothing selected**: falls back to `GlobalStyles` (colors, typography, buttons, spacing) and raw `themeSettings`, so the panel is never idle.
- Every field edit here is an `update_setting` / `update_block_setting` / `update_global_style` operation — the identical operation types the AI planner emits — applied through the same client-side mutation function (Design Principle 7). The Inspector is, architecturally, just another operation source.

### 19.4.6 AI conversation panel and selection-driven scoping

The AI panel is a persistent chat surface docked alongside the editor, not a modal that suspends editing. It shows `AIMessage` history for the current `AIConversation`, a composer, and — critically — a **scope indicator** driven by canvas/Structure-panel selection.

Concretely: when a user clicks the hero section in the canvas, `selectedInstanceId` is set to that section's `instanceId`. The AI panel's composer shows a small scope chip (e.g. "Scoped to: Hero banner") reflecting this. If the user then types "make this bolder" and sends it, the client attaches the current `selectedInstanceId` (and `selectedBlockInstanceId` if a block was selected) to the outgoing `/ai/message` request as scoping context. The Operation Planner (doc 11) uses this to resolve "this" and to constrain candidate operations' `target.instanceId` to the selected section rather than searching the whole template — the same mechanism that lets a typed request like "make the CTA button larger" resolve unambiguously to one block among many of the same type across the page.

Scope is sticky but overridable: it persists across turns in a conversation until the user selects something else, explicitly clears scope ("apply to whole page"), or the AI's own plan targets a different/broader part of the model (e.g. a request that touches `GlobalStyles`), at which point the chip updates to reflect the plan's actual target rather than the stale selection. Selection can also originate from the AI panel: clicking an operation or target reference inside a plan step highlights and selects that section/block on the canvas, so scoping is bidirectional between canvas and chat.

### 19.4.7 In-flight AI operations: plan, progress, diff preview

An AI request that results in more than a trivial single-field change surfaces its full lifecycle in the AI panel rather than silently mutating the model (Design Principle 5: AI plans before complex execution):

1. **Composing** — user is typing; no request outstanding.
2. **Analyzing/streaming plan** — the panel shows a streaming, incrementally-rendered natural-language rationale as the Operation Plan (architecture core §3) is generated, followed by the ordered list of proposed `Operation`s as they resolve, each labeled with its `riskLevel` (safe / review / destructive).
3. **Plan review** — once the plan is complete, each operation is shown with a human-readable summary (mirroring `Diff.entries[].humanSummary`) and, where applicable, an inline before/after diff preview rendered directly on the canvas (the affected section highlights and shows a ghost/overlay of its prior state alongside the proposed new state) so the user is reviewing the visual effect, not JSON. Operations flagged `review` or `destructive`, or any operation with `requiresNewCode: true`, require explicit confirmation before execution; `safe` structural operations may be batched under a single "Apply all" unless the user has opted into per-step confirmation.
4. **Executing** — a per-operation progress indicator (queued / applying / applied / failed) runs down the operation list as the Executor applies them; the canvas updates section-by-section as each operation lands, rather than only after the whole plan completes, so long plans feel incremental.
5. **Completed** — a summary card ("4 changes applied") with a single "Undo this change" action that reverts the whole plan as one unit (backed by the `Diff` produced for the plan) in addition to normal step-level undo/redo.
6. **Blocked/error** — if planning fails, a proposed operation fails validation (doc 15), or execution errors partway through, the panel shows what happened, which operations (if any) already applied, and offers retry/rollback; partially-applied plans never leave the model in an ambiguous state because each applied operation already produced its own reversible `Diff` entry.

### 19.4.8 Editor states

The editor as a whole (independent of any one AI operation) exposes these explicit states, each with a distinct toolbar/indicator treatment:

| State | Trigger | UI treatment |
|---|---|---|
| **Loading** | Initial `/editor/get-model` fetch, or switching `ThemeVersion` | Skeleton/placeholder canvas + panels; toolbar actions disabled. |
| **Saving (autosave)** | Debounced background save after a local mutation (editor field edit or applied AI operation) with no explicit user save action | Small unobtrusive "Saving…" indicator near the version label; does not block interaction. |
| **Saving (explicit)** | User-initiated "Save" action, typically before publish or when leaving the editor | Toolbar save button shows a spinner state; publish is blocked until it resolves. |
| **Saved** | Save round-trip confirmed by server | "Saved" indicator with a timestamp; reverts to neutral after a few seconds. |
| **Unsaved changes** | Local `ThemeModel` mutation exists that hasn't been persisted (debounce window still pending, or save failed) | Dot/asterisk indicator on the version label; navigating away from the editor prompts confirmation. |
| **Error** | Save failure, model fetch failure, or an operation rejected by the validation pipeline (doc 15) | Inline error banner scoped to the affected panel (canvas overlay for render/apply errors, AI panel message for plan/execute errors, toolbar banner for save/network errors) with retry. |
| **Undo/redo available** | Local undo/redo stack non-empty in the relevant direction | Toolbar buttons enabled/disabled to match stack state; hovering shows what the next undo/redo would affect (draws from `Diff.entries[].humanSummary`). |
| **Preview mode** | User toggles "Preview" | Structure, Inspector, and AI panels collapse; canvas expands to full width and hides selection/hover affordances, rendering exactly what a storefront visitor would see for the current device. |
| **Device switcher** | User selects desktop / tablet / mobile | Canvas viewport resizes; `visibility` per-device flags become the active filter for what's rendered and for which settings the Inspector marks as "hidden on this device." |

Saving and AI-operation execution are independent state machines that can be simultaneously visible — e.g. "Saving…" in the toolbar while the AI panel shows "Executing plan (2/4)" — since a save can be triggered by the AI operation's own applied mutations.

## 19.5 State management approach

The Visual Editor's client state is organized around one conceptual principle: **the `ThemeModel` fetched from `/editor/get-model` is the single source of truth**, held in a normalized client-side store keyed the same way the model itself is keyed (by `instanceId` for sections, `blockInstanceId` within them, template key for templates). Every panel — Structure, Canvas, Inspector, AI — reads from this one store rather than holding independent copies of section/block data.

Mutation flow, regardless of origin (Inspector field edit, drag-and-drop in Structure panel, or an AI operation applying):

1. The mutation is expressed as an `Operation` (architecture core §3) against the client-held model.
2. The client applies it **optimistically** to the local store immediately — the canvas and inspector update without waiting on the network, which is what makes drag/drop and field editing feel instant.
3. The same operation is sent to the corresponding `/editor/*` endpoint (or, for AI-originated changes, arrives via `/ai/execute-plan`, which applies a whole `Operation Plan` server-side and returns the resulting model delta).
4. The server is authoritative: it validates the operation, applies it to the persisted `ThemeModel`, produces a `Diff`, and returns confirmation (or rejection with a reason).
5. On confirmation, the optimistic local state is reconciled — normally a no-op, since the optimistic update already matches; on rejection, the local store rolls back the specific optimistic change (not the whole model) and surfaces an error scoped to the affected panel.
6. Debounced autosave batches rapid-fire mutations (e.g. dragging a slider) into a single persisted save rather than round-tripping on every intermediate value; explicit save flushes immediately.

Selection state (`selectedInstanceId`, `selectedBlockInstanceId`), device-switcher state, preview-mode, and AI conversation/plan state are treated as separate, cross-cutting client state — not part of the `ThemeModel` itself — because they are ephemeral, per-session UI concerns rather than theme content, but they are readable by every panel so that selection and scoping stay consistent across Structure, Canvas, Inspector, and the AI panel as described in §19.4.6.

Because both the Visual Editor and the standalone AI Workspace (§19.3) mutate the same server-side `ThemeModel` for a given `ThemeVersion`, a user editing in one and switching to the other never sees stale state: opening the Visual Editor after making changes via AI Workspace chat re-fetches (or receives a pushed update to) the current model rather than assuming its own cache is current.

## 19.6 Cross-references

- Architecture core §2 (`ThemeModel`) and §3 (`Operation` schema) define the data this document's UI surfaces operate on.
- Architecture core §6 lists the `/editor/*` and `/ai/*` endpoint groups this document assumes; doc 18 defines their full request/response contracts.
- Doc 06 (Editor spec) covers editor behavior in additional functional depth beyond this document's layout/state focus.
- Doc 11 (Operation Planner) defines how an Operation Plan is generated, referenced in §19.4.7.
- Doc 14 (Diff/Versioning) defines the `Diff` schema and undo/redo/snapshot semantics referenced in §19.4.7 and §19.4.8.
- Doc 15 (Validation) defines the pipeline that can reject an operation, surfaced as the Error state in §19.4.8.
- Doc 20 (Security) covers authorization for editor/publish actions and safe handling of AI-generated content before it reaches the canvas.
