# Product Phases

This folder is the **implementation roadmap** for Shopforge: a sequential set of build phases that turns the
architecture already decided in [`docs/product-spec/`](../product-spec/README.md) into an order an AI coding
agent (or a human engineer) can actually execute in.

## What this is, and isn't

- **This folder answers "in what order, and to what depth, do we build it."**
- [`docs/product-spec/`](../product-spec/README.md) answers "how does it work" — the canonical, implementation-level
  specification of every subsystem (data model, API contracts, preview architecture, AI architecture, security,
  etc.). This roadmap does not repeat that content; every phase document below names the product-spec documents
  it depends on and defers all subsystem-level detail to them. If anything here appears to conflict with
  `docs/product-spec/`, **the product-spec wins** — in particular
  [`docs/product-spec/DECISIONS.md`](../product-spec/DECISIONS.md), which is the tie-breaker of last resort for
  the whole repository.
- [`docs/research/`](../research/README.md) is background/history, not a live spec, and this roadmap does not
  reference it as a dependency.
- This roadmap does not describe or compare against any competitor product. It describes only how Shopforge
  itself gets built.

## Implementation order

Phases are numbered in build order. Later phases assume every earlier phase's Completion Criteria are already
met — see [`00-phase-overview.md`](00-phase-overview.md) for the full dependency graph and a one-table summary
of all 14 phases.

```text
01 Foundation
02 Product Import
03 Product Normalization
04 Store Configuration
05 Base Theme Runtime
06 LiquidJS Preview
07 Preview Editor
08 Section Library
09 AI Generation
10 Persistence and Projects
11 Shopify Integration
12 Publishing
13 Testing and Hardening
14 Production Readiness
```

## Which phases are MVP

Every phase in this roadmap (01-12) is required for MVP as scoped in
[`docs/product-spec/24-mvp-scope.md`](../product-spec/24-mvp-scope.md) — none of them are optional "nice to
have later" work. What's narrowed for MVP is **depth within a phase**, not whether the phase happens at all:
Phase 08 ships ~15-20 sections, not the full ~40-60 target catalog; Phase 02 supports a small allowlist of
import sources, not broad coverage; Phase 09 wires up one AI provider behind a multi-provider-ready
abstraction, not several providers; Phase 12 ships Base Theme install + Store Configuration publish, not AI
image generation or bulk regeneration. Phase 13 (Testing and Hardening) and Phase 14 (Production Readiness) are
continuous concerns threaded through every earlier phase as much as they are a phase of their own — see those
two documents for what's a release gate at MVP versus what's explicitly deferred.

## Which phases depend on Shopify access

**Phases 01-10 require zero Shopify API access.** The entire deterministic pipeline (import, normalize, store
config, render, edit, persist) and the entire AI pipeline are built and fully testable against a local Base
Theme and a local Postgres database — there is nothing in them that needs a merchant's Shopify store or even a
Shopify Partner account.

**Phase 11 (Shopify Integration)** is the first phase that touches a real Shopify store: OAuth connection,
scopes, and theme install. **Phase 12 (Publishing)** is the only phase that writes to a live merchant theme.
Both require the `write_themes` scope, whose App Store distribution exemption status is an open item tracked in
[`docs/product-spec/21-security-and-multi-tenancy.md`](../product-spec/21-security-and-multi-tenancy.md) and
[`docs/product-spec/25-implementation-roadmap.md`](../product-spec/25-implementation-roadmap.md) — see Phase 11
for the fallback path (Theme Access password, design-partner distribution) if that exemption isn't granted by
the time Phase 11 starts.

Practically: a team can build and fully validate Phases 01-10 — including the entire AI generation loop — before
Shopify API access is resolved at all.

## The complete high-level flow

```text
User
 |
Start Store
 |
Product URL Import                     (Phase 02)
 |
Product Extraction -> Normalized Product   (Phase 02 / 03)
 |
Store Configuration JSON               (Phase 04)
 |
Base Theme (real .liquid templates)    (Phase 05)
 |
LiquidJS render()                      (Phase 06)
 |
HTML
 |
Same-Origin Preview iframe             (Phase 06 / 07)
 |
Visual Editor (click, settings, contentEditable)   (Phase 07)
 |
Store Configuration JSON changes
 |
LiquidJS re-render
 |
Updated Preview
 |
[Section Library grows toward full catalog]        (Phase 08)
 |
AI generation (structured config/content only)     (Phase 09)
 |
Projects, versioning, persistence at scale          (Phase 10)
 |
Shopify OAuth + Base Theme install                  (Phase 11)
 |
Publish (Store Configuration -> Shopify theme)      (Phase 12)
 |
Real Shopify Storefront
```

Cross-cutting, not a single point in this diagram: **Testing and Hardening (Phase 13)** applies to every stage
above from Phase 01 onward, and **Production Readiness (Phase 14)** is the final gate before any of this is
exposed to real merchants at scale.

## Product principles this roadmap enforces

These are repeated throughout the individual phase documents where relevant — see
[`docs/product-spec/DECISIONS.md`](../product-spec/DECISIONS.md) for their authoritative statement:

1. Store Configuration is the single source of truth for AI, the editor, the preview, and the publisher.
2. The preview renders real Liquid through LiquidJS — it is never a React reimplementation of the storefront.
3. AI generates structured configuration and content only — never Liquid, HTML, CSS, or JavaScript.
4. The Base Theme is one theme Shopforge owns, not an arbitrary parsed merchant theme.
5. Build incrementally — no phase implements a later phase's scope early.
6. Reuse existing capabilities — inspect the current Section Library/settings architecture before adding new
   shape.
7. Minimize dependencies — add one only against a demonstrated requirement.
8. A phase's Completion Criteria must pass before the next phase starts.
