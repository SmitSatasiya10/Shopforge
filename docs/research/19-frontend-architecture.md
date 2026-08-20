# 19. Frontend Architecture

## 19.1 Purpose and scope

This document describes the application-level structure of the Shopforge frontend: the areas a user navigates between, the detailed layout and behavior of the Visual Editor (the product's core surface), the state a UI must represent while editing a store, and the concrete approach to client-side state management. Unlike earlier drafts of this document, it does commit to a specific stack (§19.2) and a specific state-management approach (§19.5) — the questions that matter here (single source of truth, optimistic mutation, selection-driven AI scoping, how a live preview actually gets produced) have concrete answers in the current architecture, and this document states them rather than leaving them open.

The Visual Editor and the AI Workspace are not two products bolted together. By design — the visual editor and the AI use the same model — both read and write the same client-side representation of the **Store Configuration** — the JSON document of `pages → sections[] → {id, type, settings, blocks}` that is the single source of truth for a generated store (doc 01 §4.1) — through the same write path, and in the Visual Editor they are rendered **side by side in one screen**, not as separate tabs. This is the central design commitment of this document.

The other central commitment, and the one that most distinguishes this document from an ordinary SPA-builds-a-preview architecture: **the live preview is not React rendering the storefront.** It is the same production Liquid — the section library's real `.liquid` templates — rendered through LiquidJS and shown in a same-origin iframe. React owns the application chrome around that iframe and never re-implements what's inside it. §19.2 and §19.4.4 state this explicitly; every other section in this document assumes it.

## 19.2 Technology approach

Shopforge's frontend is a React/Next.js single-page application, paired with a client-side state store for shared application state (Store Configuration, selection, AI conversation, editor status — see §19.5) and a data-fetching/cache layer for server communication (`/editor/*`, `/ai/*`, `/config/*`, `/shopify/*`).

**React/Next.js owns the builder application only — never the storefront render.** Concretely, "the builder application" is the toolbar, the Structure panel / Section Navigator, the Inspector, the AI panel, and the element that hosts the preview: every pixel of editor chrome. It is not the thing that turns a Store Configuration into the HTML a shopper eventually sees. That job belongs entirely to the **LiquidJS Preview Renderer** (doc 09): given the current Store Configuration, it resolves each section instance's `type` to its real Liquid template from the section library, injects that instance's `settings`/`blocks`, renders it with LiquidJS, and produces an HTML string. That string — not a React tree — is what appears in the canvas, loaded into a **same-origin iframe** so the section's own CSS/JS is fully isolated from the editor chrome and never leaks into or conflicts with it. This is the same Liquid template that ships to the merchant's store at publish time (doc 01 §4.2, item 1) — the preview-parity guarantee this architecture is built around depends on React never standing in for it, even approximately.

This has a direct, load-bearing consequence for how state must be organized (§19.5): the client isn't just holding a JSON document and re-rendering a component tree from it the way a typical SPA would. It's holding a JSON document, and separately, it has to produce and cache actual rendered HTML from that document via a real Liquid render pass — and keep the two in sync efficiently as edits land at typing speed.

## 19.3 Application areas (Dashboard)

The Dashboard is the shell around every non-editor screen. Its primary navigation exposes the following areas:

| Area | Purpose |
|---|---|
| **Projects** | The top-level workspace grouping: a Project bundles a Product Import (or store-concept prompt), the Store Configuration(s) generated from it, its AI Workspace conversation history, and Version history into one place a user returns to. A Project is created by starting a **Product Import** — pasting a product URL (AliExpress, Amazon, Alibaba, or an existing Shopify product listing) or describing a store concept via prompt — which is the front door into the product (doc 01 §4.1); it is not gated behind connecting a Shopify store first. This is the "home" a user lands on after login and the unit that appears in cross-org navigation. |
| **Shopify Stores** | Manage the store connections used as **publish targets**: initiate/review OAuth connection, see connection health and scopes granted, and disconnect/reconnect a store. A connected store is required before Publish (§19.4.8), since publishing applies the Store Configuration onto the merchant's installed copy of the Base Theme through the Shopify Admin API — but it is not a prerequisite for starting a Product Import, generating a Store Configuration, or editing in the Visual Editor, all of which can happen before any store is connected. |
| **Store Configurations** | Lists the Store Configuration(s) generated for a Project, shows AI-generation and publish status, and is the entry point into the Visual Editor or AI Workspace for a given Store Configuration. There is no theme-parsing or manifest step here — a Store Configuration always targets the same first-party Base Theme and fixed section library, so there is nothing to parse or discover about an unknown merchant theme. |
| **AI Workspace** | The chat-first entry point: a conversation-oriented view of AI message history for a Store Configuration, usable independently of the Visual Editor for users who prefer describing changes over clicking through a canvas. Selecting "open in editor" from any AI Workspace message drops the user into the Visual Editor with that conversation attached as the AI panel. |
| **Visual Editor** | The canvas + structure + inspector + AI panel workspace described in depth in §19.4. This is where most day-to-day editing happens. |
| **Assets** | Browse/manage uploaded and AI-generated asset records for a Store Configuration: uploaded images/fonts, AI-generated images, usage references (which sections/blocks reference which asset), replace/delete actions. |
| **Versions** | Store Configuration version history, `Diff` timeline, and restore points. Supports reviewing what changed between two versions and rolling back (everything is reversible by design). |
| **AI Usage** | Credit ledger: consumption by conversation/operation, running balance, cost breakdown by operation type, and links into plan/subscription/credit-balance management. |
| **Settings** | Organization, membership/role management, API/integration settings, notification preferences, billing. |

Navigation between these areas is persistent (a left rail or equivalent), while the Visual Editor itself claims the full viewport when opened, since it is a dense, focus-mode workspace.

## 19.4 The Visual Editor

### 19.4.1 Layout overview

The Visual Editor is a four-region layout plus a top toolbar:

```
┌───────────────────────────────────────────────────────────────────┐
│ Toolbar: project/version • undo/redo • device switcher • preview • │
│          save status • publish                                     │
├───────────┬───────────────────────────────────┬─────────┬─────────┤
│ Structure │                                     │ Inspec- │   AI    │
│ (Section  │           Canvas                    │  tor    │ Panel   │
│ Navigator)│      (preview iframe)               │ panel   │(chat +  │
│           │                                     │         │ plan)   │
│           │                                     │         │         │
└───────────┴───────────────────────────────────┴─────────┴─────────┘
```

The Structure panel and AI panel are both collapsible (a user doing pure AI-driven editing can hide Structure; a user doing pure point-and-click editing can hide the AI panel), but neither is ever destroyed — collapsing preserves scroll position, conversation state, and selection so re-opening is instant. The Inspector panel appears/disappears based on whether something is selected; with nothing selected it shows Global Settings controls instead of being empty.

### 19.4.2 Toolbar

Left-to-right: project name + Store Configuration version label (with a version switcher), undo/redo buttons (see §19.5), a save-status indicator (see §19.5), a device switcher (desktop / tablet / mobile — drives both the canvas viewport and the `visibility` flags surfaced in the Inspector), a preview-mode toggle (see §19.4.8), and a publish action gated by org role, a connected Shopify Store (§19.3), and outstanding unsaved/unvalidated changes.

### 19.4.3 Structure (Section Navigator) panel

Renders the current page's section list as a tree, driven directly off the client's in-memory Store Configuration (§19.5):

- Top level: the active page (`pageId`, e.g. `index`, `product`, `collection`, `cart`), with the shared `layout.header`/`layout.footer` section lists shown as pinned nodes above/below the page body.
- Each node under the page body is a section instance, labeled by its Section Definition's human name (resolved from `type`) — not by its raw file name — with a secondary label showing custom section naming if the user has set one.
- Each section instance expands to its `blocks` array, in order.
- This panel is where every **structural** operation is triggered: add, remove, duplicate, and reorder are all issued from here (drag-and-drop reordering within the tree issues a position write to the relevant `sections[]` array), never from the canvas directly (doc 06 §06.3.1–§06.3.4) — those are changes to a page's section *list*, not in-place edits of something currently rendered, so they belong to the panel that shows and manipulates that list.
- Per-node affordances: visibility toggle (writes `visibility.{desktop,tablet,mobile}`), disable toggle (`disabled`), duplicate, delete, and an "ask AI about this" shortcut that opens the AI panel pre-scoped to that node (see §19.4.6).
- Sections/blocks currently disabled or hidden for the active device render dimmed, matching their canvas state.

### 19.4.4 Canvas (preview iframe)

**The canvas is a same-origin iframe showing the current Store Configuration rendered by the LiquidJS Preview Renderer (doc 09) — it is not a React-rendered recreation of the storefront.** Concretely, on load and after every Store Configuration write, the client (or the render pipeline doc 09 defines, whichever side actually executes LiquidJS — see the open note in §19.5) resolves the affected section(s) to their real Liquid template, renders the current settings/blocks into HTML, and writes that HTML into the iframe's document. What's on screen is, byte for byte, the same template that will render on the published storefront.

**What React does around it:**

- **Viewport / responsive-size controls.** The device switcher (§19.4.2) resizes the iframe element itself (its `width`/height constraints), not anything inside it — the section templates respond to the resulting viewport the same way they would for a real visitor at that width.
- **Loading states.** While an initial or large-scope LiquidJS render is in flight (page load, a page switch, or a global-scope write per doc 06 §06.4 that touches most sections on the page), React shows a skeleton/placeholder over the canvas region. A single-section rerender (the common case — most edits are scoped to one section) is fast enough that no loading state is shown; the affected fragment simply swaps.
- **Selection and hover outlines are drawn by React, on top of the iframe — not injected into the iframe's own DOM.** This is a deliberate choice: the iframe's content is the real production Liquid render, and keeping editor-only chrome (outlines, resize handles, badges) entirely out of that DOM means what's inside the iframe stays exactly what ships to production, with zero risk of an editor-only artifact leaking into a published page. Mechanically, React reads the on-screen bounding box of the DOM element doc 09's click-to-select mapping resolved for the current selection/hover target (via `getBoundingClientRect` on the iframe's content, translated into the parent document's coordinate space) and positions an absolutely-positioned overlay `<div>` over it. The same technique draws the drag-handles some sections expose for direct spacing adjustment (doc 06 §06.3.8) and the AI-concurrency "locked" indicator (doc 06 §06.5.2). This overlay layer is resynced on scroll, resize, and every rerender.
- **`contentEditable` toggling happens inside the iframe's own DOM**, unlike the overlay chrome above — it has to, since it's a real DOM/browser text-editing feature applied to the actual rendered text node. Doc 09 owns exactly how a click resolves to "make this specific element editable"; React's job is limited to reacting to the resulting commit (reading the value back out and issuing the Store Configuration write, per doc 06 §06.3.5).
- **Diff preview during an in-flight AI operation** (§19.4.7) renders the *proposed* Store Configuration through the same LiquidJS Preview Renderer, scoped to just the affected section(s) — it is a second, not-yet-committed render pass through the identical pipeline, not a separate diffing UI. The proposed HTML either swaps into the iframe behind a "before/after" toggle the user can flip, or is shown as a ghost overlay (again React-drawn, positioned the same way as selection outlines) alongside the current render, depending on how localized the change is.

Hover outlines the section/block boundary before click; clicking any rendered section/block resolves through doc 09's DOM-to-path mapping and sets the cross-cutting **selection state** (`selectedSectionId`, optional `selectedBlockId` — see §19.5) that the Structure panel highlights, the Inspector reads to decide what to render, and the AI panel reads to decide scope (§19.4.6). Sections hidden for the active device are excluded from the render entirely for that viewport (not just dimmed), matching what a real visitor on that device would see.

### 19.4.5 Inspector panel

Shows editable controls for whatever is selected, per doc 06's operation catalog:

- **Section selected**: renders one input per setting the section's own Section Definition schema declares, bound to that section instance's `settings`, plus block management (add/remove/reorder shortcuts mirroring the Structure panel) and the visibility/disabled toggles.
- **Block selected**: renders one input per setting the block's declared type exposes, bound to that specific block instance's `settings`.
- **Nothing selected**: falls back to Global Settings — `globalStyles` (colors, typography, buttons, spacing) and raw `themeSettings` — so the panel is never idle (doc 06 §06.4).
- Every field edit here is a Store Configuration write at a specific path (doc 06 §06.2–§06.3), applied optimistically to the client-held state (§19.5) and, on commit, triggering a LiquidJS rerender scoped to the affected section (or, for a Global Settings edit, every section on the page that doesn't override the changed token). The Inspector is, architecturally, just another *trigger* for the same write path the AI planner and the canvas's `contentEditable` fields also use — never a private one.

### 19.4.6 AI conversation panel and selection-driven scoping

The AI panel is a persistent chat surface docked alongside the editor, not a modal that suspends editing. It shows AI message history for the current conversation, a composer, and — critically — a **scope indicator** driven by canvas/Structure-panel selection.

Concretely: when a user clicks the hero section in the canvas, `selectedSectionId` is set to that section instance's `id` (resolved via doc 09's click-to-select mapping). The AI panel's composer shows a small scope chip (e.g. "Scoped to: Hero banner") reflecting this. If the user then types "make this bolder" and sends it, the client attaches the current `selectedSectionId` (and `selectedBlockId` if a block was selected) to the outgoing AI request as scoping context. The Operation Planner (doc 11) uses this to resolve "this" and to constrain candidate operations to the selected section's Store Configuration path rather than searching the whole page — the same mechanism that lets a typed request like "make the CTA button larger" resolve unambiguously to one block among many of the same type across the page.

Scope is sticky but overridable: it persists across turns in a conversation until the user selects something else, explicitly clears scope ("apply to whole page"), or the AI's own plan targets a different/broader part of the Store Configuration (e.g. a request that touches `globalStyles`), at which point the chip updates to reflect the plan's actual target rather than the stale selection. Selection can also originate from the AI panel: clicking an operation or target reference inside a plan step highlights and selects that section/block on the canvas, so scoping is bidirectional between canvas and chat.

### 19.4.7 In-flight AI operations: plan, progress, diff preview

An AI request that results in more than a trivial single-field change surfaces its full lifecycle in the AI panel rather than silently mutating the Store Configuration (AI plans before complex execution, by design):

1. **Composing** — user is typing; no request outstanding.
2. **Analyzing/streaming plan** — the panel shows a streaming, incrementally-rendered natural-language rationale as the Operation Plan (doc 11) is generated, followed by the ordered list of proposed operations as they resolve, each labeled with its risk level (safe / review / destructive) and the Store Configuration path it targets.
3. **Plan review** — once the plan is complete, each operation is shown with a human-readable summary and, where applicable, the canvas-level diff preview described in §19.4.4 (the affected section renders its proposed post-operation state, toggleable against or overlaid on its current state) so the user is reviewing the actual rendered effect, not JSON. Operations flagged `review` or `destructive` require explicit confirmation before execution; `safe` structural operations may be batched under a single "Apply all" unless the user has opted into per-step confirmation. Because Sections are never AI-generated (doc 06 §06.3.1), no plan step here ever proposes new Liquid — every step resolves to a write against an existing Section instance, a new instance of an existing Section Definition, or a `globalStyles`/`themeSettings` token.
4. **Executing** — a per-operation progress indicator (queued / applying / applied / failed) runs down the operation list as the Executor applies them; the canvas updates section-by-section as each operation lands and its LiquidJS rerender completes, rather than only after the whole plan completes, so long plans feel incremental.
5. **Completed** — a summary card ("4 changes applied") with a single "Undo this change" action that reverts the whole plan as one unit (backed by the `Diff` produced for the plan, doc 14) in addition to normal step-level undo/redo.
6. **Blocked/error** — if planning fails, a proposed operation fails validation (doc 15), or execution errors partway through, the panel shows what happened, which operations (if any) already applied, and offers retry/rollback; partially-applied plans never leave the Store Configuration in an ambiguous state because each applied operation already produced its own reversible `Diff` entry.

### 19.4.8 Editor states

The editor as a whole (independent of any one AI operation) exposes these explicit states, each with a distinct toolbar/indicator treatment — doc 06 §06.5 goes one layer deeper on triggers and on the AI-concurrency interaction specifically:

| State | Trigger | UI treatment |
|---|---|---|
| **Loading** | Initial Store Configuration fetch, or switching version | Skeleton/placeholder canvas + panels; toolbar actions disabled. |
| **Saving (autosave)** | Debounced background save after a local write (editor field edit or applied AI operation) with no explicit user save action | Small unobtrusive "Saving…" indicator near the version label; does not block interaction. |
| **Saving (explicit)** | User-initiated "Save" action, typically before publish or when leaving the editor | Toolbar save button shows a spinner state; publish is blocked until it resolves. |
| **Saved** | Save round-trip confirmed by server | "Saved" indicator with a timestamp; reverts to neutral after a few seconds. |
| **Unsaved changes** | Local Store Configuration write exists that hasn't been persisted (debounce window still pending, or save failed) | Dot/asterisk indicator on the version label; navigating away from the editor prompts confirmation. |
| **Error** | Save failure, Store Configuration fetch failure, or a write rejected by the validation pipeline (doc 15) | Inline error banner scoped to the affected panel (canvas overlay for render/apply errors, AI panel message for plan/execute errors, toolbar banner for save/network errors) with retry. |
| **Undo/redo available** | Local undo/redo stack non-empty in the relevant direction | Toolbar buttons enabled/disabled to match stack state; hovering shows what the next undo/redo would affect. |
| **Preview mode** | User toggles "Preview" | Structure, Inspector, and AI panels collapse; canvas expands to full width and hides selection/hover affordances — because the canvas is already the real LiquidJS render (§19.4.4), this state requires no separate "visitor view" render, only hiding editor chrome. |
| **Device switcher** | User selects desktop / tablet / mobile | Canvas viewport resizes; `visibility` per-device flags become the active filter for what's rendered and for which settings the Inspector marks as "hidden on this device." |

Saving and AI-operation execution are independent state machines that can be simultaneously visible — e.g. "Saving…" in the toolbar while the AI panel shows "Executing plan (2/4)" — since a save can be triggered by the AI operation's own applied writes.

## 19.5 State management approach

The Visual Editor's client state now has three genuinely distinct categories, where earlier drafts of this document only needed two. Conflating them is the single easiest mistake to make in this architecture, so this section is explicit about the boundary between them and gives a concrete recommendation for each.

**(a) Store Configuration — the source of truth.** The JSON document fetched from `/config/*`, held in a normalized client-side store keyed the way the document itself is keyed (by page id, then section `id`, then block `id`). Every panel — Structure, Canvas, Inspector, AI — reads from this one store rather than holding independent copies of section/block data. This is unchanged in spirit from earlier drafts of this document; what's new is that this store is no longer the only thing standing between a write and what the user sees on screen (see (b)).

**(b) Derived, rendered HTML per section — memoized, not recomputed wholesale.** Because the canvas is LiquidJS output, not a React tree, a Store Configuration write doesn't directly produce new pixels the way a state update in an ordinary React app would — it has to go through a render pass first. Re-running that render pass for the *entire page* on every keystroke (e.g. while a user is actively typing in a `contentEditable` field, or dragging a spacing slider) would be wasteful and would risk visible flicker across sections that didn't change. The recommended design memoizes rendered HTML **per section instance**, keyed by a content fingerprint of that instance's own `{type, settings, blocks}` — not by the whole Store Configuration:

- A section-scoped write (the large majority of edits — see doc 06's per-operation "Preview update" notes) changes exactly one instance's fingerprint, invalidating exactly that one cache entry; every other section's cached HTML is untouched and is not rerendered.
- A `globalStyles`/`themeSettings` write invalidates every section on the current page that doesn't declare its own override for the changed token, consistent with doc 06 §06.4's stated blast radius — this is deliberately a broader invalidation, but it's still scoped to "sections that could plausibly be affected," never the whole app.
- Reordering a section (doc 06 §06.3.4) invalidates nothing — no section's fingerprint changes, only its position in the array — so the canvas only needs to reposition an already-rendered fragment, not rerender anything.

**Open question this document flags rather than resolves: where the LiquidJS render actually executes.** Running it client-side (in the main thread, or a dedicated Web Worker for larger pages to avoid janking the UI thread) gives the fastest feedback loop and matches the "instant" feel `contentEditable` editing depends on, at the cost of shipping every section's Liquid template and a Liquid engine to the browser. Running it server-side, with the client requesting a rerendered fragment per affected section after each write, is simpler to keep in lockstep with the actual production render environment but adds a network round trip to every non-text edit. This document assumes the memoization strategy above holds regardless of which side executes the render — only the latency profile changes — but doc 09 is the authoritative source for this decision, since it owns the render pipeline itself; this document does not decide it.

**(c) Editor UI state — explicitly not part of the Store Configuration.** Selection (`selectedSectionId`, `selectedBlockId`), device-switcher state, preview-mode, panel collapse state, and AI conversation/plan state are ephemeral, per-session concerns, not store content — but they're readable by every panel so that selection and scoping stay consistent across Structure, Canvas, Inspector, and the AI panel (§19.4.6).

### 19.5.1 Recommended implementation

- **Store Configuration + editor UI state + the per-section render cache: a single Zustand store, with the Immer middleware.** Given the nesting depth of `pages → sections[] → blocks[] → settings`, Immer's draft-mutation ergonomics matter more here than they would for a flatter shape — writing `state.pages[pageId].sections[i].settings[key] = value` directly, with Immer producing the immutable update underneath, keeps every mutation call site (Inspector field commit, `contentEditable` read-back, applied AI operation) simple and uniform, which matters because doc 06 is explicit that all three must funnel through the identical write path. Zustand specifically (over Redux Toolkit or plain Context) because the editor doesn't need Redux's middleware ecosystem or time-travel devtools to get this right, and Context re-render characteristics are a poor fit for a store this large and this frequently written to (a Context-based store re-renders every consumer on every keystroke unless heavily hand-optimized with `useMemo`/`useSelector`-style patterns that Zustand gives for free via selector subscriptions). The per-section render cache lives as a `Map<sectionId, {fingerprint, html}>` slice in the same store, updated by the same selector-driven subscription model, so a section's canvas fragment only re-subscribes and re-renders when its own cache entry actually changes.
- **Server communication: a thin optimistic-write layer for Store Configuration mutations, plus a conventional fetch/cache library for everything read-only.** Store Configuration writes follow the mutation flow below — this is bespoke, not generic REST CRUD, because of the optimistic-apply-then-reconcile requirement doc 06 §06.5.1 depends on for its Saving/Saved/Error states. Read-only server data that doesn't participate in that flow — the Assets library, Version history, AI Usage records — is a good fit for a standard fetch/cache library (e.g. TanStack Query) rather than reinventing caching, staleness, and refetch-on-focus behavior for data that isn't part of the live-editing loop.

Mutation flow, regardless of origin (Inspector field edit, `contentEditable` commit, Structure panel drag-and-drop, or an AI operation applying):

1. The write is expressed as an operation against the client-held Store Configuration (a specific path + new value, per doc 06 §06.2–§06.3).
2. The client applies it **optimistically** to the Zustand store immediately — this both updates the source-of-truth slice and invalidates the affected section(s)' render-cache entries, which triggers the section's canvas fragment to rerender against the new value without waiting on the network. This is what makes drag/drop, slider drags, and field editing feel instant, and it's the same mechanism whether the render itself executes client-side or is requested from the server (per the open question above) — only the latency before the cache entry updates differs.
3. The same operation is sent to the corresponding `/editor/*` endpoint (or, for AI-originated changes, arrives via the plan-execution endpoint, which applies a whole Operation Plan server-side and returns the resulting Store Configuration delta).
4. The server is authoritative: it validates the operation (doc 15), applies it to the persisted Store Configuration, produces a `Diff` (doc 14), and returns confirmation (or rejection with a reason).
5. On confirmation, the optimistic local state is reconciled — normally a no-op, since the optimistic update already matches; on rejection, the local store rolls back the specific optimistic write (not the whole Store Configuration) and surfaces an error scoped to the affected panel, invalidating just that section's render cache entry back to its pre-write state.
6. Debounced autosave batches rapid-fire writes (e.g. dragging a slider, or a burst of keystrokes in a `contentEditable` field) into a single persisted save rather than round-tripping on every intermediate value; explicit save flushes immediately. Note that this debounce governs *persistence* only — the optimistic local render (step 2) already reflects every intermediate value the instant it's made, independent of when the batched save fires.

Because both the Visual Editor and the standalone AI Workspace (§19.3) mutate the same server-side Store Configuration, a user editing in one and switching to the other never sees stale state: opening the Visual Editor after making changes via AI Workspace chat re-fetches (or receives a pushed update to) the current Store Configuration rather than assuming its own cache is current.

## 19.6 Cross-references

- Doc 01 §4.1–§4.2 states the pivot this document assumes throughout: the fixed section library, the Store Configuration as the AI/editor/preview source of truth, and the LiquidJS Preview Renderer's preview-parity guarantee.
- Doc 09 (Preview Rendering & Interaction Architecture) defines the LiquidJS Preview Renderer, the same-origin preview iframe, and the click-to-select/`contentEditable` DOM-to-Store-Configuration mapping this document's canvas (§19.4.4) is built on — including, as the authoritative source, whether the render pipeline executes client- or server-side (§19.5).
- Doc 06 (Editor spec) covers the full catalog of editing operations — every Store Configuration path a control in this document's panels can write, and which trigger (canvas direct-manipulation vs. panel control) each one uses — in functional depth beyond this document's layout/state focus.
- Doc 11 (Operation Planner) defines how an Operation Plan is generated against the existing section library, referenced in §19.4.6 and §19.4.7.
- Doc 14 (Diff/Versioning) defines the `Diff` schema and undo/redo/snapshot semantics referenced in §19.4.7 and §19.4.8.
- Doc 15 (Validation) defines the pipeline that can reject a write, surfaced as the Error state in §19.4.8.
- Doc 20 (Security) covers authorization for editor/publish actions and safe handling of AI-generated content before it reaches the canvas.
