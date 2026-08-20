# 11 — AI Generation & Editing Operation System

## 1. Purpose

This document defines the end-to-end pipeline that turns either (a) a merchant's **Product URL** into a first-draft **Store Configuration**, or (b) a merchant's natural-language edit request against an *existing* Store Configuration, into one or more `Operation`s applied to that Store Configuration. Both flows are covered by this single document because they resolve to the same underlying mechanism.

**The framing that governs everything below: the AI is a structured configuration/content generator, never a code generator.** Shopforge owns one Base Theme and a fixed, versioned library of ~40–60 reusable Sections (Liquid template + settings schema + editor metadata + design spec — all authored by us, doc 07/08 own the full catalog schema). The AI never writes Liquid, HTML, CSS, or JS as part of the normal generation or editing workflow. Its entire output surface is: which sections to use, in what order, with what settings, and what copy — expressed as structured `Operation`s against the **Store Configuration**, the single editable JSON document that drives both the live preview and the eventual published store.

Compressed pipeline shared by both flows:

```
(product data | user request) → intent / target understanding →
section & settings lookup (against the fixed catalog + current Store Configuration) →
operation emission → plan assembly (if multi-step) →
confirmation (doc 13) → execution → validation handoff (doc 15) → diff (doc 14)
```

Because the section catalog is fixed and known in advance — not discovered by parsing an arbitrary merchant theme — a whole class of complexity that used to define this system is simply gone: there is no "does this unknown theme already have this capability" detection problem. The AI always knows exactly what sections exist and what settings each one exposes, because that catalog is small, static, and versioned by us.

## 2. Two flows, one mechanism

| | Flow A — AI Store Generation | Flow B — Conversational Editing |
|---|---|---|
| Trigger | Merchant submits a **Product URL** | Merchant sends a chat message against an existing Store Configuration |
| Starting point | Empty/default Store Configuration | Populated Store Configuration |
| Primary inputs | Scraped **Product Data**, the fixed Section catalog | The current Store Configuration slice (doc 12), the fixed Section catalog, the user's instruction |
| Typical `Operation` mix | Many `add_section` + `set_setting` + `set_content` + `generate_copy` steps in one pass | Usually 1–3 `Operation`s: `set_setting`, `add_section`, `reorder_section`, etc. |
| Output | A `Store Configuration` (v1), reviewed before publish | An updated `Store Configuration` |
| Owning section below | §4–§5 | §6–§7 |

Both flows produce an `Operation` or `OperationPlan` (§3), both pass through the same confirmation hooks (§12), the same execution semantics (§13), and the same validation/diff handoff (§14). Flow A is simply a large, front-loaded `OperationPlan` applied to a Store Configuration that starts empty; there is no separate "generation engine" distinct from the operation system described here.

## 3. The Operation and OperationPlan schema (reference)

### 3.1 Store Configuration (recap, owned by docs 07/08 for the catalog side)

```
StoreConfiguration {
  storeConfigId: string
  pages: {
    [pageKey: string]: {              // e.g. "home", "product"
      sections: [SectionInstance]      // ordered
    }
  }
}

SectionInstance {
  id: string                          // instance id, unique within the page
  type: string                        // a type from the fixed Section catalog, e.g. "hero", "faq-accordion"
  settings: { [settingId: string]: any }
  blocks?: [BlockInstance]
  provenance?: SectionProvenance      // see §9
}

BlockInstance {
  id: string
  type: string
  settings: { [settingId: string]: any }
}
```

Each `type` in the catalog carries a static `SectionDefinition` (doc 07/08): its `settingsSchema: [SettingDef]`, optional `blocksSchema: [BlockDef]`, human `label`, `aliases`, and design defaults. This document treats `SectionDefinition` as read-only, versioned input — the Operation system never writes to it, only to `StoreConfiguration`.

### 3.2 Operation

```
Operation {
  opId: string
  type: OperationType
  target: {
    page: string             // key into StoreConfiguration.pages
    sectionId?: string       // SectionInstance.id
    blockId?: string         // BlockInstance.id, block-scoped ops only
    settingId?: string       // set_setting / set_block_setting / set_content / generate_copy
    position?: string        // "after:<sectionId>" | "before:<sectionId>" | "start" | "end", for ordering/insertion ops
  }
  payload: object            // shape depends on type, see §3.3
  riskLevel: "safe" | "review" | "destructive"
  estimatedCreditCost: number
}
```

### 3.3 OperationType — the full primary-workflow set

| Type | Payload | Default `riskLevel` | Typical `estimatedCreditCost` |
|---|---|---|---|
| `add_section` | `{ sectionType, presetName?, settings? }` | `safe` | 0 |
| `remove_section` | `{}` | `review` (escalates — see §9) | 0 |
| `reorder_section` | `{}` (position carried on `target.position`) | `safe` | 0 |
| `duplicate_section` | `{}` | `safe` | 0 |
| `add_block` | `{ blockType, settings? }` | `safe` | 0 |
| `remove_block` | `{}` | `review` (escalates — see §9) | 0 |
| `reorder_block` | `{}` | `safe` | 0 |
| `set_setting` | `{ value }` | `safe` | 0 |
| `set_block_setting` | `{ value }` | `safe` | 0 |
| `set_content` | `{ value }` — user-dictated literal text/media, verbatim | `safe` | 0 |
| `set_global_style` | `{ path, value }` — `path` is a key into `StoreConfiguration.globalSettings` (e.g. `"colors.accent"`), not a `target.page`/`sectionId` (global styles aren't section-scoped) | `safe` | 0 |
| `generate_copy` | `{ brief, value }` — AI-authored text (`value` is the generated result, `brief` is what it was asked to write) | `safe` (escalates — see §9) | > 0 |
| `generate_image` | `{ brief, value }` — AI-generated/enhanced image (`value` is the resulting `AssetRef`, `brief` is the generation prompt/instruction) | `safe` (escalates — see §9) | > 0 |
| `regenerate_section` | `{ brief?, overrideUserEdits?: boolean }` — re-runs settings/content generation for one existing `SectionInstance`, optionally steered by a fresh brief | `safe` by default (only touches `"ai"`-provenance fields per §9); `review`/`destructive` when `overrideUserEdits: true` | > 0 |
| `regenerate_page` | `{ brief?, overrideUserEdits?: boolean }` — re-runs `regenerate_section` across every section on a page | Same escalation rule as `regenerate_section`, evaluated per section | > 0 |

`set_content` vs `generate_copy` is a deliberate split: `set_content` carries a value the user (or Product Data, in Flow A) explicitly supplied — the AI is just placing it. `generate_copy` is the AI actually authoring the text (an FAQ answer, a testimonial, CTA copy) — this is the one place in the primary workflow where the AI produces genuinely novel content, and it is priced and validated accordingly (content, not code — doc 15, doc 10 §6). `generate_image` is the same idea applied to media (doc 22's "Image Generation / Enhancement" credit line). `regenerate_section`/`regenerate_page` are bulk re-generation, not new operation *kinds* — each decomposes into the same `set_setting`/`set_content`/`generate_copy`/`generate_image` operations §9's provenance rule already governs; they're named separately here only because they're a distinct user-facing action ("regenerate this section") and a distinct `/ai/*` entry point (doc 18), not a distinct write mechanism.

Every other `OperationType` is **structural**: it moves or assigns already-known, schema-typed values within the fixed catalog's contract. No primary-workflow operation type generates Liquid, CSS, or JS — see **Future / Advanced Architecture** at the end of this document for why that used to be different and why it isn't now.

### 3.4 OperationPlan

```
OperationPlan {
  planId: string
  storeConfigId: string
  steps: [Operation & { rationale: string }]   // ordered
  overallRiskSummary: string
  totalEstimatedCreditCost: number
}
```

Identical in shape and role to a single `Operation` list with rationale attached — used whenever a request decomposes into more than one step (§11).

## 4. Flow A — AI Store Generation pipeline

| Stage | Responsibility | Output |
|---|---|---|
| 1. Product Import | Scrape/import the given Product URL — title, description, images, price, variants | `ProductData` |
| 2. Section Selection | AI picks which catalog section *types* best represent this product/store, per page (e.g. `hero`, `product-gallery`, `icon-columns` for benefits, `faq-accordion`, `testimonials`, `cta-banner`) | Candidate `sectionType[]` per page |
| 3. Section Ordering | AI orders the selected sections per page into a sensible reading flow | Ordered `sectionType[]` per page |
| 4. Section Settings | AI fills each selected section's non-text settings (colors, layout variant, image references) from `ProductData` + catalog defaults | `settings` per section instance |
| 5. Content Generation | AI populates textual content: `set_content` for values taken verbatim from `ProductData` (e.g. the actual product title), `generate_copy` for AI-authored content (FAQ Q&A, testimonial text, CTA copy) | Populated content |
| 6. Plan assembly | All of the above are wrapped as one `OperationPlan` (§3.4) applied against an empty Store Configuration | `OperationPlan` (generation variant) |
| 7. Review | Merchant previews the generated store via the LiquidJS Preview Renderer (doc 06/19) before accepting | Approval / edits / regenerate |
| 8. Store Configuration created | Approved plan applied → `StoreConfiguration` v1 exists and can be opened in the Visual Editor | `StoreConfiguration` |

Everything past stage 8 — the Preview Renderer, the same-origin iframe, the Visual Editor itself, and Publish (Base Theme + our Liquid sections + this configuration → a real Shopify store) — is owned by docs 06, 16, and 19. This document's scope ends at "an approved `OperationPlan` has produced a `StoreConfiguration`."

## 5. Worked example A — generation flow

**Input:** Product URL for a ceramic pour-over coffee dripper.

### 5.1 Product Import
```json
{
  "title": "Kessho Ceramic Pour-Over Dripper",
  "description": "Hand-glazed ceramic dripper with a flat-bottom design for even extraction...",
  "price": "38.00",
  "images": ["https://.../dripper-1.jpg", "https://.../dripper-2.jpg"],
  "variants": [{ "title": "Charcoal" }, { "title": "Sand" }]
}
```

### 5.2–5.3 Section selection and ordering (`home` and `product` pages)
```json
{
  "home": ["hero", "icon-columns", "testimonials", "cta-banner"],
  "product": ["product-hero", "faq-accordion"]
}
```
All six section types come directly from the fixed catalog — no candidate is ever "not found," because selection only ever chooses among catalog entries.

### 5.4–5.5 Settings and content → Operation Plan (excerpt)
```json
{
  "planId": "plan_gen_7a11...",
  "storeConfigId": "sc_new",
  "steps": [
    {
      "opId": "op_01", "type": "add_section",
      "target": { "page": "home", "position": "end" },
      "payload": { "sectionType": "hero" },
      "riskLevel": "safe", "estimatedCreditCost": 0,
      "rationale": "Every generated homepage opens with a hero section."
    },
    {
      "opId": "op_02", "type": "set_content",
      "target": { "page": "home", "sectionId": "op_01", "settingId": "heading" },
      "payload": { "value": "Kessho Ceramic Pour-Over Dripper" },
      "riskLevel": "safe", "estimatedCreditCost": 0,
      "rationale": "Heading set verbatim from the imported product title."
    },
    {
      "opId": "op_03", "type": "generate_copy",
      "target": { "page": "home", "sectionId": "op_01", "settingId": "subheading" },
      "payload": { "brief": "One short, benefit-led line about a hand-glazed ceramic pour-over dripper.", "value": "Slow-poured, evenly extracted, every single cup." },
      "riskLevel": "safe", "estimatedCreditCost": 3,
      "rationale": "No source text exists for a hero subheading; AI authors one from the product description."
    },
    {
      "opId": "op_04", "type": "add_section",
      "target": { "page": "product", "position": "end" },
      "payload": { "sectionType": "faq-accordion" },
      "riskLevel": "safe", "estimatedCreditCost": 0,
      "rationale": "Product includes care/usage questions worth answering up front."
    },
    {
      "opId": "op_05", "type": "add_block",
      "target": { "page": "product", "sectionId": "op_04" },
      "payload": { "blockType": "faq-item" },
      "riskLevel": "safe", "estimatedCreditCost": 0,
      "rationale": "One FAQ block per generated question."
    },
    {
      "opId": "op_06", "type": "generate_copy",
      "target": { "page": "product", "sectionId": "op_04", "blockId": "op_05", "settingId": "answer" },
      "payload": { "brief": "Answer: is this dripper compatible with standard V60 filters?", "value": "Yes — Kessho is sized for standard size-02 conical filters, so it works with the paper filters you're already using." },
      "riskLevel": "safe", "estimatedCreditCost": 4,
      "rationale": "AI-authored FAQ answer grounded in the product description; no source text existed."
    }
  ],
  "overallRiskSummary": "6 of 6 steps are structural placements or content fills against the fixed catalog. No step requires new code. 2 steps generate novel copy (subheading, FAQ answer) and carry non-zero cost.",
  "totalEstimatedCreditCost": 7
}
```

On approval (§12), this plan executes to produce `StoreConfiguration` v1, each step becoming a `Diff` (doc 14) exactly as an editing-flow step would.

## 6. Worked example B — simple, single-operation edit

**User request:** *"make the hero heading bigger"*

### 6.1 Intent understanding
A `fast`-tier structured-output call (doc 10 §4) extracts:
```json
{ "targetHint": "hero heading", "attributeHint": "size", "actionHint": "increase" }
```

### 6.2 Section & settings lookup
The Context Selector (doc 12) resolves `"hero"` against the current `StoreConfiguration.pages.home.sections` — there is exactly one `hero`-typed `SectionInstance` (`id: "hero-1"`) — and retrieves its `SectionDefinition.settingsSchema` (doc 07/08). Among its settings:
```json
{ "id": "heading_size", "type": "range", "label": "Heading size", "min": 1, "max": 5, "step": 1, "default": 3 }
```
Type (`range`), label semantics ("size" ↔ "Heading size"), and range plausibility (current value `3`, not already at the max) all clear — see §8.1.

### 6.3 Operation emission
```json
{
  "opId": "op_8f2a...",
  "type": "set_setting",
  "target": { "page": "home", "sectionId": "hero-1", "settingId": "heading_size" },
  "payload": { "value": 4 },
  "riskLevel": "safe",
  "estimatedCreditCost": 0
}
```

### 6.4 Confirmation → execution → validation → diff
Single operation, `riskLevel: "safe"`, fully specified → doc 13 outcome "execute immediately" (doc 13 §5.1 covers the parallel dark-blue-background example in full). Validation (doc 15) confirms `4` is within `[1,5]` for a `range` setting. Diff (doc 14):
```json
{ "kind": "modified", "path": "pages.home.sections[id=hero-1].settings.heading_size", "before": 3, "after": 4, "humanSummary": "Hero heading size increased from 3 to 4" }
```

## 7. Worked example C — complex, multi-step edit

**User request:** *"add an FAQ section to my product page and put it below the testimonials"*

### 7.1 Intent understanding
```json
{ "action": "add", "sectionHint": "FAQ", "pageHint": "product page", "orderingHint": "below testimonials" }
```

### 7.2 Section & settings lookup
- "FAQ" → catalog lookup matches `faq-accordion` directly via alias table (§8.2) — a direct, deterministic hit, not a fuzzy guess.
- The `product` page's current sections are checked: it already has a `testimonials` instance (`id: "test-1"`) but no `faq-accordion` instance yet.

### 7.3 Decision
`faq-accordion` exists in the catalog and is simply unplaced on this page → `add_section`. No section needs to be created. Ordering below testimonials is a placement detail on the same operation, not a separate lookup.

### 7.4 Operation Plan
```json
{
  "planId": "plan_c91e...",
  "storeConfigId": "sc_44a1...",
  "steps": [
    {
      "opId": "op_01", "type": "add_section",
      "target": { "page": "product", "position": "after:test-1" },
      "payload": { "sectionType": "faq-accordion" },
      "riskLevel": "safe", "estimatedCreditCost": 0,
      "rationale": "faq-accordion is in the catalog and unused on the product page; placed directly after testimonials per the request."
    },
    {
      "opId": "op_02", "type": "add_block",
      "target": { "page": "product", "sectionId": "op_01" },
      "payload": { "blockType": "faq-item" },
      "riskLevel": "safe", "estimatedCreditCost": 0,
      "rationale": "A new FAQ section needs at least one question to be useful; a starter block is added."
    },
    {
      "opId": "op_03", "type": "generate_copy",
      "target": { "page": "product", "sectionId": "op_01", "blockId": "op_02", "settingId": "answer" },
      "payload": { "brief": "Write one plausible starter FAQ question and answer for this product.", "value": "Q: How do I clean it? A: Hand wash with warm water; the ceramic glaze is not dishwasher-safe." },
      "riskLevel": "safe", "estimatedCreditCost": 4,
      "rationale": "No source FAQ content exists yet; AI drafts a starter entry the merchant can edit or replace."
    }
  ],
  "overallRiskSummary": "2 of 3 steps are zero-cost structural placements against the fixed catalog. 1 step generates a starter FAQ answer as placeholder content, editable afterward.",
  "totalEstimatedCreditCost": 4
}
```

### 7.5 Confirmation → execution → validation → diff
Multi-step (§11) → doc 13 outcome "show proposed plan." On approval, steps execute in order (`op_02`/`op_03` depend on `op_01` existing), each producing a `Diff` entry (doc 14), aggregated into one `Diff` for the plan.

## 8. Decision logic — does an existing section/setting satisfy this request?

This is the direct descendant of what used to be Shopforge's hardest problem — capability-matching against an *unknown* merchant theme. Against a small, fixed, self-authored catalog, it is a lookup problem, not a discovery problem.

### 8.1 Setting-level matching (does a `SettingDef` satisfy a requested change?)

| Check | Rule |
|---|---|
| **Type compatibility** | `SettingDef.type` must structurally accept the requested value class — a color request only matches `type: "color"`; "make it bigger" only matches `type: "range"`/`"number"`; "change the text" only matches `type: "text"`/`"richtext"`/`"textarea"`. |
| **Label semantics** | `SettingDef.label` (id as fallback) is compared to the request's `attributeHint` via keyword match first, the doc 12 §2.3 lightweight embedding fallback second — never a guess above a similarity threshold with no signal at all. |
| **Options containment (enum settings)** | For `type: "select"`/`"radio"`, the requested value must map onto one of `SettingDef.options` by label semantics ("rounded corners" → an option literally labeled "Pill"), not exact string match. |
| **Range plausibility** | For `type: "range"`/`"number"`, a qualitative request ("bigger") must resolve to a value within `[min, max]` respecting `step`; if the current value is already at/near the requested-direction bound, this does **not** silently no-op — it's flagged for clarification (doc 13), since applying it wouldn't meaningfully change anything. |
| **Uniqueness** | If more than one `SettingDef` on the resolved section clears the above with comparable confidence (e.g. a section with both `heading_color` and `background_color`, and the request just says "make it dark blue"), this is an **ambiguous target** → clarification (doc 13), never a guess. |

If exactly one `SettingDef` clears every applicable check with high confidence: emit `set_setting`/`set_block_setting` — `riskLevel: "safe"`.

### 8.2 Section-level matching (does an existing section type satisfy a requested capability?)

| Check | Rule |
|---|---|
| **Catalog alias/label lookup** | Every catalog `SectionDefinition` carries a static alias list (`"hero"` → `["hero", "hero-banner", "banner", "top-banner"]`) maintained by us alongside the schema. Most requests ("FAQ," "testimonials," "reviews," "hero") resolve here directly — deterministic, O(1), never a guess, because we wrote both the request vocabulary and the catalog. |
| **Placement vs. existence** | A section type can exist in the catalog but not currently be placed on the relevant page (`StoreConfiguration.pages[page].sections`). If it's not placed → `add_section`. If it's placed but the merchant wants a fresh instance → `add_section` again (a page can hold more than one instance of some section types) or `duplicate_section`, per §3.3. |
| **Block-level substitution** | If no dedicated section type matches but the resolved section's `blocksSchema` covers the request (e.g. adding one more "benefit" block to an existing icon-columns section rather than a whole new section) → `add_block`. |
| **Lightweight semantic fallback** | For genuinely vague requests that don't name a section at all ("make it feel more premium"), doc 12 §2.3's lightweight embedding fallback maps the request to candidate section/setting targets rather than section names being matched literally. |

### 8.3 When nothing in the catalog satisfies the request

Because the catalog is fixed, this is now a narrow, well-defined case rather than the everyday fallback it used to be: **no catalog section type, alias, or block schema plausibly covers the requested capability at all** (e.g. "add a live countdown timer bar," "add a chat widget" — content types genuinely outside the current catalog). This is *not* routed to code generation in the primary workflow. It routes to doc 13:
- If a reasonably close catalog alternative exists, it's offered as a substitute (never silently substituted — doc 13 §5.5's "real reviews" pattern, generalized).
- If nothing close exists, it's a **refuse — unsupported** outcome (doc 13 §4, row 1).

See **Future / Advanced Architecture** below for the previously-considered alternative of falling back to generated Liquid, and why it isn't part of this document's primary decision path.

## 9. Provenance and safe regeneration

Regeneration — re-running AI generation or content authoring over a section or an entire store *after* a merchant has already hand-edited some of it — must not blindly overwrite the merchant's own changes. Shopforge tracks this with lightweight **provenance**, carried directly on the Store Configuration:

```
SectionProvenance {
  section: "ai" | "user"                       // was this SectionInstance added by AI generation/editing, or by a direct user action?
  settings: { [settingId: string]: "ai" | "user" }   // per-setting authorship; unlisted keys inherit `section`
}
```

Rules:
- **Authorship, not approval.** Approving a plan (doc 13 outcomes 3/4) does not change provenance — the value was still authored by the AI, the merchant only consented to apply it. Provenance flips to `"user"` only when the merchant directly edits a value in the Visual Editor.
- **Regeneration only touches `"ai"`-provenance fields.** A "regenerate this section" or "regenerate my FAQ copy" action re-runs `generate_copy`/`set_setting` only against settings currently marked `"ai"`. Settings marked `"user"` are skipped by default, and the regeneration's summary/diff explicitly reports how many fields were preserved because the merchant had edited them.
- **Overriding preserved fields is itself a choice, not a default.** A merchant can explicitly request "regenerate everything, including my edits" — this is a distinct, opt-in action, and any `Operation` that would overwrite or remove `"user"`-provenance content is escalated to at least `riskLevel: "review"`, and to `"destructive"` for a removal, regardless of that operation type's default `riskLevel` in §3.3. This is what feeds doc 13's "destructive/high-blast-radius" signal for `remove_section`/`remove_block` and for bulk regeneration specifically.

This is the concrete mechanism behind the requirement that AI generation and editing coexist safely with manual edits across the lifecycle in §10.

## 10. Generation and execution lifecycle

Both flows (§2) must support the same set of lifecycle states, not just the happy path:

| State | Applies to | Behavior |
|---|---|---|
| **Loading** | Both | UI reflects pipeline progress per stage (Flow A: import → selection → ordering → settings → content; Flow B: a single "planning..."/"applying..." state per doc 10 §8) |
| **Failure (full)** | Both | E.g. Product Import can't reach/parse the URL, or the Gateway's circuit breaker is open (doc 10 §13). Nothing partial is persisted as a final Store Configuration; the user sees a clear error and a retry action. |
| **Partial failure** | Mostly Flow A | E.g. section selection and ordering succeed but `generate_copy` fails for 2 of 8 content fields (rate limit, refusal, timeout). Successfully generated sections/settings are kept; failed fields are left populated with catalog placeholder defaults, clearly marked as needing content, rather than blocking the whole store from being previewed. The merchant (or an automatic retry) can regenerate just those fields. |
| **Retry** | Both | Follows the Gateway's per-call retry policy (doc 10 §7) at the AI-call level; at the pipeline level, retry is scoped to the failed stage or field only — never the whole pipeline — mirroring the per-step execution semantics in §13. |
| **Regeneration** | Both | Provenance-aware per §9: only `"ai"`-provenance settings are eligible targets unless the merchant explicitly opts into overwriting their own edits. |
| **User edits after generation** | Both | Handled through the same Store Configuration mutation path the Visual Editor always uses; touched settings flip to `"user"` provenance (§9). There is no separate "AI write path" distinct from the editor's write path. |

## 11. OperationPlan structure and the non-trivial threshold

A request is wrapped in a full `OperationPlan` (§3.4) whenever it is **non-trivial**, operationalized as: more than one `Operation`, OR any single `Operation` with `riskLevel` other than `"safe"`. A single safe structural operation (§6) executes without a full plan screen, but is still logged as a one-step plan internally for audit/undo symmetry (doc 14).

## 12. Confirmation UX hook points

Full outcome logic lives in doc 13; this is the mechanical wiring.

| Hook point | Fires when | UI behavior |
|---|---|---|
| **Inline apply** | Single `Operation`, `riskLevel: "safe"` | Applied immediately; lightweight toast/diff summary, undoable via standard undo (doc 14), no blocking confirmation |
| **Plan preview** | `OperationPlan` with ≥2 steps, all `riskLevel: "safe"`/`"review"` (including a full Flow A generation plan) | Full plan rendered step-by-step with rationale per step and an explicit "Apply plan" action; individual steps can be deselected before applying |
| **Explicit confirmation** | Any step with `riskLevel: "destructive"` | That step is visually flagged and requires its own separate acknowledgment even within an otherwise-approved plan; a snapshot is guaranteed to exist before execution (doc 14) |
| **Post-generation review** | Any `generate_copy` step, after validation (doc 15) but before the diff is considered final | The generated text is shown explicitly (not just "an FAQ answer was added") before it's accepted into the Store Configuration |

`/ai/plan` produces the `OperationPlan` for hook points 2–4; `/ai/execute-plan` is the single entry point that applies approved steps, regardless of which hook point triggered approval.

## 13. Execution semantics

- Steps within an approved `OperationPlan` execute **in declared order**, sequentially, since later steps may depend on earlier ones (e.g. `add_block` targeting a `sectionId` that an earlier `add_section` step just created).
- Execution is atomic per plan: if any step fails validation (doc 15) after approval, the plan's already-applied steps are rolled back (every `Diff` entry stores `before`, doc 14) and the user sees what failed rather than a half-applied page.
- Every applied `Operation`, successful or rolled back, is persisted as the audit trail undo/redo operates over (doc 17).
- Execution always goes through the same Store Configuration mutation functions the Visual Editor uses for a manual edit — there is no separate "AI write path" (§10).

## 14. Handoff to validation and diff (not owned by this document)

Every `Operation`'s effect on the Store Configuration is checked by the Validation Pipeline before being considered final — see doc 15. Because no primary-workflow `Operation` produces code, validation here is entirely **data validation**: the referenced `sectionType`/`blockType` exists in the catalog, `settingId` exists on that section's schema, the value matches the setting's declared type/range/enum/length, and `generate_copy` output passes content checks (length, moderation) rather than syntax checks. The resulting change is expressed as a `Diff` — see doc 14 for the full versioning/undo/snapshot model. This document's responsibility ends at "operation executed against the Store Configuration and handed to validation."

---

## Future / Advanced Architecture

An earlier direction for Shopforge had the AI parsing an arbitrary merchant's existing theme and, when no existing setting or section satisfied a request, generating new Liquid/CSS/JS to close the gap (`create_section_file`, `modify_liquid`, `modify_css`, `modify_js`). That direction is cancelled for the product described in this document: with a fixed, self-authored catalog, the reuse-vs-generate ambiguity those operation types existed to resolve mostly stops occurring, and the ones that remain (§8.3) are rare enough to handle as refusals or clarifications rather than a standing code-generation capability.

The underlying idea — a narrowly-scoped, heavily-validated, AI-authored *new* section as an escape valve when the fixed catalog genuinely can't express a request — may be worth revisiting post-MVP. If it is:
- It would reintroduce something like the old §8.3 "reuse-vs-generate" decision tree, now scoped to "does the fixed catalog satisfy this" vs. "does this need a bespoke section."
- It would need its own operation types (`create_section_file`, `modify_liquid`), its own `premium`-tier routing (doc 10 §4), and materially stricter validation (Liquid syntax, OS 2.0 compatibility) than anything in doc 15's current data-validation scope.
- It is explicitly **not** part of the `OperationType` enum in §3.3, not reachable from the decision logic in §8, and not assumed by any other document in this batch (docs 10, 12, 13).
