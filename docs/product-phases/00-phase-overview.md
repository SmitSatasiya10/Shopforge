# Phase Overview

Master roadmap for building Shopforge. See [`README.md`](README.md) for how this folder relates to
[`docs/product-spec/`](../product-spec/README.md).

## Master table

| Phase | Name | Goal | Main Output | Depends On |
|---|---|---|---|---|
| 01 | Foundation | Establish the technical base every later phase builds on | Running Next.js app, Postgres + migrations, server/client boundary, validation/error/logging conventions, test harness | — |
| 02 | Product Import | Turn a submitted product URL into raw extracted data | Raw product payload + import status, working without LiquidJS or the Base Theme | 01 |
| 03 | Product Normalization | Turn raw extracted data into one canonical product shape | Normalized Product Contract | 02 |
| 04 | Store Configuration | Define the JSON document that is the system's source of truth | Store Configuration schema + validation + serialization | 03 |
| 05 | Base Theme Runtime | Load and represent the real Base Theme (layout/sections/snippets/assets/config/locales) | Base Theme loader + Shopify compatibility layer | 01 |
| 06 | LiquidJS Preview | Render a Store Configuration through real Liquid into HTML | LiquidJS Preview Renderer + same-origin iframe | 04, 05 |
| 07 | Preview Editor | Let a user select and edit sections inside the live preview | React builder chrome, selection, settings panel, contentEditable, session-level undo/redo | 06 |
| 08 | Section Library | Grow the fixed first-party section catalog | 15-20 section MVP slice, each with template + contract + editor metadata | 05, 06, 07 |
| 09 | AI Generation | Generate a Store Configuration from product data, and support conversational edits | Structured-output AI pipeline writing through the same mutation/validation path as the editor | 04, 07, 08 |
| 10 | Persistence and Projects | Formalize durable, multi-project, versioned persistence at scale | `Project`, `StoreConfigVersion` lineage, ownership boundaries in Postgres | 09 |
| 11 | Shopify Integration | Connect a real merchant Shopify store | OAuth connection, Base Theme install, `ShopifyStore`/`ShopifyInstallation` | 10 |
| 12 | Publishing | Push a Store Configuration to a live Shopify theme | Publish pipeline, `PublishRecord`, rollback | 11 |
| 13 | Testing and Hardening | Prove every phase above against the spec's non-negotiable release gates | Test suites, parity harness, regression harness | Threaded through 01-12 |
| 14 | Production Readiness | Final checklist before real merchants use this at scale | Security/performance/observability/reliability sign-off | 01-13 |

## Core prototype (Phases 01-07)

The first vertical slice proves the core architecture end-to-end, without AI, without the full section catalog,
and without touching Shopify:

```text
URL
 |
Fetch                  (02)
 |
Extract                (02)
 |
Normalize              (03)
 |
Store                  (04, minimal persistence — full versioning arrives in 10)
 |
Configuration           (04)
 |
LiquidJS                (06)
 |
iframe Preview          (06)
 |
Edit                    (07)
 |
Configuration
 |
Re-render               (06)
```

This is the same vertical slice described in
[`docs/product-spec/01-product-architecture-overview.md`](../product-spec/01-product-architecture-overview.md).
Nothing past Phase 07 is required to prove the architecture works. A team should not start Phase 08 (or later)
until this loop is demonstrably working end-to-end (see Phase 07's Completion Criteria).

## MVP expansion (Phases 08-12)

Once the deterministic loop is proven, MVP expansion grows the system into something a real merchant can use:

```text
Section Library     (08)  — grow from the prototype's handful of sections to the MVP's ~15-20
AI                  (09)  — generate Store Configuration from product data; support conversational edits
Persistence         (10)  — durable Projects, versioned Store Configuration, ownership/multi-tenancy
Shopify integration (11)  — connect a real merchant store
Publishing          (12)  — push the Store Configuration live
```

Order matters here beyond the table's Depends On column: Phase 09 (AI) writes through the exact same
mutation/validation/Diff pipeline Phase 07 already proved for manual edits — AI is not a second write path. Do
not start Phase 09 until Phase 07's undo/redo and validation pipeline are solid, since Phase 09 immediately
starts exercising that same stack at higher volume and with less predictable input. Phase 11 and 12 are the
only phases in the whole roadmap that require Shopify API access — everything through Phase 10 is buildable and
fully testable without it (see [`README.md`](README.md) for why this matters for sequencing real engineering
work against an uncertain `write_themes` exemption timeline).

## Production hardening (Phases 13-14)

```text
Security
Reliability
Testing
Performance
Observability
Migration/versioning
Production readiness
```

Phase 13 and 14 are written as their own phase documents with their own Completion Criteria, but neither is a
big-bang activity done only at the end. Phase 13's test categories apply from Phase 01 onward (each earlier
phase's own Testing section names what that phase must already cover); Phase 13 as a phase is where those
per-phase test suites are unified into the release-gate harness described in
[`docs/product-spec/23-testing-strategy.md`](../product-spec/23-testing-strategy.md) (preview parity, AI
regression, hallucination resistance, etc.). Phase 14 is the final checklist gate — see that document for what
is explicitly deferred past MVP versus what blocks shipping to real merchants.

## Dependency graph (critical path)

```text
Foundation (01)
   |
Product Import (02) --- Base Theme Runtime (05)
   |                          |
Normalization (03)            |
   |                          |
Store Configuration (04) -----+
   |
LiquidJS Preview (06)
   |
Preview Editor (07)
   |
Section Library (08)
   |
AI Generation (09)
   |
Persistence refinement (10)
   |
Shopify Integration (11)
   |
Publishing (12)
   |
Production Hardening (14)
```

Phase 02/03 (Product Import + Normalization) and Phase 05 (Base Theme Runtime) have no dependency on each other
and can be built in parallel — both only need Phase 01. They converge at Phase 04/06: Store Configuration needs
normalized product data to seed initial settings (Phase 03), and the LiquidJS Preview Renderer needs both a
Store Configuration to render (Phase 04) and a Base Theme to render it against (Phase 05). Testing and
Hardening (13) is not a single point in this chain — it runs alongside every phase from 01 onward, as described
above.
