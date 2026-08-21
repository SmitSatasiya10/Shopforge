# Phase 13 — Testing and Hardening

## Objective

Consolidate every earlier phase's own Testing section into the unified release-gate harness specified in
[`docs/product-spec/23-testing-strategy.md`](../product-spec/23-testing-strategy.md), and prove the three
specific failure modes that harness exists to catch: an invalid/hallucinated Store Configuration, LiquidJS-vs-
Shopify preview divergence, and AI regeneration destroying manual edits.

This is not a phase that starts only after Phase 12 — as [`00-phase-overview.md`](00-phase-overview.md) states,
each phase's own Testing section is a requirement of that phase, not deferred here. This phase is where those
individually-built suites are unified, run together as a release gate, and where the categories that only make
sense at whole-system scope (end-to-end, regression/fuzz, preview parity as a standing suite) are built.

## Scope

- The fixture strategy: 5 Store Configuration fixtures (Minimal, Full-Catalog, Edge-Case, Multi-Page, Large/
  Realistic), every applicable test run against all five; a separate Product Import fixture layer (recorded/
  frozen scraped snapshots + hand-authored adversarial variants + a small nightly live-fetch smoke suite).
- Unit test consolidation: Section Library correctness (Phase 08), Store Configuration schema validation (Phase
  04), mutation function tests (Phase 07), Operation executor tests (Phase 09) — including the no-code-emitting-
  operation-type regression gate — and validation-layer unit tests (Phase 04/17).
- Integration tests: Shopify Admin API against a dedicated dev store (Phase 11/12), full AI generation +
  editing pipeline end-to-end (Phase 09).
- AI-specific tests as a standing, re-run-on-every-change suite (Phase 09's thresholds), not a one-time
  Phase 09 checkbox.
- Regression tests: the snapshot-diff harness (blast-radius containment per Operation type × every fixture,
  required before any executor change ships) and the sequence/fuzz mode (long random operation sequences + full
  undo, must return to identical state).
- End-to-end tests: the complete flow, every stage asserted, per Phase 12's Completion Criteria made a standing
  suite rather than a one-time proof.
- Preview Parity as a standing suite: structural (DOM) comparison on every CI run touching Section
  Library/renderer/schema (non-negotiable release gate), full visual/perceptual comparison nightly/pre-release
  (tracked with thresholds, not a hard blocker), per
  [`docs/product-spec/16-preview-shopify-parity.md`](../product-spec/16-preview-shopify-parity.md).

## Out of Scope

- Building new product features to test — this phase tests what Phases 01-12 built; it does not add scope to
  those phases.
- Performance/load testing at production scale, security penetration testing, and observability/alerting setup
  — Phase 14.

## Architecture

```text
Per-phase test suites (built during Phases 01-12, each phase's own Testing section)
  |
Unified CI harness (this phase)
  |
Non-negotiable release gates          Tracked-threshold suites (not hard blockers at MVP)
  |                                        |
Validation layers                     Ambiguous-prompt thresholds
Regeneration preserves user edits     Section-selection accuracy
Hallucination resistance              Visual/perceptual parity
Regression tests                      Token usage budget
Preview parity (structural)
```

## Inputs

Every phase's own test suite (Phases 01-12) plus the fixture sets defined in this phase.

## Outputs

A unified CI harness distinguishing non-negotiable release gates from tracked-threshold suites, and the
end-to-end/regression/parity suites that only make sense once the whole system exists.

## Dependencies

All of Phases 01-12 — this phase tests the union of everything built so far.

## Implementation Areas

- Fixture authoring: the 5 Store Configuration fixtures and the Product Import fixture layer.
- CI wiring distinguishing per-commit suites (unit, most integration) from nightly/pre-release suites (Shopify
  Admin API integration, full visual parity, AI-specific accuracy suites).
- The regression/fuzz harness: random long operation sequences through Phase 09's executor, undo-to-identical-
  state assertion.
- The blast-radius snapshot-diff harness gating any change to the Operation executor.
- End-to-end test runner covering the complete Phase 01→12 flow against a real (test) Shopify dev store.
- A dashboard or report distinguishing hard-gate failures from tracked-threshold regressions, so a release
  decision is never ambiguous about which failures block it.

## Data Contracts

No new persisted application entity. This phase's "contract" is the release-gate list itself — which suites are
non-negotiable (must be 100% green) versus tracked-threshold (monitored, not blocking at MVP) — kept explicit
and versioned alongside the test suites, not left as tribal knowledge.

## User Flow

None — this phase has no end-user-facing surface. Its consumer is the engineering/release process.

## Error Handling

- A non-negotiable gate failing must block release — this phase's harness must make that structurally true
  (CI configuration), not just documented as a policy.
- A tracked-threshold suite regressing must be visible (reported, trended) even when it doesn't block release,
  so a slow drift is caught before it becomes a hard failure.

## Testing

This phase *is* testing — its own "Testing" section is the harness described in Scope above, applied to
itself: a meta-test confirming the CI configuration actually enforces the non-negotiable/tracked-threshold
split as designed (e.g., a deliberately-broken validation-layer test confirms CI genuinely fails the build, not
just reports a warning).

## Completion Criteria

- Every non-negotiable release gate from
  [`docs/product-spec/23-testing-strategy.md`](../product-spec/23-testing-strategy.md) is wired into CI and
  passing: validation layers, regeneration-preserves-user-edits, hallucination resistance, regression tests,
  preview parity (structural).
- Every tracked-threshold suite is running and reporting, even if not yet fully green.
- The end-to-end flow (Phase 12's Completion Criteria) runs as a standing, repeatable suite, not a one-time
  manual proof.
- A deliberately-introduced regression in each gate category is caught by CI (proving the gate is real, not
  just present).

## Next Phase

[14 — Production Readiness](14-production-readiness.md) is the final checklist, assuming this phase's release
gates are green.
