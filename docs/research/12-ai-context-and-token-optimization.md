# 12 — AI Context and Token Optimization

## 1. Purpose

Context selection in Shopforge is deliberately narrow, and it's narrow for a simpler reason than it might first appear: the AI never needs to understand an unknown theme. It needs, for any given request, only: the relevant Product Data (Flow A), the *specific* section(s) from the fixed catalog that are actually in play — never the whole catalog, never every section's schema — the current Store Configuration slice those sections occupy, and the user's instruction. Everything else is out of scope by construction.

This document defines the **Context Selector**: the component that sits between a user request (or, in Flow A, Product Data) and the AI Gateway (doc 10), responsible for deciding exactly which slice of the fixed Section catalog and the Store Configuration is relevant, and nothing more, before a request ever reaches the Operation Planner (doc 11) or Clarification System (doc 13).

The problem this document used to solve — fuzzy capability matching against an *unknown* merchant theme, where a "hero section" might be called anything and might not exist at all — no longer exists. The catalog is fixed, small (~40–60 section types), and versioned by us. That collapses what used to be a three-stage resolution pipeline with a mandatory embedding fallback into a mostly-deterministic lookup, with a genuinely optional, lightweight fallback retained only for requests that don't name a section at all (§2.3).

## 2. Context selection pipeline

```
user request text (or Product Data, Flow A)
      │
      ▼
[1] keyword / entity extraction  ──────────────► candidate target hints
      │                                           (section type, page, attribute)
      ▼
[2] fixed-catalog alias/label lookup ──────────► resolved target(s)
      │  (hit — the common case)            (miss: request names no section, e.g. "more premium")
      ▼                                           │
   resolved target(s)                             ▼
      │                              [3] lightweight embedding fallback
      │                                  over style/attribute language only
      │                                           │
      │                                           ▼
      │                                  resolved target(s), or "no match"
      ▼                                           │
[4] retrieve slice: target section's current settings (Store Configuration)
    + its static settings schema (catalog) + relevant Product Data (Flow A only)
      │
      ▼
   context payload handed to AI Gateway (doc 10) as part of the AIRequest
```

### 2.1 Stage 1 — keyword/entity extraction

A `fast`-tier structured-output call (doc 10 §4) over the raw request extracts:

- **Target hints** — noun phrases likely referring to a section, block, or page ("hero," "FAQ," "the testimonials," "product page").
- **Attribute hints** — the property being discussed ("background," "bigger," "font," "spacing").
- **Action hints** — the verb class (set/add/remove/reorder/duplicate).

This stage is cheap and runs on every request. It never sees catalog or Store Configuration content — only the user's text — so its cost is flat regardless of store size.

### 2.2 Stage 2 — fixed-catalog alias/label lookup

Shopforge maintains a lightweight **catalog index**, built once per catalog release and shared across every store (not per-store, not re-derived from anything):

```
CatalogIndex {
  catalogVersion: string
  entries: [{
    sectionType: string
    aliases: [string]          // static synonym table: "hero" -> ["hero","hero-banner","banner","top-banner"...]
    label: string
    keyLabels: [string]        // flattened SettingDef.label + BlockDef.name values, for fast keyword match
  }]
}
```

Stage 1's target hints are matched against `aliases` and `keyLabels` with straightforward keyword/fuzzy-string matching — this resolves the overwhelming majority of requests ("hero," "FAQ," "testimonials," "footer") without ever invoking an embedding model. Because the catalog is small (~40–60 entries) and we control the vocabulary on both sides (the aliases we write, and the request-phrasing patterns we design the UI/chat around), this stage is a deterministic dictionary lookup, not a probabilistic match — it either finds an entry or it doesn't, with none of the "is this actually the same capability under a different name" uncertainty an unknown-theme lookup used to carry.

### 2.3 Stage 3 — lightweight embedding fallback (style/attribute language only)

Stage 2 fails to resolve only when the request doesn't name a section or setting at all — style adjectives like *"make it feel more premium"* or *"make the header better"* (where "header" plus "better" together are still under-specified — see doc 13 §5.2). For this narrow case, a lightweight embedding fallback remains genuinely useful, and it's worth being explicit about why it's kept even though the catalog is fixed and small: **the ambiguity here was never about discovering unknown sections — it's about mapping vague human language onto known ones.** A fixed catalog doesn't make "premium" a well-defined word; it only removes the uncertainty about what sections exist to apply that word to.

- A small, fixed vocabulary of style tokens (spacing, typography scale, button style, color contrast) is pre-embedded once per catalog release, mapped to the section `SettingDef`s across the catalog that they correspond to (doc 10 §10, semantic cache).
- The request's attribute language is embedded at query time (an `embeddings` capability call, doc 10 §3) and compared via cosine similarity against the cached style-token embeddings.
- Matches above a confidence threshold are returned as candidates; **multiple** candidates above threshold (e.g. "header" matching both a header section and an announcement-bar section) is itself a signal handed to the Clarification System (doc 13, "ambiguous target").
- No candidate above threshold → "no match," which becomes a missing-capability or clarification signal (doc 13 §4).

Because this fallback only ever searches a small, fixed, pre-embedded vocabulary — not an unbounded, per-theme-derived index — it is cheap enough to run on every vague request without materially affecting cost, and it is the only place in this pipeline where an embedding call happens at all.

### 2.4 Stage 4 — slice retrieval

Once target(s) are resolved (by stage 2 or 3), the Context Selector retrieves **only**:

- The resolved `SectionInstance.settings` (current values, from the Store Configuration) + its `SectionDefinition.settingsSchema`/`blocksSchema` (from the catalog, doc 07/08) — never another section's schema, and never the raw Liquid template behind it (the AI never sees or needs section Liquid in the primary workflow, doc 11 §1).
- If the request is page-scoped (e.g. "reorder my product page sections"), that page's `sections` array only — not every page.
- Relevant Product Data fields (Flow A only) — e.g. only `title`/`description` for a copy-generation step, not the full scraped payload including irrelevant fields.
- Nothing from unrelated pages or unrelated sections unless a resolved target specifically references them.

This assembled payload — a narrow, resolved slice of the catalog and the Store Configuration, never either in full — is what becomes `AIRequest.input` context for the Operation Planner/Clarification System calls described in docs 10/11/13.

## 3. What's cached across conversation turns

An `AIConversation` (doc 17) persists across a merchant's multi-turn editing session. To avoid re-deriving and re-sending the same context every turn:

| Cached per conversation | Contents | Invalidated when |
|---|---|---|
| **Resolved target set** | The section(s)/page(s)/style-token(s) established as "what we're talking about" in the current thread | User's request clearly shifts target ("now let's look at the footer instead") |
| **Last-sent context slice** | The exact payload (section settings + schema) sent to the AI on the previous turn | Any `Operation` executes against the resolved target (settings changed → stale) |
| **Style-token embeddings** | Precomputed per §2.3, catalog-scoped, not conversation- or store-scoped | Catalog release changes |
| **Catalog index** | Per §2.2, catalog-scoped | Catalog release changes |

Because the catalog index and style-token embeddings are catalog-scoped rather than per-store, they are computed once and shared across every merchant's store — there is no per-store re-parsing step analogous to the old theme-parsing cache this document used to describe.

## 4. Incremental / diff-based context updates

Within an ongoing conversation about the same resolved target, turn *N+1* does not resend the full slice from turn *N*. Instead:

- If no `Operation` has executed since the last turn (the user is still refining the request, e.g. clarification back-and-forth), the cached last-sent context slice is reused as-is — zero re-transmission cost, the Gateway's `conversationId`-scoped message history already carries it.
- If an `Operation` **did** execute since the last turn (the user approved a change and is now asking for a follow-up), only the **`DiffEntry`** produced by that operation (doc 14) is sent as an update to the previously-sent context — e.g. `{ path: "pages.home.sections[id=hero-1].settings.heading_size", before: 3, after: 4 }` — rather than the entire section's settings object again. The model is instructed to treat this as a patch against context it already has in conversation history.
- If the resolved target changes (new section/page brought into scope), that target's slice is fetched fresh per §2.4 and appended, not substituted — prior context remains available for the model to reference ("also make the FAQ heading match that size" a few turns later still resolves correctly).

This keeps per-turn token cost roughly proportional to *what changed*, not to store size or even section size, for the common case of an iterative editing conversation.

## 5. Worked example — token budget comparison

### 5.1 Baseline: what a naive approach would send

| Quantity | Size |
|---|---|
| Full fixed Section catalog, all ~50 sections' full `settingsSchema`/`blocksSchema` serialized | ~50 sections × ~300 tokens/section ≈ **15,000 tokens** |
| A typical generated Store Configuration (5 pages × ~5 section instances, each with ~10 settings) | ~25 instances × ~150 tokens/instance ≈ **3,750 tokens** |
| Naive "send everything, let the model figure it out" | **~19,000 tokens** |

### 5.2 Shopforge's resolved slice for *"make the hero heading bigger"* (full trace: doc 11 §6)

| Component | Content | Approx. tokens |
|---|---|---|
| Resolved `SectionInstance` | `hero-1`'s current settings (~10 fields) | ~120 |
| Resolved `SectionDefinition.settingsSchema` | `hero` section's setting definitions (~12 fields, incl. `heading_size`) | ~180 |
| User instruction | "make the hero heading bigger" | ~10 |
| **Total** | | **~310 tokens** |

That's roughly a **60x reduction** against the naive baseline, and the resolved slice is small enough to sit comfortably inside a single `fast`-tier extraction call plus one `standard`-tier `structured_output` call (doc 10 §4) without ever approaching a provider context-window concern (doc 10 §5). This is the concrete numeric basis for structural operations being priced at effectively zero (doc 10 §6, doc 11 §3.3) — the context they require is small *by construction*, not by hoping the model doesn't ask for more.

### 5.3 Worked example — staged context for Flow A generation (doc 11 §4)

Generation doesn't need one slice, it needs progressively narrower ones as the pipeline advances:

| Stage | Context needed | Why it stays small |
|---|---|---|
| Section Selection | Product Data + the catalog index's `label`/`aliases`/short description per section (§2.2's `CatalogIndex`, not full schemas) — breadth over the whole catalog, but shallow per entry | ~50 entries × ~30 tokens (label + short description) ≈ 1,500 tokens, not 15,000 |
| Section Ordering | The already-selected section types only (typically 4–8 for a page) — no schema detail needed, ordering doesn't touch settings | A few hundred tokens |
| Section Settings / Content | Full `settingsSchema` for the ~4–8 *selected* sections only, plus the Product Data fields relevant to each | ~6 sections × ~300 tokens ≈ 1,800 tokens, vs. 15,000 for the full catalog |

Selection needs to see across the whole catalog but only shallowly (names and one-line descriptions); settings/content generation needs depth but only for the handful of sections actually chosen. Neither stage ever needs both breadth and depth at once, which is why generation's total context cost stays a small multiple of a single edit request rather than scaling with catalog size.

## 6. Token/cost budget policy

Context Selector output feeds directly into the `budget` on the `AIRequest` (doc 10 §3.1) and into the `estimatedCreditCost` the Operation Planner attaches to each emitted `Operation` (doc 11 §3.2). Policy:

| Operation class | Context budget target | Model tier | `estimatedCreditCost` behavior |
|---|---|---|---|
| Structural, single-target (`set_setting`, `set_block_setting`, `set_content`, `reorder_section`, `reorder_block`, `duplicate_section`) | Single-section slice, schema only, no Product Data | `fast`/`standard` | ≈0 — rarely exceeds a few hundred tokens of context (§5.2) |
| Structural, multi-target (`add_section`, `remove_section`, `add_block`, `remove_block`) | Slice covers the section being added/removed plus its page's section list (for placement) | `standard` | Low, non-zero — reasoning across a page's section list costs slightly more than a single-setting edit, but there's still no content generation |
| Generative (`generate_copy`) | Slice includes the target section/block's content settings + relevant Product Data fields (Flow A) or conversational context (Flow B) as grounding, capped at the section actually being written for — never adjacent sections "for inspiration" | `standard`/`premium` depending on copy complexity | Computed from the Gateway's price table for expected output size (doc 10 §6) — always > 0, always shown to the user before execution (doc 11 §12) |

The Context Selector is the enforcement point for the structural-vs-generative cost split described in doc 10 §6: it is what guarantees a structural request's context payload stays small enough that it *can* be near-zero cost, by construction.

## 7. Failure and edge cases

| Case | Handling |
|---|---|
| Stage 2 and Stage 3 both return no candidate | Escalated to Clarification System as "missing capability" or "ambiguous target: none found" (doc 13) — never silently falls through to sending the full catalog as a last resort |
| Multiple high-confidence candidates from Stage 3 | Escalated to Clarification System as "ambiguous target" with the candidate list attached, so the clarifying question can name the actual options ("Do you mean the header section or the announcement bar?") rather than asking generically |
| Resolved slice would still exceed the product-level token ceiling (doc 10 §5) — rare, but possible for a section with an unusually large number of blocks (e.g. a 30-question FAQ) | Slice is further truncated to the most relevant `BlockDef` entries by the same keyword/embedding relevance score used to resolve the target, rather than the request being rejected outright |
| Catalog release changes mid-conversation | Catalog-scoped caches (§3) invalidate; next turn re-resolves targets fresh against the new catalog index, and the user is informed if a previously-resolved section type no longer exists |
| Store Configuration edited (by the merchant, in the Visual Editor) mid-conversation | The cached "last-sent context slice" for the affected section is invalidated (§3); next turn re-fetches current settings rather than reasoning over stale values |
