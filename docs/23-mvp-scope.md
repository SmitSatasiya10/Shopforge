# 23 — MVP Scope

## 1. Framing

The MVP is not "as many Dropmagic features as we can clone." It is the smallest slice of Shopforge that proves the one claim no competitor makes today (doc 03 §4.7): **an AI that reads a merchant's real, existing theme, understands what it can already do, and makes the smallest sufficient change — asking before guessing, and leaving a reversible trail.**

Two facts from research gate everything below and are treated as load-bearing, not background:

1. **The `write_themes` exemption** (doc 16 §10) — Shopforge's core promise requires writing to a merchant's actual theme files, which for a public App Store app requires a Shopify-granted exemption beyond the OAuth scope itself. This is a Phase 0 business-development dependency with its own timeline, run in parallel with engineering, not after it.
2. **No competitor does capability-aware minimal editing** (doc 03 §4.7) — the MVP must prove *this specific mechanism* (Manifest → Model → Operation Planner → structural-ops-first) end to end, even in a narrow slice, rather than spreading effort across breadth-first feature parity with Dropmagic/PageFly/GemPages.

## 2. MVP feature list

Numbered per the brief's suggested 17-item list, annotated with what's actually in scope and why.

| # | Feature | In MVP? | Notes |
|---|---|---|---|
| 1 | Shopify connection (OAuth) | Yes | `read_themes` always; `write_themes` gated by exemption status (§4 below) |
| 2 | Theme import (duplicate-first working copy) | Yes | Doc 16 §5 — never edits `MAIN` directly |
| 3 | Theme parser | Yes | OS 2.0 themes only; vintage themes rejected with a clear message (doc 07) |
| 4 | Theme manifest | Yes | Full schema per doc 08; capability flags limited to the static-rule set (defer embedding-based fuzzy capability matching, doc 12 §3's fallback tier, to post-MVP) |
| 5 | Theme model | Yes | Full mutation API (doc 09) — this is shared infrastructure, not optional |
| 6 | Visual editor | Partial | Section/block settings editing, add/remove/reorder/duplicate section, global style edits (doc 06 §3). Defer: AI-suggested section insertion, focal-point image cropping UI polish |
| 7 | AI chat | Yes | Core loop; single AI provider live at launch (see §5), abstraction layer built per doc 10 so a second provider is a config change, not a rewrite |
| 8 | Clarification system | Yes | All 5 outcomes (execute / clarify / plan / confirm / refuse) per doc 13 — this is not optional polish, it's the mechanism that keeps the AI from guessing |
| 9 | AI operation planner | Yes | Structural ops fully supported; generative ops (`create_section_file`/`modify_liquid`/`modify_css`/`modify_js`) supported but capped in scope — see §3 |
| 10 | Existing-setting reuse | Yes | The decision rules in doc 11 §5 (type/label/options matching) are the mechanism that makes the whole product's thesis testable |
| 11 | Targeted theme modifications | Yes | Same as #10 — this is the product |
| 12 | Diff | Yes | Full schema (doc 14) — required for #15/#17 below, not deferrable |
| 13 | Preview | Yes, with a caveat | Live-preview mechanism for a hosted app is an **[Not found]** item in doc 16 §8 — needs an engineering spike in Phase 1 before this can be committed to as a hard deliverable date |
| 14 | Undo | Yes | In-session undo/redo over the Diff stack (doc 14 §3) |
| 15 | Theme validation | Yes | All 9 layers from doc 15, though "runtime/rendering" and "responsive" validation may run against a smaller fixture set than doc 21's full 5-theme suite at MVP time |
| 16 | Shopify publish | Yes | Explicit merchant action only, publishing the working-copy theme (doc 16 §9) |
| 17 | AI usage tracking | Yes | `AIUsageEvent`/`CreditBalance` ledger from day one, even if MVP billing is a single flat beta tier (see §6) |

## 3. Deliberately narrow generative-op scope at MVP

Generative operations (`create_section_file`, `modify_liquid`, `modify_css`, `modify_js`) are the highest-risk, highest-cost, hardest-to-validate part of the system (doc 15's Liquid-syntax and regression layers exist mainly for these). Shipping them unrestricted at MVP risks the exact "unverifiable, breaks-on-uninstall-style" trust problem that differentiates Shopforge from the JS-overlay competitors (doc 03 §4.2).

MVP generative scope: **`create_section_file` only, for a small allowlisted set of common section archetypes** (e.g. FAQ, testimonials/reviews block, simple CTA banner) where the schema shape is well understood and validation can be tight. `modify_liquid`/`modify_css`/`modify_js` (arbitrary free-form code edits to existing files) are explicitly **post-MVP** — they carry the largest regression/blast-radius risk (doc 15 §9) and the largest validation-engineering cost, and are not required to prove the core thesis, which rests on structural reuse, not code generation.

## 4. The write_themes dependency, made concrete for MVP planning

- MVP engineering (Parser → Manifest → Model → Operation Planner → Diff → Serializer, docs 07–15) is built and tested against **Shopify CLI-pulled local theme files and a Shopify development store** (doc 16 §10.4), which does not depend on the App-Store exemption gate. This is the entire reason that fallback path exists: it decouples the MVP build timeline from Shopify's approval timeline.
- The exemption application itself starts in Phase 0, in parallel, using the framing doc 16 §10.4 recommends (safety properties: duplicate-first, never touches `MAIN`, full diff/undo).
- **MVP "done" has two states depending on exemption status at ship time**: if granted, MVP ships as a normal public app hitting real merchant stores. If not yet granted, MVP ships to a small set of design-partner merchants via a custom/unlisted app installation (doc 16 §10.4's Theme Access fallback, or a direct custom-app install), which sits outside the App-Store-distribution gate per the research's inference. Either path validates the same product; only distribution mechanics differ.

## 5. AI provider scope

One provider live at MVP (a single well-supported chat + structured-output + vision model), behind the full abstraction layer from doc 10. The abstraction is built at MVP time (not deferred) because retrofitting a provider-neutral interface after prompts/tool-schemas are hardcoded to one vendor's API shape is expensive; adding a second live provider later should be a configuration change, not a rewrite.

## 6. Billing at MVP

Full `AIUsageEvent`/`CreditBalance`/credit-cost-table machinery (doc 22) is built at MVP, but commercial rollout can launch with a single flat "beta" tier (generous fixed monthly credits, no tiered plans yet) rather than the full Free/Starter/Growth/Agency structure. The ledger exists from day one so historical usage data isn't lost when tiering launches — tracking is cheap to build early and expensive to backfill.

## 7. Explicitly out of scope for MVP

- Multi-provider AI (built abstracted, only one wired up)
- `modify_liquid`/`modify_css`/`modify_js` generative ops
- Embedding-based fuzzy capability matching (doc 12's semantic-search fallback tier) — static-rule capability flags only
- Full tiered billing/plans
- CRO features, product-URL import, branding-generation-from-scratch (all doc 03 §6.2 Should-haves)
- Multi-language/localization beyond passthrough of whatever the theme already has
- Team roles beyond a functional owner/editor split (doc 18's full 4-role matrix is designed but admin/viewer nuances can lag)
- The optional "start from scratch / new store" secondary onboarding path (doc 04 §5) — single-path (connect existing store) only at MVP

## 8. MVP acceptance criteria

MVP is done when, against a real (or dev-store) Shopify theme with no prior Shopforge-specific accommodation:
1. A merchant can connect their store, import a theme, and see an accurate capability summary within minutes.
2. Sending "make the hero background dark blue" (doc 11's worked example) resolves as a single `update_setting` operation with zero generated code, previewed, and appliable in one click.
3. Sending an ambiguous request ("make the header better") produces a clarifying question, not a guess (doc 13).
4. A multi-step request within the MVP's generative scope (e.g. "add an FAQ section") produces a reviewable Operation Plan before executing.
5. Every applied change has a Diff, is undoable, and survives a validation pass that blocks out-of-scope file changes (doc 15's regression layer).
6. Publish pushes the working copy live only on explicit merchant action, and the live theme was never touched before that point.
