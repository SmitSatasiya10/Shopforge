# 13 — Clarification System

## 1. Purpose

**Ask instead of guessing** is only meaningful if there's a precise, deterministic-as-possible answer to "ask about what, and when." This document defines the detection signals and the resulting decision logic that routes every AI request to exactly one of five outcomes, and gives worked examples for each.

This system sits downstream of intent understanding and section/settings lookup (doc 11) and context resolution (doc 12), and upstream of execution. It is the gatekeeper between "the AI understood something" and "the AI is allowed to act on it." Its core logic is unchanged by the shift to a fixed Section catalog and Store Configuration — ambiguous requests still need to be disambiguated rather than guessed at — but the *signals* it detects are now about a small, known catalog and a Store Configuration the merchant is actively editing, not about parsing an unknown theme.

## 2. The five outcomes

| # | Outcome | What the user sees |
|---|---|---|
| 1 | **Execute immediately** | The change happens; a lightweight confirmation/diff toast is shown after the fact (doc 11 §12, "inline apply") |
| 2 | **Ask clarification** | A targeted question, optionally with suggested answers, before anything is planned |
| 3 | **Show proposed plan** | A full `OperationPlan` (doc 11 §3.4) rendered for review, not yet applied |
| 4 | **Require explicit confirmation** | Like #3, but at least one step is flagged and requires its own individual acknowledgment before it can be included in the apply action |
| 5 | **Refuse — unsupported** | A clear explanation of why the request can't be fulfilled, and (where possible) what would need to change for it to become possible |

These map directly onto the confirmation UX hook points already defined in doc 11 §12 — this document defines the *trigger conditions* that route a request to each hook point; doc 11 defines the mechanics of the hook points themselves.

## 3. Detection signals

Each incoming request, after intent understanding and context resolution (docs 11–12), is scored against the following signals before any `Operation`/`OperationPlan` is finalized for presentation:

| Signal | Detected by | Example |
|---|---|---|
| **Missing information** | Required parameter for the resolved `SettingDef`/operation type has no value and no default the user implied | "Change the hero button" — to what? no target attribute or value given |
| **Ambiguous target** | Context Selector (doc 12 §2.3/§7) returns multiple high-confidence candidate sections/settings | "Make the header better" could mean the header section or the announcement bar, or both |
| **Multiple valid interpretations** | A single resolved target has more than one plausible attribute/action reading with comparable confidence | "Make it pop" against a section with both color and size levers, no clear signal which |
| **Destructive / high-blast-radius operation** | `Operation.riskLevel === "destructive"` — assigned when the operation removes content, affects many sections/pages at once, or would overwrite `"user"`-provenance settings a merchant has already hand-edited (doc 11 §9) | "Redo my whole homepage," `remove_section` on a section the merchant has customized |
| **Missing assets** | Request implies media the store doesn't have and the request didn't supply (e.g. "add our team photo") | No asset reference resolvable, and no generation intent expressed |
| **Missing capability** | The requested capability isn't something the fixed Section catalog can express at all (doc 11 §8.3) — as opposed to needing a setting the section already has — e.g. requests that assume real third-party data no section can supply, or a content type genuinely outside the ~40–60 section types | "Add real customer reviews" when no reviews app is connected; "add a live countdown timer" when no such section exists in the catalog |
| **Requires content generation beyond the request's own information** | `Operation.type === "generate_copy"` (doc 11 §3.3) where the request gave no concrete text to work from | Any request needing the AI to author new copy rather than place copy the user supplied |
| **Multi-step** | More than one `Operation` required to satisfy the request | The FAQ-plus-reorder example (doc 11 §7) |

A single request can raise more than one signal simultaneously (e.g. multi-step **and** contains one destructive step) — §4's decision table resolves precedence for that case.

## 4. Decision table

Signals are evaluated in this precedence order — a request routes to the **first** matching row, top to bottom:

| Precedence | Condition | Outcome |
|---|---|---|
| 1 | Missing capability, and no reasonably close catalog alternative exists (doc 11 §8.3) | **Refuse — unsupported** |
| 2 | Missing information, OR ambiguous target, OR multiple valid interpretations, OR missing assets with no generation intent | **Ask clarification** |
| 3 | Any resolved operation has `riskLevel: "destructive"` | **Require explicit confirmation** (even if it's otherwise a single, unambiguous, well-specified operation) |
| 4 | Multi-step (`OperationPlan` with ≥2 steps), OR any step has `type: "generate_copy"`, OR any step has `riskLevel: "review"` | **Show proposed plan** |
| 5 | Single operation, fully specified, `riskLevel: "safe"`, not `generate_copy` | **Execute immediately** |

Rationale for the ordering: an unsupportable request should never proceed to planning at all (checked first). An ambiguous or underspecified request should never be planned around a guess — better to ask before spending any planning effort (checked second). A destructive operation always earns its own explicit confirmation regardless of how simple or well-specified it otherwise is (checked third) — clarity of intent does not reduce blast radius, and this is exactly the check that protects a merchant's hand-edited settings from an AI regeneration pass (doc 11 §9). Only once none of the above apply does the system fall through to the ordinary complexity-based split between "just show me the plan" and "just do it" (rows 4–5).

## 5. Worked examples

### 5.1 "Make the hero section background dark blue"
- Target resolves uniquely (single `hero-1` instance on the `home` page), attribute resolves uniquely (`background_color`, `type: "color"`), value resolves unambiguously ("dark blue" → a concrete hex).
- No destructive risk, not a `generate_copy` step, single operation.
- **Outcome: execute immediately.** (Parallel full trace for "make the hero heading bigger": doc 11 §6.)

### 5.2 "Make the header better"
- "Better" carries no attribute or action hint at all — this is not just vague, it's genuinely missing information (what dimension of "better"?).
- Additionally, doc 12 §2.3's lightweight fallback may return multiple section candidates for "header" (a header section vs. an announcement-bar section) — an ambiguous target on top of missing information.
- **Outcome: ask clarification.** A concrete clarifying question surfaces both problems at once rather than two round-trips: *"Happy to help with the header — a couple of things first: did you mean the main header, or the announcement bar above it? And what would you like improved — layout, colors, sizing, or something else?"* Where the Context Selector has confident candidates, they're offered as quick-pick options rather than forcing free-text.

### 5.3 "Make my homepage more premium"
- No single target resolves — "homepage" is page-scoped, not section-scoped, and "premium" is a style adjective, not a named attribute.
- Per doc 12 §2.3, this routes through the lightweight style-token fallback: the Context Selector resolves candidate levers (spacing, typography scale, button style, color contrast) across the `home` page's sections — this is inherently multi-step (several structural levers) and does not rise to "missing information" in the same way as 5.2, because a reasonable default interpretation *can* be planned (increase spacing, refine typography scale, softer button styling), it's just multi-step.
- No destructive step, no `generate_copy` needed in the common case (all resolved levers are existing `SettingDef`s within already-placed sections).
- **Outcome: show proposed plan.** The plan explicitly states its interpretation of "premium" as its rationale header (e.g. *"Interpreting 'premium' as: more generous spacing, refined typography scale, softer button styling — 4 structural changes across your homepage, no new content."*) so the user can correct the interpretation before approving, rather than the system silently guessing and applying.
- Note: if the lightweight fallback's style-token match comes back with genuinely low confidence, this degrades to **ask clarification** instead — asking what specifically the user wants elevated (imagery, colors, typography, spacing) — per row 2 of §4.

### 5.4 "Delete all sections from my homepage and start over"
- Resolves cleanly (no ambiguity, no missing information) — but is unambiguously destructive: it removes every section on the page in one action, several of which may carry `"user"`-provenance content (doc 11 §9) the merchant has already customized.
- `Operation.riskLevel: "destructive"` on the resulting `remove_section` operations.
- **Outcome: require explicit confirmation.** Even though the request is perfectly clear, each removal is individually flagged, a snapshot is guaranteed before execution (doc 14), and the user must explicitly acknowledge the destructive step(s) — not just approve a plan in one click the way example 5.3's plan can be.

### 5.5 "Add real customer reviews to my product page"
- The catalog's reviews-capable section requires a connected reviews-app data source to display real content, and this merchant's store has none connected.
- Crucially, this is not a "no matching section" gap — the catalog does have a section built for this. It's that the request asks for **real** review content, which is third-party data no `generate_copy` call can produce. Authoring a fake reviews section with placeholder testimonials would misrepresent the store.
- **Outcome: refuse — unsupported**, with constructive next steps: *"Shopforge can't display real customer reviews without a reviews app connected to your store — I can't fabricate review content. If you connect a reviews app, I can place and style a reviews section around its data. In the meantime, I can add a testimonials section using your own copy if that helps."* This is the refusal path offering a legitimate adjacent alternative rather than a dead end — but the alternative is only ever offered, never substituted automatically.

## 6. Interaction with the AI Gateway and Operation Planner

- Clarification detection runs primarily at `fast` tier (doc 10 §4) as a structured-output classification pass: given the resolved intent + candidate operations from the Operation Planner (doc 11 — AI Generation & Editing Operation System), decide which of the five outcomes applies, following §4's precedence table.
- Phrasing the actual clarifying question, plan rationale, or refusal explanation runs at `standard` tier — this is the only place the Clarification System generates user-facing prose, and it never emits or modifies a Store Configuration itself; it only routes.
- Every clarifying question and its eventual answer is persisted as `AIMessage` entries on the `AIConversation` (doc 17), and the answer is fed back through intent understanding (doc 11 §6.1-style stage 1) as additional context for target/attribute resolution — a clarification round-trip does not restart the pipeline from scratch, it narrows it.
- The `/ai/clarify-answer` endpoint (architecture core §6) is the API surface a clarification response comes back through; it resumes the same conversation/operation-planning context rather than opening a new one.
- This routing applies identically to both flows doc 11 defines: a Flow A generation plan that turns out ambiguous (rare, since Product Data plus the catalog usually resolves cleanly) and a Flow B conversational edit both pass through the same five-outcome decision table.

## 7. Design notes on false positives/negatives

- Biasing toward **outcome 2 (ask)** over **outcome 1 (execute)** is intentional — an unnecessary clarifying question costs the user one extra reply; an incorrect silent execution costs trust and requires an undo. The detection thresholds in doc 12 (§2.3 confidence thresholds) are tuned accordingly.
- Biasing toward **outcome 4 (explicit confirmation)** over **outcome 3 (plan preview)** for anything touching `riskLevel: "destructive"` is intentional for the same reason, doubled — reversibility (doc 14's diff/undo/snapshot model) reduces the cost of getting this wrong, but explicit confirmation is the first line of defense, snapshot/undo is the second.
- **Outcome 5 (refuse)** is reserved narrowly — for capability gaps the fixed catalog genuinely cannot close (missing third-party data, a content type outside the ~40–60 section types) — specifically so it isn't overused as an escape hatch for requests that are merely complex. Complex-but-buildable requests belong in outcome 3/4, not outcome 5. Because the catalog is fixed and known, this outcome should in practice be rarer than it was against an unknown theme — most requests resolve to *something* in the catalog; genuine refusals are the exception, not a routine fallback.
