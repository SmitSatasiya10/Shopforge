# 13 — Clarification System

## 1. Purpose

**Principle 4 — ask instead of guessing** — is only meaningful if there's a precise, deterministic-as-possible answer to "ask about what, and when." This document defines the detection signals and the resulting decision logic that routes every AI request to exactly one of five outcomes, and gives worked examples for each.

This system sits downstream of intent understanding and capability lookup (doc 11) and context resolution (doc 12), and upstream of execution. It is the gatekeeper between "the AI understood something" and "the AI is allowed to act on it."

## 2. The five outcomes

| # | Outcome | What the user sees |
|---|---|---|
| 1 | **Execute immediately** | The change happens; a lightweight confirmation/diff toast is shown after the fact (doc 11 §7, "inline apply") |
| 2 | **Ask clarification** | A targeted question, optionally with suggested answers, before anything is planned |
| 3 | **Show proposed plan** | A full `OperationPlan` (doc 11 §6) rendered for review, not yet applied |
| 4 | **Require explicit confirmation** | Like #3, but at least one step is flagged and requires its own individual acknowledgment before it can be included in the apply action |
| 5 | **Refuse — unsupported** | A clear explanation of why the request can't be fulfilled, and (where possible) what would need to change for it to become possible |

These map directly onto the confirmation UX hook points already defined in doc 11 §7 — this document defines the *trigger conditions* that route a request to each hook point; doc 11 defines the mechanics of the hook points themselves.

## 3. Detection signals

Each incoming request, after intent understanding and context resolution (docs 11–12), is scored against the following signals before any `Operation`/`OperationPlan` is finalized for presentation:

| Signal | Detected by | Example |
|---|---|---|
| **Missing information** | Required parameter for the resolved `SettingDef`/operation type has no value and no default the user implied | "Change the hero button" — to what? no target attribute or value given |
| **Ambiguous target** | Context Selector (doc 12 §2.3/§7) returns multiple high-confidence candidate sections/settings | "Make the header better" could mean the section-group header, an announcement bar, or both |
| **Multiple valid interpretations** | A single resolved target has more than one plausible attribute/action reading with comparable confidence | "Make it pop" against a section with both color and size levers, no clear signal which |
| **Destructive / high-blast-radius operation** | `Operation.riskLevel === "destructive"` — assigned when the operation removes content, affects many templates at once, or overwrites something the user has manually customized | "Redo my whole homepage," `remove_section` on a section with merchant-authored content in its blocks |
| **Missing assets** | Request implies media the theme/store doesn't have and the request didn't supply (e.g. "add our team photo") | No asset reference resolvable, and no generation intent expressed |
| **Missing Shopify capability** | Doc 11 §5.3 fallback triggers *and* the requested capability isn't something Shopify/Liquid can express at all (as opposed to just needing new code) — e.g. requests that assume real-time inventory sync behavior no theme code can provide, or genuine third-party data (real review content) that only an app integration can supply | "Add real customer reviews" when no reviews app is installed — generating fake review content would be actively harmful |
| **Requires new code** | `Operation.requiresNewCode === true` from doc 11 §5.3 | Any `create_section_file`/`modify_liquid`/`modify_css`/`modify_js` |
| **Multi-step** | More than one `Operation` required to satisfy the request | The premium product page example (doc 11 §4) |

A single request can raise more than one signal simultaneously (e.g. multi-step **and** contains one destructive step) — §4's decision table resolves precedence for that case.

## 4. Decision table

Signals are evaluated in this precedence order — a request routes to the **first** matching row, top to bottom:

| Precedence | Condition | Outcome |
|---|---|---|
| 1 | Missing Shopify capability, and no reasonable generative fallback exists (e.g. requires real third-party data, or behavior Liquid/Shopify genuinely cannot express) | **Refuse — unsupported** |
| 2 | Missing information, OR ambiguous target, OR multiple valid interpretations, OR missing assets with no generation intent | **Ask clarification** |
| 3 | Any resolved operation has `riskLevel: "destructive"` | **Require explicit confirmation** (even if it's otherwise a single, unambiguous, well-specified operation) |
| 4 | Multi-step (`OperationPlan` with ≥2 steps), OR any step has `requiresNewCode: true`, OR any step has `riskLevel: "review"` | **Show proposed plan** |
| 5 | Single operation, fully specified, `riskLevel: "safe"`, `requiresNewCode: false` | **Execute immediately** |

Rationale for the ordering: an unsupportable request should never proceed to planning at all (checked first). An ambiguous or underspecified request should never be planned around a guess — better to ask before spending any planning effort (checked second). A destructive operation always earns its own explicit confirmation regardless of how simple or well-specified it otherwise is (checked third) — clarity of intent does not reduce blast radius. Only once none of the above apply does the system fall through to the ordinary complexity-based split between "just show me the plan" and "just do it" (rows 4–5).

## 5. Worked examples

### 5.1 "Make the hero section background dark blue"
- Target resolves uniquely (single `hero-1` instance on `index`), attribute resolves uniquely (`background_color`, `type: "color"`), value resolves unambiguously ("dark blue" → a concrete hex).
- No destructive risk, no new code, single operation.
- **Outcome: execute immediately.** (Full trace in doc 11 §3.)

### 5.2 "Make the header better"
- "Better" carries no attribute or action hint at all — this is not just vague, it's genuinely missing information (what dimension of "better"?).
- Additionally, doc 12 §2.3's semantic search may return multiple section candidates for "header" (section-group header vs. announcement bar) — an ambiguous target on top of missing information.
- **Outcome: ask clarification.** A concrete clarifying question surfaces both problems at once rather than two round-trips: *"Happy to help with the header — a couple of things first: did you mean the main site header, or the announcement bar above it? And what would you like improved — layout, colors, sizing, or something else?"* Where the Context Selector has confident candidates, they're offered as quick-pick options rather than forcing free-text.

### 5.3 "Make my homepage more premium"
- No single target resolves — "homepage" is template-scoped, not section-scoped, and "premium" is a style adjective, not a named attribute.
- Per doc 12 §2.3, this routes through the style-token fallback: the Context Selector resolves candidate levers (spacing, typography scale, button style, color contrast) across the `index` template's sections plus `GlobalStyles` — this is inherently multi-step (several structural levers) and does not rise to "missing information" in the same way as 5.2, because a reasonable default interpretation *can* be planned (increase spacing, refine typography scale, softer/more consistent button styling), it's just multi-step.
- No destructive step, no new code required (all resolved levers are existing `SettingDef`s/`GlobalStyles` fields) in the common case.
- **Outcome: show proposed plan.** The plan explicitly states its interpretation of "premium" as its rationale header (e.g. *"Interpreting 'premium' as: more generous spacing, refined typography scale, softer button styling — 4 structural changes across your homepage, no new code."*) so the user can correct the interpretation before approving, rather than the system silently guessing and applying.
- Note: if the Context Selector's style-token match comes back with genuinely low confidence (theme's `GlobalStyles`/settings are too sparse to express typical "premium" levers), this degrades to **ask clarification** instead — asking what specifically the user wants elevated (imagery, colors, typography, spacing) — per row 2 of §4.

### 5.4 "Delete all sections from my homepage and start over"
- Resolves cleanly (no ambiguity, no missing information) — but is unambiguously destructive: it removes an unbounded number of sections, several likely containing merchant-authored content, in one action.
- `Operation.riskLevel: "destructive"` on the resulting `remove_section` operations.
- **Outcome: require explicit confirmation.** Even though the request is perfectly clear, each removal is individually flagged, a `ThemeSnapshot` is guaranteed before execution (Principle 6), and the user must explicitly acknowledge the destructive step(s) — not just approve a plan in one click the way example 5.3's plan can be.

### 5.5 "Add real customer reviews to my product page"
- The theme has no reviews app installed and no review data source connected — the Manifest shows `capabilities.hasReviewsSection: false` and no app-block slot suited to reviews.
- Crucially, this is not a "no matching section" gap that generation can close (per doc 11 §5.3) — the request asks for **real** review content, which is third-party data no amount of generated Liquid/CSS can produce. Generating a fake reviews section with placeholder testimonials would misrepresent the store.
- **Outcome: refuse — unsupported**, with constructive next steps: *"Shopforge can't display real customer reviews without a reviews app connected to your store — I can't fabricate review content. If you install a reviews app (or if you already have one, let me know which), I can build a section styled to match your theme that displays its data. In the meantime, I can add a benefits/testimonials section using your own copy if that helps."* This is the refusal path offering a legitimate adjacent alternative rather than a dead end — but the alternative is only ever offered, never substituted automatically.

## 6. Interaction with the AI Gateway and Operation Planner

- Clarification detection runs primarily at `fast` tier (doc 10 §4) as a structured-output classification pass: given the resolved intent + candidate operations from the Operation Planner (doc 11), decide which of the five outcomes applies, following §4's precedence table.
- Phrasing the actual clarifying question, plan rationale, or refusal explanation runs at `standard` tier — this is the only place the Clarification System generates user-facing prose, and it never generates or modifies theme code itself.
- Every clarifying question and its eventual answer is persisted as `AIMessage` entries on the `AIConversation` (doc 17), and the answer is fed back through intent understanding (doc 11 §2 stage 1) as additional context for target/attribute resolution — a clarification round-trip does not restart the pipeline from scratch, it narrows it.
- The `/ai/clarify-answer` endpoint (architecture core §6) is the API surface a clarification response comes back through; it resumes the same conversation/operation-planning context rather than opening a new one.

## 7. Design notes on false positives/negatives

- Biasing toward **outcome 2 (ask)** over **outcome 1 (execute)** is intentional and directly implements Principle 4 — an unnecessary clarifying question costs the user one extra reply; an incorrect silent execution costs trust and requires an undo. The detection thresholds in doc 12 (§2.3 confidence thresholds) are tuned accordingly.
- Biasing toward **outcome 4 (explicit confirmation)** over **outcome 3 (plan preview)** for anything touching `riskLevel: "destructive"` is intentional for the same reason, doubled — Principle 6 (everything is reversible) reduces the cost of getting this wrong, but explicit confirmation is the first line of defense, snapshot/undo is the second.
- **Outcome 5 (refuse)** is reserved narrowly — for capability gaps that generation genuinely cannot close (missing third-party data, behavior outside Liquid/Shopify's model) — specifically so it isn't overused as an escape hatch for requests that are merely complex. Complex-but-buildable requests belong in outcome 3/4, not outcome 5.
