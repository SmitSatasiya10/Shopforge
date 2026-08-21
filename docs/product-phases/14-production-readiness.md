# Phase 14 — Production Readiness

## Objective

Final checklist before real merchants use Shopforge at scale — the concerns that don't block an individual
feature phase but do block exposing this to production traffic.

## Scope

Per [`docs/product-spec/21-security-and-multi-tenancy.md`](../product-spec/21-security-and-multi-tenancy.md)
and the cross-cutting concerns named throughout this roadmap:

- **Security**: SSRF protection for product-URL fetching (Phase 02) verified at production scale — scheme
  allowlist, private/reserved/link-local IP rejection (including the `169.254.169.254` metadata IP), redirect
  re-validation, network-isolated fetch path, size/time limits, domain throttling. Preview isolation (Phase 06)
  verified as defense-in-depth: escaping/sanitization before render, iframe-document CSP `script-src 'none'`,
  `sandbox="allow-same-origin"` only. Prompt injection defenses (Phase 09) verified against an adversarial test
  set, not just the happy path.
- **Reliability**: database reliability (connection pooling, failover behavior), Shopify API resilience (rate
  limit handling, retry/backoff on publish operations beyond what Phase 12 already built for the happy path).
- **Performance**: the existing client-side LiquidJS renderer's latency at realistic Store Configuration sizes
  (the Large/Realistic fixture from Phase 13) and on realistic merchant/editor hardware, editor responsiveness
  under the render-cache strategy from Phase 07/09. A latency finding here is a target for optimization within
  the existing client-side architecture (caching, render scoping, payload size) — not grounds to revisit where
  LiquidJS executes (see Out of Scope).
- **Error handling**: confirm every phase's Error Handling section is actually enforced in production
  configuration (e.g., error responses don't leak stack traces/internal details in production builds).
- **Logging and observability**: structured logging (Phase 01's foundation) extended with request tracing,
  AI-cost/usage dashboards (built on Phase 09's `AIUsageEvent`), publish-failure alerting (Phase 12).
- **Rate limiting**: AI generation endpoints (per user/org), Shopify connect/import actions (per user/org),
  Product Import fetches (per-session/per-org caps + domain-level throttling) — all named in
  [`docs/product-spec/21-security-and-multi-tenancy.md`](../product-spec/21-security-and-multi-tenancy.md) §16,
  verified with real limits configured, not left as unconfigured defaults.
- **AI cost controls**: Phase 09's budget/circuit-breaker mechanisms verified against a runaway-cost scenario
  (simulated), not just unit-tested in isolation.
- **Database migrations and backups**: migration safety (Phase 01's tooling) verified for zero-downtime
  application, backup/restore tested against the actual production schema (Phase 10's full data model).
- **Deployment and environment configuration**: production environment variables/secrets management, distinct
  from Phase 01's development-time conventions.
- **Open operational/business items** carried forward from
  [`docs/product-spec/21-security-and-multi-tenancy.md`](../product-spec/21-security-and-multi-tenancy.md):
  the `write_themes` App Store distribution exemption status (Phase 11's fallback path may need to remain the
  production path if unresolved), asset storage provider selection, and confirmed GraphQL Admin API rate-limit
  figures. These are infrastructure/business choices with no architectural weight — resolving them doesn't
  change how the system is built, only which vendor/limit it's configured against.

## Out of Scope

- **Reopening any already-decided architecture.** This is the phase's single most important boundary, worth
  stating explicitly rather than leaving implicit: Phase 14 answers "is our existing architecture
  production-ready," never "should it be different." In particular, none of the following are this phase's
  question to ask, because each was already settled and built by an earlier phase:
  - Whether LiquidJS renders client-side or server-side — settled in
    [06 — LiquidJS Preview](06-liquidjs-preview.md) (client-side, "the central bet" the whole preview
    architecture is built on). [`docs/product-spec/21-security-and-multi-tenancy.md`](../product-spec/21-security-and-multi-tenancy.md)
    lists this as a Needs-Investigation item, but that investigation belongs at Phase 06, before the renderer is
    built — by Phase 14 it is already-shipped architecture. This phase's only job regarding it is to verify the
    existing client-side renderer holds up under production load (see Performance, below) — never to
    reconsider moving it server-side.
  - Whether the preview is React or LiquidJS-rendered Liquid — settled in Phase 06
    ([`docs/product-spec/DECISIONS.md`](../product-spec/DECISIONS.md) #6/#7): real Liquid, always.
  - Whether the preview iframe is same-origin/sandboxed a different way — settled in Phase 06
    ([`docs/product-spec/DECISIONS.md`](../product-spec/DECISIONS.md) #8): `sandbox="allow-same-origin"` only,
    set once, never mutated. Phase 14 verifies this holds (see Security, above) — it does not evaluate
    alternative iframe/sandbox models.

  If a production-readiness finding seems to call one of these into question, that is itself a signal to stop
  and escalate as a proposed architectural change against
  [`docs/product-spec/DECISIONS.md`](../product-spec/DECISIONS.md) — not something this phase quietly decides
  on its own by way of a "hardening" change.
- Any new product feature — this phase hardens what Phases 01-13 already built; it does not add scope.
- Enterprise features not in MVP scope (advanced roles, tiered billing beyond flat-fee, CRO/analytics/A-B
  testing, localization beyond Base Theme defaults) — per
  [`docs/product-spec/24-mvp-scope.md`](../product-spec/24-mvp-scope.md), these remain explicitly deferred past
  MVP, not pulled into scope by this phase.
- Over-engineering readiness work before the MVP functionally works — this phase's own instruction, matching
  the roadmap's "build incrementally" principle: do not harden speculative future scale before Phase 01-13's
  Completion Criteria are met.

## Architecture

No new architecture — this phase audits and hardens the architecture Phases 01-13 already established. Its
"architecture" is the checklist process itself: each item above traced back to the phase that owns the
underlying mechanism, verified under production-realistic conditions rather than re-designed.

## Inputs

The complete system from Phases 01-13, plus the open items each phase left explicitly documented rather than
silently resolved.

## Outputs

A production-readiness sign-off: every checklist item above verified, every open operational/business item
either resolved or explicitly accepted as a known, documented limitation for initial launch. No architectural
decision is reopened or changed as an output of this phase — see Out of Scope.

## Dependencies

All of Phases 01-13.

## Implementation Areas

- Production SSRF test suite against real cloud-metadata-IP and private-range targets, not just unit-level
  fixture tests.
- Load/latency testing against the Large/Realistic Store Configuration fixture.
- Rate-limit configuration and verification for every named endpoint category.
- Alerting wiring for publish failures, AI budget-exhaustion events, and repeated validation-layer 1-2
  (system-bug-only) failures — per
  [`docs/product-spec/17-validation-and-error-handling.md`](../product-spec/17-validation-and-error-handling.md)'s
  routing of those failures to internal alerting rather than user-facing regeneration.
- Backup/restore drill against the production schema.
- Resolution (or explicit, documented acceptance) of each open operational/business item named in Scope above
  (`write_themes` exemption, asset storage provider, GraphQL rate-limit figures) — architectural items are
  excluded from this list; see Out of Scope.

## Data Contracts

No new entity. This phase may extend `AuditLog` (Phase 10) with additional production-relevant event types
(rate-limit trips, budget-exhaustion events) if not already covered.

## User Flow

None — this phase is entirely non-user-facing operational hardening.

## Error Handling

- Every error path audited in this phase must confirm production builds never leak internal details (stack
  traces, raw database errors, raw Shopify API error bodies) to end users, even though development builds may
  surface more detail for debugging.
- A rate-limit trip must produce a clear, typed response to the caller — never a silent drop or a generic 500.
- An AI budget-exhaustion event must be visibly alertable to the operating team, not just returned as a typed
  error to the one requesting user.

## Testing

- Adversarial SSRF test suite (cloud metadata IP, private ranges, DNS rebinding scenarios) run against the
  production-configured fetch path.
- Load test against the Large/Realistic fixture, with explicit latency targets set and verified.
- Rate-limit enforcement tests per named endpoint category.
- Backup/restore drill, executed at least once against a production-schema copy.
- A full adversarial prompt-injection test set against Phase 09's defenses, beyond the happy-path tests already
  built in Phase 09/13.

## Completion Criteria

- Every checklist item in Scope is verified, with results recorded.
- Every open operational/business item is either resolved or explicitly, visibly accepted as a documented
  launch-time limitation (never silently ignored).
- Rate limiting, AI cost controls, and SSRF protections are proven under adversarial/production-realistic
  testing, not just unit tests.
- Backup/restore is proven to work against the real production schema.
- No phase document, including this one, was modified to change an architectural decision as part of this
  phase's work — any such finding was escalated per Out of Scope instead.

## Next Phase

None — this is the final phase in the roadmap. Anything past this point (the remaining ~25-45 sections toward
the full catalog, multi-provider AI, AI image generation, bulk regeneration, advanced billing tiers, and every
other item in
[`docs/product-spec/24-mvp-scope.md`](../product-spec/24-mvp-scope.md)'s explicitly-out-of-MVP list) is
post-MVP work, sequenced and scoped separately once this roadmap's Phase 01-14 is live.
