# 12 — AI Context and Token Optimization

## 1. Purpose

The AI never receives the whole theme. A real Shopify theme's Liquid/JSON/CSS/JS can easily total hundreds of KB to a few MB across all sections, snippets, templates, and locale files. Sending that on every turn would be slow, expensive, and would blow past any practical context window — and it would also work directly against **Principle 9 (cost-aware AI)**.

This document defines the **Context Selector**: the component that sits between a user request and the AI Gateway (doc 10), responsible for deciding exactly which slice of the `ThemeManifest`/`ThemeModel` is relevant, and nothing more, before a request ever reaches the Operation Planner (doc 11) or Clarification System (doc 13).

## 2. Context selection pipeline

```
user request text
      │
      ▼
[1] keyword / entity extraction  ──────────────► candidate target hints
      │                                           (section names, template, attribute)
      ▼
[2] section capability index lookup ───────────► exact/near-exact hits
      │  (hit)                              (miss or low-confidence)
      ▼                                           │
   resolved target(s)                             ▼
      │                              [3] embedding-based semantic search
      │                                  over section names + schema labels
      │                                           │
      │                                           ▼
      │                                  resolved target(s), or "no match"
      ▼                                           │
[4] retrieve slice: target section's current settings + schema
    + relevant global style tokens + (if template-level) template's section list
      │
      ▼
   context payload handed to AI Gateway (doc 10) as part of the AIRequest
```

### 2.1 Stage 1 — keyword/entity extraction

A `fast`-tier structured-output call (doc 10 §4) over the raw request extracts:

- **Target hints** — noun phrases likely referring to a section, block, template, or theme-wide concept ("hero," "header," "the reviews," "homepage," "buttons").
- **Attribute hints** — the property being discussed ("background," "bigger," "font," "spacing").
- **Action hints** — the verb class (set/add/remove/reorder/duplicate/style).

This stage is cheap and runs on every request. It never sees theme content — only the user's text — so its cost is flat regardless of theme size.

### 2.2 Stage 2 — section capability index lookup

Shopforge maintains a lightweight **section capability index** per theme, derived from the Manifest at parse time and cached alongside it (invalidated on the same `themeVersionHash` change that invalidates the Manifest):

```
SectionCapabilityIndex {
  themeVersionId: string
  entries: [{
    sectionId: string
    aliases: [string]          // static synonym table: "hero" -> ["hero-banner","banner","top-banner"...]
    schemaName: string
    keyLabels: [string]        // flattened SettingDef.label + BlockDef.name values, for fast keyword match
    templatesUsedIn: [string]
  }]
}
```

Stage 1's target hints are matched against `aliases` and `keyLabels` with straightforward keyword/fuzzy-string matching first — this resolves the large majority of requests ("hero," "header," "footer," "product reviews") without ever invoking an embedding model, keeping the common case both fast and free.

### 2.3 Stage 3 — embedding-based semantic search (fallback for fuzzy requests)

When stage 2 returns no confident match — typically for vaguer requests like *"make the header better"* or *"make my homepage more premium"* — the Context Selector falls back to embedding similarity:

- Each section's `schemaName`, `keyLabels`, and a short synthesized description (e.g. "hero-banner: full-width image with heading, subheading, and button") are pre-embedded at Manifest-build time and cached (doc 10 §10, semantic cache).
- The request's target/attribute hints are embedded at query time (an `embeddings` capability call, doc 10 §3) and compared via cosine similarity against the cached section embeddings.
- Matches above a confidence threshold are returned as candidates; **multiple** candidates above threshold (e.g. "header" matching both a `section-group` header and an `announcement-bar` section) is itself a signal handed to the Clarification System (doc 13, "ambiguous target").
- No candidate above threshold → "no match," which becomes a missing-capability signal (doc 13, "missing Shopify capability" / "ask clarification").

This is also the mechanism that resolves genuinely vague style requests like "more premium": the request doesn't name a section at all, so stage 3 instead matches the *style/attribute* language against a small fixed vocabulary of style tokens (spacing, typography scale, button style, color contrast) mapped to `GlobalStyles` fields and relevant `SettingDef`s theme-wide, producing a candidate set of structural levers rather than a single section.

### 2.4 Stage 4 — slice retrieval

Once target(s) are resolved (by stage 2 or 3), the Context Selector retrieves **only**:

- The resolved `SectionInstance.settings` (current values) + its `ThemeManifest.sections[].settings`/`blocks`/`presets` (schema/definitions) — not the section's raw Liquid source, unless the request has already been determined to require `modify_liquid` (doc 11 §5.3), in which case that one file's source is added.
- If the request is template-scoped (e.g. "reorder my product page sections"), the `TemplateNode.sectionInstances`/`sectionOrder` for that template only — not all templates.
- Relevant slices of `GlobalStyles` (e.g. only `colors`/`typography` if the request concerns those; not the full object) when the request or resolved style tokens implicate global styling.
- Nothing from `snippets`, `assets`, `locales`, or unrelated `sections`/`templates` entries unless a resolved target specifically references them (e.g. a snippet rendered by the resolved section).

This assembled payload — not the Manifest, not the Model, a narrow derived slice of both — is what becomes `AIRequest.input` context for the Operation Planner/Clarification System calls described in docs 10/11/13.

## 3. What's cached across conversation turns

An `AIConversation` (doc 17) persists across a merchant's multi-turn editing session. To avoid re-deriving and re-sending the same context every turn:

| Cached per conversation | Contents | Invalidated when |
|---|---|---|
| **Resolved target set** | The section(s)/template(s)/style-token(s) established as "what we're talking about" in the current thread | User's request clearly shifts target ("now let's look at the footer instead"), or `themeVersionHash` changes |
| **Last-sent context slice** | The exact payload (section settings + schema + style tokens) sent to the AI on the previous turn | Any `Operation` executes against the resolved target (settings changed → stale) |
| **Section/style embeddings** | Precomputed per §2.3, theme-scoped not conversation-scoped | `themeVersionHash` change (i.e., theme was re-parsed) |
| **Section capability index** | Per §2.2, theme-scoped | `themeVersionHash` change |

The Manifest/Model's own caching (by `themeVersionHash`, per architecture core §1) already prevents redundant parsing; this layer adds conversation-scoped caching on top so a five-turn back-and-forth about the hero section doesn't re-derive "which section is the hero" or re-embed anything five times.

## 4. Incremental / diff-based context updates

Within an ongoing conversation about the same resolved target, turn *N+1* does not resend the full slice from turn *N*. Instead:

- If no `Operation` has executed since the last turn (the user is still refining the request, e.g. clarification back-and-forth), the cached last-sent context slice is reused as-is — zero re-transmission cost, the Gateway's `conversationId`-scoped message history already carries it.
- If an `Operation` **did** execute since the last turn (the user approved a change and is now asking for a follow-up), only the **`DiffEntry` set** produced by that operation (doc 14) is sent as an update to the previously-sent context — e.g. `{ path: "sections.hero-1.settings.background_color", before: "#ffffff", after: "#0B1F4D" }` — rather than the entire section's settings object again. The model is instructed to treat this as a patch against context it already has in conversation history.
- If the resolved target changes (new section/template brought into scope), that target's slice is fetched fresh per §2.4 and appended, not substituted — prior context remains available for the model to reference ("also make the button match the hero color" a few turns later still resolves correctly).

This keeps per-turn token cost roughly proportional to *what changed*, not to theme or even section size, for the common case of an iterative editing conversation.

## 5. Worked example — token budget comparison

Illustrative numbers for a mid-size Shopify OS 2.0 theme:

| Quantity | Size |
|---|---|
| Full theme file tree (all Liquid, JSON, CSS, JS, locale files) | ~1.8 MB raw, roughly 450,000–500,000 tokens if naively serialized |
| Full `ThemeManifest` (structured summary, no raw Liquid) | ~40,000 tokens if sent whole |
| **Shopforge's resolved slice for "make the hero section background dark blue"** | 1 section's `settings` + `SettingDef`s (~15 fields) + no global styles needed → **~350–500 tokens** |
| **Shopforge's resolved slice for "create a premium product page with reviews, benefits, FAQ, upsells"** | `product` template's section list/order + 4 candidate sections' schemas + relevant `GlobalStyles` subset → **~2,000–3,000 tokens** |

Even the complex multi-capability example — which touches five sections and global styles — stays roughly two orders of magnitude below sending the full Manifest, and nearly three orders of magnitude below the raw theme tree. This ratio is the concrete, defensible basis for Shopforge's cost model (doc 22, Billing) and is what makes structural operations near-zero-cost (doc 10 §6) even on large themes.

## 6. Token/cost budget policy

Context Selector output feeds directly into the `budget` on the `AIRequest` (doc 10 §3.1) and into the `estimatedCreditCost` the Operation Planner attaches to each emitted `Operation` (architecture core §3). Policy:

| Operation class | Context budget target | Model tier | `estimatedCreditCost` behavior |
|---|---|---|---|
| Structural (`update_setting`, `update_block_setting`, `move_section`, `duplicate_section`, `reorder_block`, `update_global_style`, `update_theme_setting`) | Single-section/template slice, no raw Liquid | `fast`/`standard` | ≈0 — these never touch raw code and rarely exceed a few hundred tokens of context |
| Structural, multi-target (`add_section`, `remove_section`, `add_block`, `remove_block`) | Slice covers the section being added/removed plus its insertion point's template section list | `standard` | Low, non-zero — still no generation, but plan reasoning across multiple sections costs slightly more than a single-setting edit |
| Generative (`create_section_file`, `modify_liquid`, `modify_css`, `modify_js`) | Slice includes the target file's current raw source (if modifying) or closely analogous existing section(s) as few-shot grounding (if creating), capped at a fixed max-file-count so one generation request can't balloon into "include the whole theme for inspiration" | `premium` | Computed from the Gateway's price table for the expected output size (doc 10 §6) — always > 0, always shown to the user before execution (doc 11 §7) |

The Context Selector is the enforcement point for the "structural vs generative" cost split described in doc 10 §6: it is what guarantees a structural request's context payload stays small enough that it *can* be near-zero cost, by construction, rather than by hoping the model doesn't ask for more.

## 7. Failure and edge cases

| Case | Handling |
|---|---|
| Stage 2 and Stage 3 both return no candidate | Escalated to Clarification System as "missing Shopify capability" or "ambiguous target: none found" (doc 13) — never silently falls through to sending full-theme context as a last resort |
| Multiple high-confidence candidates from Stage 3 | Escalated to Clarification System as "ambiguous target" with the candidate list attached, so the clarifying question can name the actual options ("Do you mean the announcement bar or the main header?") rather than asking generically |
| Resolved slice would still exceed the product-level token ceiling (doc 10 §5) even after narrowing (e.g. a section with an unusually large number of blocks/presets) | Slice is further truncated to the most relevant `BlockDef`/`PresetDef` entries by the same keyword/embedding relevance score used to resolve the target in the first place, rather than the request being rejected outright |
| Theme re-synced mid-conversation (`themeVersionHash` changes) | All conversation-scoped caches (§3) invalidate; next turn re-resolves targets fresh against the new Manifest, and the user is informed if their previously-resolved target no longer exists |
