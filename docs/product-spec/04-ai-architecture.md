# AI Architecture

AI in Shopforge is a structured configuration and content generator, never a code generator. It selects
sections from the fixed [Section Library](02-base-theme-and-section-library.md), orders them, sets their
settings, and writes their copy — all expressed as operations against the
[Store Configuration](03-store-configuration.md). This document specifies the provider-neutral layer that
makes AI calls happen, the two flows that consume it, the operation vocabulary AI is allowed to emit, how
context is scoped to a small known catalog, how the system decides whether to act or ask first, and how
regeneration coexists safely with a merchant's manual edits. See [DECISIONS.md](DECISIONS.md) items 4 and 5
for the settled facts this document elaborates.

## 1. The AI Provider Abstraction Layer

### 1.1 Why it exists

Every AI call in Shopforge — from the initial store generation to a single "make this bigger" edit — goes
through one internal service, the **AI Gateway**. No caller (the AI Generation Pipeline, the Clarification
System, copy generation) talks to a vendor SDK directly. This exists because model quality, pricing, rate
limits, and even entire capabilities shift across providers over time, and none of that should require
touching the systems that decide *what* to ask the AI. Concretely, the abstraction buys:

- **Vendor independence** — adding a provider means implementing one adapter against a fixed interface, not
  modifying the Generation Pipeline, Clarification System, or any other caller.
- **Graceful degradation** — a single provider outage falls back to another provider for the same capability
  rather than taking the product down.
- **Cost/performance routing** — cheap, fast models handle structural decisions; only content authoring pays
  for a premium model, and that routing table can change centrally without touching calling code.

### 1.2 Capability surface

The Gateway exposes five capability families. A provider adapter implements whichever of these the
underlying vendor supports; a central capability matrix tracks which provider currently serves which family,
so a single user request can transparently span two providers (e.g. one for structured-output planning, one
for embeddings) without any caller knowing.

| Capability | Purpose in Shopforge | Primary caller |
|---|---|---|
| Chat | Free-form conversational turns, intent restatement, clarification dialogue | Clarification System |
| Structured output / tool-calling | Forces the model to emit a valid `Operation` / `OperationPlan` / section-selection object — never prose | AI Generation Pipeline |
| Vision | Reads product images during Product Import, or a rendered preview, to ground visual/style requests | AI Generation Pipeline |
| Image generation | Produces hero images, banners, lifestyle photography as section image/media setting values | `generate_image` operation (deferred post-MVP, see [MVP Scope](24-mvp-scope.md)) |
| Embeddings | Lightweight semantic mapping of vague style language to concrete section/setting targets | Context Selector, narrow fallback tier only (§5.3) |

### 1.3 Request/response envelope

Every call into the Gateway, regardless of capability, uses a common envelope so routing, logging, and
budgeting stay capability-agnostic. Callers never see a provider-specific payload shape; adapters translate
this envelope into the vendor's actual API shape and translate the response back.

```
AIRequest {
  requestId: string
  capability: "chat" | "structured_output" | "vision" | "image_generation" | "embeddings"
  conversationId?: string
  operationContext?: { storeConfigId: string, relatedOperationIds?: [string] }
  modelTier: "fast" | "standard" | "premium"
  input: {
    systemPrompt: string
    messages: [{ role: "user" | "assistant" | "system", content: string | ContentBlock[] }]
    responseSchema?: object     // JSON Schema the output must conform to, e.g. the Operation/OperationPlan shape
    images?: [assetRefOrDataUri]
  }
  budget: { maxOutputTokens: number, maxCreditCost: number }
  cacheable: boolean
}

AIResponse {
  requestId: string
  providerUsed: string
  modelUsed: string
  output: string | object      // object when responseSchema was supplied
  usage: { inputTokens, outputTokens, imageCount?, embeddingCount? }
  latencyMs: number
  cacheHit: boolean
  finishReason: "complete" | "truncated" | "refused" | "error"
}
```

### 1.4 Model tiering

Not every call deserves the most expensive model. `modelTier` resolves to a concrete `(provider, model)` pair
through a routing table that changes centrally, without caller code changes.

| Tier | Used for | Cost profile |
|---|---|---|
| `fast` | Intent classification, ambiguity detection, keyword/entity extraction for context selection, simple restatement | Cheapest available model; near-zero cost per call |
| `standard` | Chat turns, clarifying questions, `Operation` emission for well-scoped edits, section-settings generation from Product Data | Mid-tier model |
| `premium` | Multi-step `OperationPlan` assembly for complex edits or a full generation pass, `generate_copy` calls, vision grounding | Highest-quality available model |

Routing carries a fallback chain per tier: if the primary provider for a tier is unavailable or rate-limited,
the router retries the next provider in the chain that supports the requested capability before surfacing an
error.

### 1.5 Cost control

Every `AIRequest` carries `budget.maxCreditCost`. The Gateway rejects a request outright if the cheapest
viable route would exceed it, converts realized provider usage into Shopforge credits via a per-provider,
per-model price table, and enforces per-organization spend guards before dispatch — independent of the
per-call budget — so a runaway conversation cannot silently drain a `CreditBalance`. Structural calls
(`add_section`, `set_setting`, `reorder_section`, and every other structural operation type, §4) are
distinguished from generative calls (`generate_copy`, the one content-authoring operation type) at the
routing layer, so a structural request is never accidentally routed to a premium model.

### 1.6 Retries, timeouts, and failure

| Failure type | Behavior |
|---|---|
| Transient provider error (5xx, timeout) | Exponential backoff, up to 3 attempts, same provider |
| Rate limit (429) | Immediate fallback to the next provider in the tier's chain |
| Structured-output schema violation | One repair attempt (re-prompt with the validation error appended); fails twice → `finishReason: "error"` |
| Content refusal | No retry — surfaced as `finishReason: "refused"`, which becomes the "refuse — unsupported" outcome (§6) |
| All providers in the fallback chain exhausted | Circuit breaker opens for that capability for a cooldown window; caller gets a typed "AI temporarily unavailable" error, never a hang |
| Budget exceeded before dispatch | Typed `BudgetExceeded` error — never a silent downgrade to a cheaper model that would change output quality unexpectedly |

Retries apply only to the Gateway's dispatch of a single `AIRequest`. Retrying an entire multi-step
`OperationPlan` because one sub-call failed is a decision made by the AI Generation Pipeline (§7's partial
failure handling), not by the Gateway.

### 1.7 Caching

Two independent cache layers sit in front of provider dispatch:

1. **Exact-match cache** — keyed on `(capability, modelTier, systemPrompt, messages, responseSchema)`. Any
   `AIRequest` marked `cacheable: true` (structural classification, section-selection over unchanged Product
   Data, repeated identical clarification prompts) checks this first. A hit costs zero credits but is still
   logged as an `AIUsageEvent` for auditability.
2. **Semantic cache (embeddings-backed)** — used specifically by the narrow style-token fallback (§5.3), not
   for full chat turns, since chat responses are highly context-dependent and rarely safe to reuse verbatim.

`generate_copy` calls are never cacheable — they author novel, product/context-specific text by definition.

### 1.8 Observability

Every dispatched `AIRequest` — cache hit or live provider — produces exactly one `AIUsageEvent`, capturing at
minimum: `requestId`, `conversationId`, `capability`, `modelTier`, `providerUsed`, `modelUsed`, the
`operationId`/`operationPlanId` it served, token/image/embedding usage, realized `creditsCost` against the
requested `budgetMaxCreditCost`, `latencyMs`, `cacheHit`, `finishReason`, and `retryCount`. This is the
authoritative source the `CreditBalance` ledger and the `AuditLog` are built from.

### 1.9 Security framing

AI output in this system is structured data and content — `Operation`s and generated copy strings — never
executable code, so it is validated as data (schema conformance, setting type/range/enum checks,
content-length and moderation checks) rather than as code. Content pulled from a merchant-supplied product
URL is untrusted input: when the Context Selector assembles it into prompt context, it is wrapped in clearly
delimited context blocks, never concatenated directly into the system prompt, and the Gateway's system
prompts explicitly instruct the model to treat imported content as data to reason about, not instructions to
follow. Structured-output mode is preferred over free-form chat wherever the output feeds directly into an
executable `Operation`, because a schema-constrained response is far harder to hijack than free text.

The Gateway itself knows nothing about sections, catalogs, or Store Configurations — it only dispatches,
budgets, retries, caches, and logs. Two systems give it meaning: the AI Generation Pipeline (§2–§4) and the
Clarification System (§6).

## 2. Flow A — AI Store Generation

Flow A turns a merchant's Product Data into a first-draft Store Configuration. It starts from an empty
Store Configuration and runs as one large, front-loaded `OperationPlan` — there is no separate "generation
engine" distinct from the operation system that also drives editing (Flow B, §3).

```
Product Data
    |
    AI
    |
Structured Store Configuration / Operations
```

Expanded into pipeline stages:

| Stage | Responsibility | Output |
|---|---|---|
| 1. Product Import | Product Data is already normalized before this pipeline starts — see [Product Import](05-product-import.md) | `Product` |
| 2. Section Selection | AI picks which catalog section types best represent this product/store, per page (e.g. `hero`, `product-gallery`, `icon-columns`, `faq-accordion`, `testimonials`, `cta-banner`) | Candidate section types per page |
| 3. Section Ordering | AI orders the selected sections per page into a sensible reading flow | Ordered section types per page |
| 4. Section Settings | AI fills each selected section's non-text settings (colors, layout variant, image references) from Product Data plus catalog defaults | Settings per `SectionInstance` |
| 5. Content Generation | `set_content` for values taken verbatim from Product Data (e.g. the actual product title); `generate_copy` for AI-authored content (FAQ answers, testimonial text, CTA copy) | Populated content |
| 6. Plan assembly | All of the above wrapped as one `OperationPlan` applied against an empty Store Configuration | `OperationPlan` (generation variant) |
| 7. Review | Merchant previews the generated store via the [Preview Architecture](06-preview-architecture.md) before accepting | Approval / edits / regenerate |
| 8. Store Configuration created | Approved plan applied → `StoreConfiguration` v1 exists and opens in the [Visual Editor](09-visual-editor.md) | `StoreConfiguration` |

This pipeline runs as a tracked `GenerationJob`. Its scope ends at "an approved `OperationPlan` has produced
a `StoreConfiguration`" — the Preview Renderer, the editor, and Publish are owned elsewhere.

### 2.1 Worked example

Input: a Product URL for a ceramic pour-over coffee dripper, already imported as:

```json
{
  "title": "Kessho Ceramic Pour-Over Dripper",
  "description": "Hand-glazed ceramic dripper with a flat-bottom design for even extraction...",
  "price": "38.00",
  "images": ["https://.../dripper-1.jpg", "https://.../dripper-2.jpg"],
  "variants": [{ "title": "Charcoal" }, { "title": "Sand" }]
}
```

Section selection and ordering resolve to:

```json
{
  "home": ["hero", "icon-columns", "testimonials", "cta-banner"],
  "product": ["product-hero", "faq-accordion"]
}
```

All six section types come directly from the fixed catalog — selection only ever chooses among catalog
entries, so no candidate is ever "not found." Settings and content generation then produce an `OperationPlan`
excerpt:

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
      "payload": {
        "brief": "One short, benefit-led line about a hand-glazed ceramic pour-over dripper.",
        "value": "Slow-poured, evenly extracted, every single cup."
      },
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
      "payload": {
        "brief": "Answer: is this dripper compatible with standard V60 filters?",
        "value": "Yes — Kessho is sized for standard size-02 conical filters, so it works with the paper filters you're already using."
      },
      "riskLevel": "safe", "estimatedCreditCost": 4,
      "rationale": "AI-authored FAQ answer grounded in the product description; no source text existed."
    }
  ],
  "overallRiskSummary": "6 of 6 steps are structural placements or content fills against the fixed catalog. No step requires new code. 2 steps generate novel copy (subheading, FAQ answer) and carry non-zero cost.",
  "totalEstimatedCreditCost": 7
}
```

On approval, this plan executes to produce `StoreConfiguration` v1, and each step becomes a `Diff` exactly as
an editing-flow step would (see [Versioning and Undo/Redo](18-versioning-and-undo-redo.md)).

### 2.2 Partial failure

If section selection and ordering succeed but content generation fails for some fields (rate limit, refusal,
timeout), successfully generated sections/settings are kept; failed fields are populated with catalog
placeholder defaults, clearly marked as needing content, rather than blocking the whole store from being
previewed. The merchant, or an automatic retry, can regenerate just those fields. A full pipeline failure
(e.g. Product Import can't reach the URL, or the Gateway's circuit breaker is open) persists nothing partial
as a final Store Configuration — the user sees a clear error and a retry action.

## 3. Flow B — Conversational Editing of an Existing Configuration

Flow B resolves a natural-language edit request against a populated Store Configuration into one or more
operations. It is the same underlying mechanism as Flow A — both produce an `Operation` or `OperationPlan`,
both pass through the same confirmation logic (§6), the same execution semantics, and the same
validation/diff handoff — but it starts from an existing configuration instead of an empty one, and typically
resolves to one to three operations rather than a full generation pass.

```
User: "Make the hero heading bigger."
Current Configuration
        |
AI identifies relevant section/setting
        |
Structured operation
        |
Store Configuration updated
        |
Preview rerenders
```

### 3.1 Worked example — simple, single-operation edit

**Request:** *"make the hero heading bigger"*

A `fast`-tier structured-output call extracts intent:

```json
{ "targetHint": "hero heading", "attributeHint": "size", "actionHint": "increase" }
```

The Context Selector (§5) resolves `"hero"` against the current configuration's home-page sections — exactly
one `hero`-typed `SectionInstance` (`id: "hero-1"`) — and retrieves its settings schema. Among its settings:

```json
{ "id": "heading_size", "type": "range", "label": "Heading size", "min": 1, "max": 5, "step": 1, "default": 3 }
```

Type, label semantics, and range plausibility all clear (§5.4), so a single operation is emitted:

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

This is a single, fully specified, `safe`-risk operation, so it routes to Clarification System outcome
"execute immediately" (§6). Validation confirms `4` is within `[1,5]`. The resulting `Diff`:

```json
{
  "kind": "modified",
  "path": "pages.home.sections[id=hero-1].settings.heading_size",
  "before": 3,
  "after": 4,
  "humanSummary": "Hero heading size increased from 3 to 4"
}
```

### 3.2 Worked example — complex, multi-step edit

**Request:** *"add an FAQ section to my product page and put it below the testimonials"*

Intent understanding extracts `{ "action": "add", "sectionHint": "FAQ", "pageHint": "product page",
"orderingHint": "below testimonials" }`. "FAQ" resolves to `faq-accordion` via the catalog alias table — a
direct, deterministic hit. The product page already has a `testimonials` instance (`id: "test-1"`) but no
`faq-accordion` instance, so this is a placement, not a lookup miss:

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
      "payload": {
        "brief": "Write one plausible starter FAQ question and answer for this product.",
        "value": "Q: How do I clean it? A: Hand wash with warm water; the ceramic glaze is not dishwasher-safe."
      },
      "riskLevel": "safe", "estimatedCreditCost": 4,
      "rationale": "No source FAQ content exists yet; AI drafts a starter entry the merchant can edit or replace."
    }
  ],
  "overallRiskSummary": "2 of 3 steps are zero-cost structural placements against the fixed catalog. 1 step generates a starter FAQ answer as placeholder content, editable afterward.",
  "totalEstimatedCreditCost": 4
}
```

This is multi-step, so it routes to Clarification System outcome "show proposed plan" (§6). On approval,
steps execute in order (`op_02`/`op_03` depend on `op_01` existing), each producing a `Diff`, aggregated into
one `Diff` for the plan.

### 3.3 Streaming

Chat and structured-output calls stream token-by-token back through the Gateway, which is what lets the UI
show assistant replies appearing incrementally, and an `OperationPlan` rendering step-by-step as the model
emits it (or, during Flow A, sections appearing one at a time as they're selected) rather than a blank state
until the entire plan is ready. Image generation and embeddings are not streamed.

## 4. Operation vocabulary

AI's entire output surface, in both flows, is the set of operations below. Every operation targets the Store
Configuration through the same mutation path the Visual Editor uses for a manual edit — there is no separate
AI write path.

```
Operation {
  opId: string
  type: OperationType
  target: {
    page: string
    sectionId?: string
    blockId?: string
    settingId?: string
    position?: string        // "after:<sectionId>" | "before:<sectionId>" | "start" | "end"
  }
  payload: object             // shape depends on type
  riskLevel: "safe" | "review" | "destructive"
  estimatedCreditCost: number
}

OperationPlan {
  planId: string
  storeConfigId: string
  steps: [Operation & { rationale: string }]   // ordered
  overallRiskSummary: string
  totalEstimatedCreditCost: number
}
```

### 4.1 Operations AI can emit

| Type | Payload | Default `riskLevel` | Typical cost | MVP status |
|---|---|---|---|---|
| `add_section` | `{ sectionType, presetName?, settings? }` | `safe` | 0 | MVP |
| `remove_section` | `{}` | `review` (escalates to `destructive` — §7) | 0 | MVP |
| `reorder_section` | `{}` (position on `target.position`) | `safe` | 0 | MVP |
| `duplicate_section` | `{}` | `safe` | 0 | MVP |
| `add_block` | `{ blockType, settings? }` | `safe` | 0 | MVP |
| `remove_block` | `{}` | `review` (escalates to `destructive` — §7) | 0 | MVP |
| `reorder_block` | `{}` | `safe` | 0 | MVP |
| `set_setting` | `{ value }` | `safe` | 0 | MVP |
| `set_block_setting` | `{ value }` | `safe` | 0 | MVP |
| `set_content` | `{ value }` — user- or Product-Data-supplied literal text/media, placed verbatim | `safe` | 0 | MVP |
| `set_global_style` | `{ path, value }` — `path` keys into the configuration's global settings (e.g. `"colors.accent"`), not section-scoped | `safe` | 0 | MVP |
| `generate_copy` | `{ brief, value }` — AI-authored text; `value` is the generated result, `brief` is what it was asked to write | `safe` (escalates — §7) | > 0 | MVP |
| `generate_image` | `{ brief, value }` — AI-generated/enhanced image; `value` is the resulting `GeneratedAsset` | `safe` (escalates — §7) | > 0 | **Deferred post-MVP** |
| `regenerate_section` | `{ brief?, overrideUserEdits?: boolean }` — re-runs settings/content generation for one section, optionally steered by a fresh brief | `safe` by default; `review`/`destructive` when `overrideUserEdits: true` | > 0 | Default behavior (no override) is MVP; `overrideUserEdits: true` is **deferred post-MVP** (§7.3) |
| `regenerate_page` | `{ brief?, overrideUserEdits?: boolean }` — re-runs `regenerate_section` across every section on a page | Same escalation rule, evaluated per section | > 0 | **Deferred post-MVP** (bulk whole-page regeneration) |

`set_content` versus `generate_copy` is a deliberate split: `set_content` places a value already supplied by
the user or by Product Data; `generate_copy` is AI actually authoring new text — the one place in this system
where AI produces genuinely novel content, priced and validated accordingly. Every other operation type is
structural: it moves or assigns already-known, schema-typed values within the fixed catalog's contract.
`regenerate_section`/`regenerate_page` are not distinct write mechanisms — each decomposes into the same
`set_setting`/`set_content`/`generate_copy`/`generate_image` operations governed by the provenance rule in
§7; they exist as named operations because they are distinct user-facing actions ("regenerate this section")
with their own API entry point.

### 4.2 What AI never emits

AI never generates or modifies Liquid, HTML, CSS, or JavaScript, and there is no operation type for writing a
new section file or theme asset. This holds in both flows, with no exception in the primary workflow. A
narrowly-scoped, heavily-validated AI-authored *new* section as an escape valve when the fixed catalog cannot
express a request is not part of this specification: it is not in the `OperationType` enum above, not
reachable from the decision logic in §5, and not assumed anywhere else in this document. It is out of scope,
not a pending decision.

### 4.3 When nothing in the catalog satisfies a request

Because the catalog is fixed, this is a narrow case: no catalog section type, alias, or block schema
plausibly covers the requested capability at all (e.g. "add a live countdown timer bar," "add a chat widget"
— content types genuinely outside the catalog). This never routes to code generation. It routes to the
Clarification System (§6):

- If a reasonably close catalog alternative exists, it is *offered* as a substitute — never silently
  substituted.
- If nothing close exists, the outcome is **refuse — unsupported** (§6.1).

## 5. Context Selection

The AI never needs to understand an unknown theme. For any given request it needs only: the relevant Product
Data (Flow A), the *specific* section(s) actually in play from the fixed catalog — never the whole catalog,
never every section's schema — the current Store Configuration slice those sections occupy, and the user's
instruction. The **Context Selector** sits between a request (or Product Data) and the AI Gateway, deciding
exactly which slice is relevant and nothing more, before the request reaches the AI Generation Pipeline or
Clarification System.

```
user request text (or Product Data, Flow A)
      |
      v
[1] keyword / entity extraction  -----------> candidate target hints
      |                                       (section type, page, attribute)
      v
[2] fixed-catalog alias/label lookup -------> resolved target(s)
      |  (hit — the common case)         (miss: request names no section, e.g. "more premium")
      v                                       |
   resolved target(s)                         v
      |                          [3] lightweight embedding fallback
      |                              over style/attribute language only
      |                                       |
      |                                       v
      |                              resolved target(s), or "no match"
      v                                       |
[4] retrieve slice: target section's current settings + its settings schema
    + relevant Product Data (Flow A only)
      |
      v
   context payload handed to the AI Gateway as part of the AIRequest
```

### 5.1 Stage 1 — keyword/entity extraction

A `fast`-tier structured-output call over the raw request extracts target hints (noun phrases likely
referring to a section, block, or page — "hero," "FAQ," "the testimonials," "product page"), attribute hints
("background," "bigger," "font," "spacing"), and action hints (set/add/remove/reorder/duplicate). This stage
never sees catalog or Store Configuration content — only the user's text — so its cost is flat regardless of
store size.

### 5.2 Stage 2 — fixed-catalog alias/label lookup

Shopforge maintains a catalog index, built once per catalog release and shared across every store:

```
CatalogIndex {
  catalogVersion: string
  entries: [{
    sectionType: string
    aliases: [string]      // "hero" -> ["hero", "hero-banner", "banner", "top-banner"]
    label: string
    keyLabels: [string]    // flattened setting/block labels, for fast keyword match
  }]
}
```

Stage 1's target hints are matched against `aliases` and `keyLabels` with keyword/fuzzy-string matching. This
resolves the large majority of requests ("hero," "FAQ," "testimonials," "footer") without ever invoking an
embedding model — because the catalog is small and its vocabulary is authored by us on both sides (the
aliases, and the request-phrasing patterns the UI/chat are designed around), this is a deterministic
dictionary lookup: it either finds an entry or it doesn't.

### 5.3 Stage 3 — lightweight embedding fallback (style/attribute language only)

Stage 2 fails to resolve only when a request doesn't name a section or setting at all — style adjectives like
*"make it feel more premium"*. The ambiguity here was never about discovering unknown sections; it's about
mapping vague human language onto known ones. For this narrow case:

- A small, fixed vocabulary of style tokens (spacing, typography scale, button style, color contrast) is
  pre-embedded once per catalog release, mapped to the section settings across the catalog they correspond
  to.
- The request's attribute language is embedded at query time and compared via cosine similarity against the
  cached style-token embeddings.
- Matches above a confidence threshold return as candidates; multiple candidates above threshold (e.g.
  "header" matching both a header section and an announcement-bar section) is itself signaled to the
  Clarification System as an ambiguous target.
- No candidate above threshold returns "no match," which becomes a missing-capability or clarification
  signal.

> **TBD / Needs Investigation:** Whether this narrow embedding-based fallback is sufficient on its own, or
> needs to grow into a broader semantic-search tier, is unresolved. The source material frames this fallback
> as adequate for a small, fixed catalog, but explicitly leaves open whether it holds up as request phrasing
> diversifies in practice.

### 5.4 Stage 4 — slice retrieval

Once a target resolves, the Context Selector retrieves only: the resolved section's current settings plus its
settings/blocks schema (never another section's schema, and never the section's Liquid template — AI never
sees Liquid); if the request is page-scoped, that page's section list only, not every page; and, in Flow A,
only the Product Data fields relevant to the step being run (e.g. only title/description for a copy-
generation step). Nothing from unrelated pages or sections is included unless a resolved target specifically
references them.

### 5.5 Setting-level and section-level matching

| Check | Rule |
|---|---|
| Type compatibility | A setting's declared type must structurally accept the requested value class — a color request only matches `type: "color"`; "bigger" only matches `type: "range"`/`"number"`; "change the text" only matches text-type settings. |
| Label semantics | A setting's label (id as fallback) is compared to the request's attribute hint via keyword match first, the embedding fallback second — never a guess with no signal at all. |
| Options containment (enum settings) | For `select`/`radio` settings, the requested value must map onto one of the setting's options by label semantics ("rounded corners" → an option literally labeled "Pill"), not exact string match. |
| Range plausibility | For `range`/`number` settings, a qualitative request ("bigger") must resolve to a value within bounds respecting `step`; if the current value is already at/near the requested-direction bound, this is flagged for clarification rather than silently no-opping. |
| Uniqueness | If more than one setting on the resolved section clears the above with comparable confidence, this is an ambiguous target → clarification, never a guess. |
| Catalog alias/label lookup | Every catalog entry carries a static alias list; most section-naming requests resolve here directly — deterministic, never a guess. |
| Placement vs. existence | A section type can exist in the catalog without being placed on the relevant page. Not placed → `add_section`. Placed but the merchant wants a fresh instance → `add_section` again or `duplicate_section`. |
| Block-level substitution | If no dedicated section type matches but the resolved section's block schema covers the request (e.g. one more benefit block on an existing icon-columns section) → `add_block` rather than a new section. |

If exactly one setting clears every applicable check with high confidence, a `set_setting`/`set_block_setting`
operation is emitted at `riskLevel: "safe"`.

### 5.6 What's cached across a conversation

| Cached | Contents | Invalidated when |
|---|---|---|
| Resolved target set | The section(s)/page(s)/style-token(s) established as the current subject | The request clearly shifts target |
| Last-sent context slice | The exact payload (settings + schema) sent on the previous turn | Any operation executes against the resolved target |
| Style-token embeddings | Precomputed per §5.3, catalog-scoped | Catalog release changes |
| Catalog index | Per §5.2, catalog-scoped | Catalog release changes |

Within an ongoing conversation about the same resolved target, a follow-up turn does not resend the full
slice: if no operation executed since the last turn, the cached slice is reused as-is at zero re-transmission
cost; if an operation did execute, only that operation's `DiffEntry` is sent as a patch against context
already in conversation history; if the resolved target changes, that target's slice is fetched fresh and
appended, not substituted, so prior context stays available ("also make the FAQ heading match that size" a
few turns later still resolves correctly).

### 5.7 Token budget policy

| Operation class | Context budget target | Model tier |
|---|---|---|
| Structural, single-target (`set_setting`, `set_block_setting`, `set_content`, `reorder_section`, `reorder_block`, `duplicate_section`) | Single-section slice, schema only, no Product Data | `fast`/`standard` |
| Structural, multi-target (`add_section`, `remove_section`, `add_block`, `remove_block`) | The section being added/removed plus its page's section list, for placement | `standard` |
| Generative (`generate_copy`) | Target section/block's content settings plus relevant Product Data or conversational context as grounding, capped at the section actually being written for — never adjacent sections "for inspiration" | `standard`/`premium` |

A resolved slice for a single-setting edit (e.g. "make the hero heading bigger") runs to roughly 300 tokens —
the resolved `SectionInstance`'s current settings plus its settings schema plus the user's instruction — well
inside a single `fast`-tier extraction call and one `standard`-tier structured-output call. This is the
concrete basis for structural operations pricing at effectively zero: the context they require is small by
construction, not by hoping the model doesn't ask for more.

### 5.8 Failure and edge cases

| Case | Handling |
|---|---|
| Stage 2 and Stage 3 both return no candidate | Escalated to the Clarification System as missing capability or "ambiguous target: none found" — never falls through to sending the full catalog as a last resort |
| Multiple high-confidence candidates from Stage 3 | Escalated as an ambiguous target with the candidate list attached, so the clarifying question can name the actual options |
| Resolved slice would still exceed the token ceiling (e.g. a section with an unusually large number of blocks) | Slice is truncated to the most relevant block entries by the same relevance score used to resolve the target, rather than the request being rejected outright |
| Catalog release changes mid-conversation | Catalog-scoped caches invalidate; the next turn re-resolves targets against the new catalog index, and the user is informed if a previously-resolved section type no longer exists |
| Store Configuration edited mid-conversation | The cached slice for the affected section is invalidated; the next turn re-fetches current settings rather than reasoning over stale values |

## 6. Clarification System

Every request, after intent understanding and context resolution, is scored against a fixed set of detection
signals and routed to exactly one of five outcomes before any operation is finalized for presentation. This
is the gatekeeper between "the AI understood something" and "the AI is allowed to act on it," and it applies
identically to Flow A and Flow B.

### 6.1 The five outcomes

| # | Outcome | What the user sees |
|---|---|---|
| 1 | Execute immediately | The change happens; a lightweight confirmation/diff toast is shown after the fact |
| 2 | Ask clarification | A targeted question, optionally with suggested answers, before anything is planned |
| 3 | Show proposed plan | A full `OperationPlan` rendered for review, not yet applied |
| 4 | Require explicit confirmation | Like #3, but at least one step is flagged and requires its own individual acknowledgment before it can be included in the apply action |
| 5 | Refuse — unsupported | A clear explanation of why the request can't be fulfilled, and, where possible, what would need to change for it to become possible |

### 6.2 Detection signals

| Signal | Example |
|---|---|
| Missing information | "Change the hero button" — to what? No target attribute or value given. |
| Ambiguous target | "Make the header better" could mean the header section or the announcement bar. |
| Multiple valid interpretations | "Make it pop" against a section with both color and size levers, no clear signal which. |
| Destructive / high-blast-radius operation | `riskLevel: "destructive"` — assigned when an operation removes content, affects many sections/pages at once, or would overwrite `"user"`-provenance settings (§7). |
| Missing assets | "Add our team photo" with no resolvable asset reference and no generation intent. |
| Missing capability | The catalog cannot express the requested capability at all — as opposed to needing a setting the section already has. |
| Requires content generation beyond the request's own information | Any request needing AI to author new copy rather than place copy the user supplied. |
| Multi-step | More than one operation required to satisfy the request. |

A single request can raise more than one signal at once (e.g. multi-step *and* one destructive step); the
decision table below resolves precedence for that case.

### 6.3 Decision table

Evaluated top to bottom; a request routes to the first matching row.

| Precedence | Condition | Outcome |
|---|---|---|
| 1 | Missing capability, and no reasonably close catalog alternative exists | Refuse — unsupported |
| 2 | Missing information, OR ambiguous target, OR multiple valid interpretations, OR missing assets with no generation intent | Ask clarification |
| 3 | Any resolved operation has `riskLevel: "destructive"` | Require explicit confirmation |
| 4 | Multi-step (`OperationPlan` with ≥2 steps), OR any step is `generate_copy`, OR any step has `riskLevel: "review"` | Show proposed plan |
| 5 | Single operation, fully specified, `riskLevel: "safe"`, not `generate_copy` | Execute immediately |

An unsupportable request never proceeds to planning at all (checked first). An ambiguous or underspecified
request is never planned around a guess (checked second). A destructive operation always earns its own
explicit confirmation regardless of how simple or well-specified it otherwise is (checked third) — this is
the check that protects a merchant's hand-edited settings from a regeneration pass. Only once none of the
above apply does the system fall through to the ordinary complexity split between "show the plan" and "just
do it."

### 6.4 Worked examples

- **"Make the hero section background dark blue"** — target, attribute, and value all resolve uniquely, no
  destructive risk, single operation → **execute immediately**.
- **"Make the header better"** — "better" carries no attribute or action hint (missing information), and the
  fallback may return multiple section candidates for "header" (ambiguous target) → **ask clarification**,
  e.g. *"Happy to help with the header — did you mean the main header, or the announcement bar above it? And
  what would you like improved — layout, colors, sizing, or something else?"* with confident candidates
  offered as quick-pick options.
- **"Make my homepage more premium"** — no single target resolves; this routes through the style-token
  fallback (§5.3), which resolves candidate levers (spacing, typography scale, button style, color contrast)
  across the page — inherently multi-step, but a reasonable default interpretation can be planned → **show
  proposed plan**, stating its interpretation of "premium" as the plan's rationale header so the user can
  correct it before approving. If the fallback's match confidence is genuinely low, this degrades to **ask
  clarification** instead.
- **"Delete all sections from my homepage and start over"** — resolves cleanly, no ambiguity, but is
  unambiguously destructive (removes every section, some possibly `"user"`-provenance) → **require explicit
  confirmation**, with each removal individually flagged and a snapshot guaranteed before execution.
- **"Add real customer reviews to my product page"** — the catalog has a reviews-capable section, but the
  request asks for *real* review content, which is third-party data no `generate_copy` call can produce, and
  fabricating placeholder testimonials as "real reviews" would misrepresent the store → **refuse —
  unsupported**, with a constructive alternative offered (a testimonials section using the merchant's own
  copy) — offered, never substituted automatically.

### 6.5 Interaction with the Gateway

Clarification detection runs at `fast` tier as a structured-output classification pass over the resolved
intent and candidate operations; phrasing the clarifying question, plan rationale, or refusal explanation
runs at `standard` tier — the only place the Clarification System generates user-facing prose. It never emits
or modifies a Store Configuration itself; it only routes. Every clarifying question and its answer persists
in conversation history, and a clarification round-trip narrows the pipeline rather than restarting it from
scratch.

### 6.6 Design bias

The system deliberately biases toward asking (outcome 2) over executing (outcome 1): an unnecessary
clarifying question costs one extra reply, while an incorrect silent execution costs trust and requires an
undo. It biases toward explicit confirmation (outcome 4) over plan preview (outcome 3) for anything touching
`riskLevel: "destructive"` for the same reason, doubled — the [Diff/undo/snapshot model](18-versioning-and-undo-redo.md)
reduces the cost of getting this wrong, but explicit confirmation is the first line of defense. Refusal
(outcome 5) is reserved narrowly, for capability gaps the fixed catalog genuinely cannot close — it is not an
escape hatch for requests that are merely complex; complex-but-buildable requests belong in outcomes 3/4.

## 7. Provenance-Aware Regeneration

Regeneration — re-running AI generation or content authoring over a section or a store after a merchant has
already hand-edited some of it — must never blindly overwrite the merchant's own changes. Every field is
tagged with its authorship, carried directly on the Store Configuration:

```
SectionProvenance {
  section: "ai" | "user"                            // was this SectionInstance added by AI, or by a direct user action?
  settings: { [settingId: string]: "ai" | "user" }   // per-setting authorship; unlisted keys inherit `section`
}
```

### 7.1 Rules

- **Authorship, not approval.** Approving a plan (outcomes 3/4, §6) does not change provenance — the value
  was still authored by AI; the merchant only consented to apply it. Provenance flips to `"user"` only when
  the merchant directly edits a value in the Visual Editor.
- **Regeneration only touches `"ai"`-provenance fields by default.** A "regenerate this section" action
  re-runs `generate_copy`/`set_setting` only against settings currently marked `"ai"`. Settings marked
  `"user"` are skipped, and the regeneration's diff explicitly reports how many fields were preserved because
  the merchant had edited them.
- **User edits after generation** are handled through the same Store Configuration mutation path the Visual
  Editor always uses — touched settings flip to `"user"` provenance. There is no separate AI write path
  distinct from the editor's write path.

### 7.2 Full/forced regeneration override

A merchant can request "regenerate everything, including my edits." This is a distinct, opt-in action —
`overrideUserEdits: true` on `regenerate_section`/`regenerate_page` (§4.1) — never a default. Any operation
that would overwrite or remove `"user"`-provenance content under this override is escalated to at least
`riskLevel: "review"`, and to `"destructive"` for a removal, regardless of that operation type's ordinary
default `riskLevel`. This is what feeds the Clarification System's destructive/high-blast-radius signal
(§6.2) for bulk regeneration specifically, so an override request always routes through outcome 4 (require
explicit confirmation) at minimum.

**MVP status:** the default, non-overriding regeneration behavior (§7.1) ships in MVP. The
`overrideUserEdits: true` variant — forced regeneration over manual edits — is **deferred post-MVP**, along
with bulk whole-page regeneration (`regenerate_page`) generally. See [MVP Scope](24-mvp-scope.md).
