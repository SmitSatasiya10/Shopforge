# Phase 09 — AI Generation

## Objective

Generate a full Store Configuration from imported product data, and support conversational editing — with AI
writing only structured configuration/content through the identical mutation and validation path Phase 07
already proved for manual edits. This phase does not start until the deterministic pipeline (Phases 01-08) is
solid, per [`docs/product-spec/DECISIONS.md`](../product-spec/DECISIONS.md) and the "build incrementally"
principle repeated throughout this roadmap.

## Scope

- Flow A (initial generation): Normalized Product (Phase 03) → AI (section selection → section ordering →
  section settings → content generation) → `OperationPlan` → Store Configuration (Phase 04's schema).
- Flow B (conversational editing): a natural-language edit request resolved into one or more `Operation`s
  against the existing Store Configuration, through the same path.
- The allowed AI operation vocabulary: `add_section`, `remove_section`, `reorder_section`, `duplicate_section`,
  `add_block`, `remove_block`, `reorder_block`, `set_setting`, `set_block_setting`, `set_content`,
  `set_global_style`, `generate_copy` — per
  [`docs/product-spec/04-ai-architecture.md`](../product-spec/04-ai-architecture.md).
- Structured-output enforcement: every AI response is forced schema-conformant `Operation`/`OperationPlan` JSON,
  validated as data (setting type/range/enum, content-length/moderation), never treated as code.
- The five-outcome Clarification System: execute immediately / ask clarification / show proposed plan / require
  explicit confirmation / refuse-unsupported — gating every request before an operation is finalized.
- Provenance tracking: `SectionProvenance { section: "ai"|"user", settings: { [id]: "ai"|"user" } }`. Approving
  a plan doesn't change provenance; it flips to `"user"` only on direct merchant edit.
- Default-safe regeneration: touches only `"ai"`-provenance fields by default; `"user"`-provenance fields are
  skipped and reported preserved.
- Retry/failure handling per
  [`docs/product-spec/04-ai-architecture.md`](../product-spec/04-ai-architecture.md): transient error → backoff
  retry (same provider); rate limit → immediate fallback in the tier chain; schema violation → one repair
  re-prompt, else typed error; content refusal → no retry, surfaces as unsupported; budget exceeded → typed
  error, never silent downgrade.
- Cost control: `modelTier` routing, per-request and org-level budgets, exact-match + semantic caching
  (`generate_copy` never cached), narrowly-scoped context assembly (not the full catalog on every request).
- One AI provider wired up live, behind a provider-abstraction built for multiple (per MVP scope).

## Out of Scope

- AI generating Liquid, HTML, CSS, or JavaScript — never in scope, at any phase, permanently (not a deferred
  item — see [`docs/product-spec/DECISIONS.md`](../product-spec/DECISIONS.md) #4).
- AI authoring or modifying Section Library files — Phase 08 owns that, exclusively human-reviewed.
- `generate_image`, `regenerate_section`, `regenerate_page`, and the `overrideUserEdits: true` regeneration
  variant — all explicitly deferred post-MVP.
- Multiple simultaneously-live AI providers — the abstraction is built now, only one provider is wired up.
- The durable, versioned persistence of AI-produced `Diff`/`StoreConfigVersion` history at scale — Phase 09
  writes through Phase 07's mutation path; Phase 10 formalizes the durable version lineage this phase's output
  lives in long-term.

## Architecture

```text
Product (Phase 03) --\
                       AI (structured output) -> OperationPlan -> Validation (Phase 04/13) -> Store Configuration
Conversational edit --/                                                              |
                                                                              LiquidJS rerender (Phase 06)
```

AI and the manual editor (Phase 07) are two producers writing through one identical consumer path — there is no
separate "AI write path." This is why Phase 07's undo/redo and validation had to be solid before this phase
starts: AI immediately inherits whatever correctness or gaps exist in that shared path, at much higher volume
and with less predictable input than manual edits produce.

## Inputs

A Normalized Product Contract (Phase 03), the current Store Configuration (Phase 04/07), and `catalog.json`
(Phase 08) to ground what sections/settings AI is allowed to reference.

## Outputs

A validated `OperationPlan` applied to the Store Configuration (Flow A: a full initial configuration; Flow B: an
incremental edit), each field tagged with provenance.

## Dependencies

Phase 04 (the configuration schema AI writes into), Phase 07 (the mutation/validation/undo path AI writes
through — must already work for manual edits), Phase 08 (`catalog.json`, the ground truth for what sections/
settings exist).

## Implementation Areas

- Provider abstraction (`AIRequest`/`AIResponse` envelope: capability, modelTier, budget, responseSchema) with
  one concrete provider implementation.
- Context Selector: assembles a narrowly-scoped context per request (e.g., ~300 tokens for a single-setting
  edit) rather than sending the full catalog every time.
- `Operation`/`OperationPlan` executor: applies a validated plan atomically — per
  [`docs/product-spec/18-versioning-and-undo-redo.md`](../product-spec/18-versioning-and-undo-redo.md), one plan
  execution is one transaction, one Diff, one undo unit.
- Clarification System: the five-outcome decision gate, biased toward asking and toward explicit confirmation
  for destructive operations.
- Provenance tagging, threaded through every write path (both AI and manual, since both share the mutation
  path).
- Regeneration logic respecting provenance by default, with the manual-override variant left unbuilt (deferred).
- Cost/budget enforcement: `modelTier` routing table, per-request `budget.maxCreditCost`, org-level spend
  guards, exact-match cache, semantic/embedding cache (style-token fallback only, not `generate_copy`).
- Retry/failure handling exactly as specified above, including the circuit breaker when all providers in a tier
  chain are exhausted.
- `AIUsageEvent` tracking (usage/credit ledger from day one, even against a single free+flat billing tier at
  MVP).

## Data Contracts

```text
AIRequest { capability, modelTier, budget: { maxCreditCost }, responseSchema, context }
Operation { opId, type, target, payload, riskLevel, estimatedCreditCost }
OperationPlan { planId, storeConfigId, steps: Operation[], overallRiskSummary, totalEstimatedCreditCost }
SectionProvenance { section: "ai" | "user", settings: { [settingId: string]: "ai" | "user" } }
```

Full authoritative shapes, including `GenerationJob` and `AIUsageEvent`:
[`docs/product-spec/04-ai-architecture.md`](../product-spec/04-ai-architecture.md).

## User Flow

**Flow A — initial generation:**
```text
Product imported (Phase 02/03)
  |
AI selects sections, orders them, configures settings, writes copy
  |
OperationPlan validated and applied
  |
Store Configuration populated, every field tagged provenance: "ai"
  |
Preview renders (Phase 06) the AI-generated storefront
```

**Flow B — conversational editing:**
```text
User types a natural-language edit request
  |
AI resolves it to one or more Operations
  |
Clarification System decides: execute / ask / show plan / confirm / refuse
  |
On execute: OperationPlan validated and applied, same path as Flow A
  |
Preview rerenders; edited fields flip provenance to "ai" only where AI actually wrote them
```

## Error Handling

- Every retry/fallback/circuit-breaker behavior specified in Scope above is this phase's error-handling
  contract — not aspirational, required for completion.
- A schema-violating AI response gets exactly one automatic repair re-prompt before surfacing a typed error —
  never silently retried indefinitely, never silently coerced into something schema-valid but wrong.
- Flow A partial failure: successful fields are kept, failed fields get placeholder defaults explicitly marked
  as needing content — the pipeline never fails all-or-nothing on a partial content-generation failure. A full
  pipeline failure persists nothing.
- Untrusted product-URL content (Phase 02's scraped data) is wrapped in delimited context blocks, never
  concatenated directly into system prompts — this phase's primary prompt-injection defense, detailed further
  in Phase 14.
- A validation failure on AI output (Phase 04/13's layers 3-6) triggers exactly one automatic AI retry with the
  specific failure fed back as context; a second failure surfaces a Clarification to the merchant rather than
  looping — per [`docs/product-spec/17-validation-and-error-handling.md`](../product-spec/17-validation-and-error-handling.md).

## Testing

Per [`docs/product-spec/23-testing-strategy.md`](../product-spec/23-testing-strategy.md), these are release
gates, not optional coverage:

- **Regeneration-preserves-user-edits** (hard release gate): a regeneration request never overwrites a
  `"user"`-provenance field.
- **Hallucination resistance** (hard release gate): AI never references a section type or setting that doesn't
  exist in `catalog.json`.
- **Ambiguous-prompt suite**: false-execution rate < 5%, false-clarification rate < 15% (hard CI thresholds).
- **Section-selection accuracy**: top-1 accuracy ≥ 95%, tracked per section type, both generation-time and
  edit-time.
- **Token usage budget assertions**: context recall ≥ 99% for edit-time context (the narrow-context assembly
  must not silently drop what it needs).
- Rerun the AI-specific suite on every prompt/model/planner change, and nightly regardless.
- No test in this suite may involve AI generating Liquid/HTML/CSS/JS — there is no code path capable of that to
  test in the first place; a test asserting this absence is itself part of the regression gate (see Phase 13).

## Completion Criteria

- Flow A produces a complete, valid, rendering Store Configuration from a real imported product, with no manual
  intervention.
- Flow B correctly resolves a representative set of natural-language edit requests through the Clarification
  System to the correct outcome.
- Provenance tagging is accurate across a generate → manual-edit → regenerate sequence, with user edits
  preserved.
- All Phase 09 release-gate tests (regeneration-preserves-edits, hallucination resistance, ambiguous-prompt
  thresholds) pass.
- Retry/fallback/circuit-breaker behavior is exercised and correct under simulated provider failure.

## Next Phase

[10 — Persistence and Projects](10-persistence-and-projects.md) formalizes the durable, versioned home for
everything this phase (and Phase 07) has been writing — full `StoreConfigVersion` lineage, `Diff` history at
scale, and multi-project/multi-tenant ownership boundaries.
