# Phase 01 — Foundation

## Objective

Establish the technical base every later phase is built on, so Phases 02+ are adding features to a consistent
project, not making one-off infrastructure decisions along the way.

## Scope

- Next.js application structure (App Router, TypeScript throughout).
- React/TypeScript conventions (component organization, server vs. client component boundary).
- PostgreSQL connection and a migration system (schema managed through migrations from the very first table,
  not hand-edited).
- Environment configuration (`.env` conventions, what's required vs. optional at boot, secrets never
  client-exposed).
- Server/client boundary: which code may run in the browser and which must stay server-only — this boundary is
  security-relevant starting immediately, since Phase 02's product-URL fetch must never be reachable from
  client code (SSRF surface, see
  [`docs/product-spec/21-security-and-multi-tenancy.md`](../product-spec/21-security-and-multi-tenancy.md) §19).
- A minimal validation convention (how a malformed request is rejected) and a minimal error-handling convention
  (how a server-side failure becomes a client-visible, non-crashing response) — not the full 8-layer validation
  pipeline from
  [`docs/product-spec/17-validation-and-error-handling.md`](../product-spec/17-validation-and-error-handling.md),
  which only becomes necessary once there's a Store Configuration to validate (Phase 04+).
- Structured logging (enough to debug a failed request in later phases; not observability/alerting — that's
  Phase 14).
- A testing foundation: a test runner wired up, one real test passing, so Phase 02 onward can add tests as they
  go rather than introducing the harness under pressure.
- A dependency policy: every dependency added in a later phase must solve a demonstrated requirement in that
  phase — this document is where that rule is established, not re-litigated per phase.

## Out of Scope

- The Store Configuration schema (Phase 04).
- Any Liquid/LiquidJS code (Phase 05/06).
- The full data model from
  [`docs/product-spec/19-data-model.md`](../product-spec/19-data-model.md) (`Project`, `StoreConfigVersion`,
  `Diff`, etc.) — Phase 01 stands up Postgres and migrations as infrastructure; the durable, versioned entities
  arrive incrementally starting Phase 04 and are formalized at scale in Phase 10.
- Authentication/authorization, roles, multi-tenancy — Phase 10/14.
- Any Shopify-facing code.

## Architecture

A single Next.js application is both the builder UI and its own API layer (route handlers), talking to one
Postgres database. There is no separate backend service at this phase — see
[`docs/product-spec/01-product-architecture-overview.md`](../product-spec/01-product-architecture-overview.md)
for why the architecture stays this simple through MVP. The server/client boundary is enforced by keeping
network-facing and database-facing code in server-only modules, never imported into a client component.

## Inputs

None — this is the first phase.

## Outputs

- A running Next.js application (dev + production build both succeed).
- A Postgres database reachable from the app, with a migration tool applying an initial (even if empty) schema.
- A documented convention (in this repo, not just this document) for: where server-only code lives, how a
  request is validated, how an error becomes a response, how a log line is written.
- A passing test suite with at least one real test.

## Dependencies

None.

## Implementation Areas

- App bootstrapping and routing conventions.
- Database client/connection module (a single shared connection, not one per request).
- Migration tooling and the first migration.
- Environment loading and validation (fail fast on a missing required variable, not a runtime crash later).
- A shared error-response helper used by every API route.
- A shared request-validation helper (schema-based) used by every API route.
- Logging module.
- Test runner configuration.

## Data Contracts

None specific to this phase — no application entities exist yet. The migration tool itself is the only
"contract" established here: every later phase's schema changes must go through it.

## User Flow

None — there is no user-facing feature in this phase. The Completion Criteria are entirely technical.

## Error Handling

- A malformed request to any API route returns a structured, typed error response — never an unhandled
  exception or a raw stack trace.
- A database connection failure at boot fails loudly and immediately, not silently on first query.
- A missing required environment variable fails at boot with a clear message naming the variable.

## Testing

- One passing unit test exercising the validation helper.
- One passing integration test exercising the database connection (e.g., a trivial round-trip write/read
  through the migration-managed schema).
- CI (or an equivalent local command) runs both on every change.

## Completion Criteria

- `next build` (or equivalent) succeeds with no errors.
- The application boots against a real Postgres instance using only environment configuration, no hand-edited
  local state.
- A migration can be created, applied, and rolled back.
- The validation and error-handling conventions are used by at least one real route handler (even a trivial
  health-check route), proving the pattern works end-to-end, not just in isolation.
- The test suite runs and passes.

## Next Phase

[02 — Product Import](02-product-import.md) is the first real user-facing workflow, built directly on this
foundation's server/client boundary, validation convention, and error-handling convention.
