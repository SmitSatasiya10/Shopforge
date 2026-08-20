# 26 — Open Engineering Questions

This document exists so unresolved decisions stay visibly unresolved instead of quietly hardening into assumed answers as other documents cite them. Every item below was flagged as undecided by the document that first ran into it during this rewrite — none of these are invented here; each links back to where it came from.

Each item carries a status:

- **Decided** — an answer exists and is recorded in the cited document; listed here only because it was non-obvious enough to be worth surfacing.
- **Recommended** — a direction is proposed but not committed; listed as a recommendation, not a decision.
- **Needs Investigation** — genuinely unresolved; do not treat anything downstream as depending on a specific answer until this is closed.

---

## Platform / Shopify

### 1. `write_themes` exemption — apply and secure it
**Status: Needs Investigation.** [Top priority, gating milestone per doc 24 Phase 0.] The existence of the gate and the general application path are established (doc 16 §8); the exact approval criteria, required materials, and timeline are not. Resolve directly with Shopify Partner support.

### 2. Base Theme update policy for already-published stores
**Status: Needs Investigation.** When we ship a new Base Theme/Section Library version, does an already-`MAIN` merchant store update automatically, or only opt-in? Flagged in doc 16 §4.4 and doc 24 Phase 5. Auto-update risks surprising a merchant's live storefront; opt-in risks an ever-growing matrix of Base Theme versions in the wild. No default is assumed anywhere else in this document set — treat both as live options.

### 3. Section settings-schema migration across Base Theme versions
**Status: Needs Investigation.** If a Section's settings contract changes in a backward-incompatible way (doc 07 §7's "ship as a new type slug" rule), what happens to an already-published store still running the old slug? Doc 07 keeps the old slug rendering indefinitely (`status: "deprecated"`, never deleted) — but whether/how a merchant is ever offered a path onto the new version is unresolved.

### 4. Exact shape and hosting of the Base Theme's `themeCreate` source
**Status: Needs Investigation.** Doc 16 §4 establishes the mechanism (`themeCreate(source:, name:)` from our own hosted bundle, not derived from any merchant theme) but not the exact packaging/hosting/versioning of that source artifact.

### 5. GraphQL Admin API rate-limit figures
**Status: Needs Investigation.** Carried over unresolved from the original platform research (doc 16 §9) — conflicting published figures, needs re-confirmation at implementation time regardless of architecture.

### 6. Exact `themes/update`/`themes/publish` webhook firing semantics
**Status: Needs Investigation.** Carried over from doc 16 §9–§10 — needed to keep `PublishHistory`/`Project` records in sync with any out-of-band changes a merchant makes directly in Shopify admin.

---

## Preview & Editor Interaction

### 7. Client-side vs. server-side LiquidJS execution
**Status: Needs Investigation.** Doc 19 §19.5 explicitly deferred this to doc 09: does the live editing preview run LiquidJS in a client-side Web Worker, or as a server-rendered per-section-fragment request? This affects latency, infrastructure cost, and how the render cache (doc 19 §19.5.1) is invalidated. Doc 18's `/preview/*` group assumes server-side rendering is available at least for share links/thumbnails — that narrower case is settled; live-editing-session rendering is not.

### 8. Ambiguous/overlapping click-target disambiguation
**Status: Needs Investigation.** Doc 09 §6.3: when a click lands on a DOM region claimed by more than one `data-sf-*` boundary (e.g. a block nested inside a section, both wanting the click), which wins, and does the UI offer a way to select the "outer" target afterward?

### 9. Keyboard-accessible selection
**Status: Needs Investigation.** Doc 09 §6.3: click-to-select has no specified keyboard-only equivalent yet. This is an accessibility gap, not a nice-to-have, and should be resolved before the Visual Editor (doc 24 Phase 3) is considered feature-complete.

### 10. `contentEditable` mid-edit selection behavior
**Status: Needs Investigation.** Doc 09 §6.3: what happens if the user clicks a *different* selectable element while a `contentEditable` field is actively focused and has unsaved changes — auto-commit, discard, or block the new selection?

---

## AI Generation

### 11. Vague-style-language resolution — is the lightweight embedding fallback sufficient?
**Status: Recommended, not settled.** Doc 12 kept a narrow embedding-based fallback (for requests like "make it feel more premium") rather than the old broad semantic-search tier, on the reasoning that the fixed, small catalog makes keyword/entity lookup sufficient for concrete requests. Whether that narrow fallback actually resolves vague style requests well enough in practice, or needs to grow back toward something closer to the old tier, is untested (doc 24 Phase 4/6).

### 12. Section Library authorship throughput
**Status: Needs Investigation, but flagged as a planning risk, not a technical unknown.** Doc 23 §1 and doc 24 Phase 0/1 both name this as the real MVP bottleneck: producing ~15–20 (MVP) to ~40–60 (target) design-reviewed, schema-clean, on-brand Liquid sections is a content-production timeline question that hasn't been separately scoped from engineering effort.

---

## Product Import

### 13. Supported source breadth at MVP
**Status: Recommended, not settled.** Doc 23 §2 recommends a small allowlisted set of source shapes (a Shopify product page, one or two major marketplaces) rather than arbitrary-URL support, but the exact allowlist and the criteria for expanding it post-MVP aren't decided.

---

## Cross-references

Items 1, 5, 6 originate in doc 16 (Shopify Integration). Items 2, 3, 4 also trace to doc 16 and doc 07 (Section Library). Items 7–10 trace to doc 09 (Preview Rendering & Interaction Architecture) and doc 19 (Frontend Architecture). Item 11 traces to doc 12 (AI Context and Token Optimization). Items 12–13 trace to doc 23 (MVP Scope) and doc 24 (Development Roadmap).

Do not resolve an item on this list inside another document without also updating its status here — this list is the single place these are tracked as a set.
