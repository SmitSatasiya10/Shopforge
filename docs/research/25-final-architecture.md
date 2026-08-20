# 25 — Final Architecture

## 1. Architecture diagram

This is the shape all 26 documents in this set now describe consistently (§4's cross-reference index maps every box to its owning doc). It replaces the old parse-existing-theme diagram entirely — nothing here is a variant of it.

```
                              User
                               |
                               v
                          Product URL
                               |
                               v
                  Product Import / Scraper            (doc 04 Steps 2-5, doc 17 §6,
                               |                        doc 20 §20.10 — SSRF-safe fetch)
                               v
                          Product Data                 (`Product`, doc 17 §6 —
                               |                         kept distinct from AI content)
                               v
                    AI Store Generation (Flow A)        (doc 11 §4 — provider
                               |                          abstraction: doc 10)
                +--------------+--------------+
                |              |              |
                v              v              v
      Section Selection   Section Order   Settings / Copy      (against the fixed
      (doc 11 §8 decision  logic, doc 07/08 catalog & contract) Section Library, doc 07)
                |              |              |
                +--------------+--------------+
                               |
                               v
                     Store Configuration              (doc 08 — the single source
                               |                        of truth; `StoreConfigVersion`,
                               |                        doc 17 §8)
                               v
                  LiquidJS Preview Renderer            (doc 09 — resolves section
                               |                         `type` -> real Liquid template
                               |                         -> injects settings -> render())
                               v
                  Same-Origin Preview iframe            (doc 09 §4 — isolated CSS/JS,
                               |                          `data-sf-*` DOM metadata)
                               v
                         Visual Editor                  (doc 06 operation catalog,
                     (React/Next.js builder shell,        doc 19 frontend architecture —
                      doc 19 — never the storefront        React owns chrome, never
                      renderer itself)                     the storefront render)
                               |
                    click-to-select / contentEditable    (doc 09 §6-7)
                               |
                               v
                     Updated Store Configuration
                               |
                    +----------+----------+
                    |                     |
                    v                     v
              Diff / Undo            Validation           (doc 14 — every mutation,      (doc 15 — 8 categories,
              (doc 14)                (doc 15)              AI or manual, same path)       gates every write)
                    |                     |
                    +----------+----------+
                               |
                               v
                            Publish                        (doc 16 §5-7 — explicit
                               |                             merchant action only)
                               v
              Base Theme + Section Library +
                Store Configuration (as JSON)               (doc 07 Base Theme, doc 08
                               |                              config -> `themeFilesUpsert`)
                               v
                       Shopify Admin API                     (`themeCreate` first publish,
                               |                               `themeFilesUpsert`/
                               |                               `themePublish` thereafter,
                               |                               gated by `write_themes`
                               |                               exemption, doc 16 §8)
                               v
                      Real Shopify Store
```

Cross-cutting, not shown as boxes because they touch every layer rather than sitting at one point in the pipeline: the AI provider abstraction (doc 10) and Clarification system (doc 13) sit inside "AI Store Generation" and every later conversational edit (doc 11 Flow B); context selection (doc 12) scopes what the AI sees at each of those points; the database model (doc 17) persists every entity named above; the API surface (doc 18) is how the Visual Editor and any integration reach all of it; security controls (doc 20) apply at every trust boundary the diagram crosses (Product Import, AI output, iframe, publish); testing (doc 21) validates every layer, including the LiquidJS-vs-real-Shopify parity check that has no other home in this diagram; billing (doc 22) meters the AI Store Generation and regeneration steps specifically.

## 2. Why this shape, restated in one paragraph per layer

**Product Import → Product Data**: kept as a distinct entity from anything AI-authored (doc 17 §6) so it's always possible to tell "what did we actually import" from "what did the AI decide to say about it" — this matters for accuracy review and for re-running generation from the same source facts without re-scraping.

**AI Store Generation over the fixed Section Library**: this is the layer that replaces the old Theme Parser/Manifest/Model chain entirely, not a variant of it. Because the catalog of sections is fixed, owned, and known in advance, the AI never needs to discover what a store "can already do" — it only needs to select from and configure a catalog it always has full knowledge of (doc 11 §8). This is a fundamentally simpler problem than capability-aware minimal editing of an unknown theme, and it's why docs 12 and 15 are both substantially shorter than their predecessors.

**Store Configuration as the single source of truth**: every consumer — AI, editor, LiquidJS preview, and eventually Shopify's own Liquid engine — reads and writes the identical settings/blocks shape for a given section `type` (doc 08 §5's Shared Section Contract). This is the direct replacement for the old "one Theme Model, no disconnected representations" principle, applied to a document instead of a mutable in-memory theme graph.

**LiquidJS Preview Renderer → same-origin iframe**: the single most important decision in this document set (doc 09 §1). Preview is not React recreating the storefront — it's the literal production Liquid section templates, rendered through LiquidJS, in an iframe the editor can interact with. This is what makes preview-production parity a real, testable property (doc 21 §6) rather than an aspiration.

**Visual Editor over the rendered preview, not over a private model**: the editor has no private write path and no private render path (doc 06 §1) — every operation resolves to a Store Configuration write, produces the same kind of Diff regardless of whether a human or the AI triggered it, and is shown by re-driving the same LiquidJS pipeline. This is what keeps the editor and the AI from becoming two systems that happen to produce similar-looking output.

**Diff → Validation, both gating every write**: nothing reaches the Store Configuration's persisted state, let alone Shopify, without passing doc 15's validation and being captured by doc 14's Diff — this is what makes both AI-driven and manual edits fully traceable and reversible, on a system that's much simpler to validate than its predecessor since the Liquid itself is controlled source code, not generated output.

**Publish, as the only path to a real Shopify store**: publish installs or updates a specific, versioned, first-party Base Theme and pushes Store Configuration onto it as JSON — Liquid is never generated or written at publish time (doc 16 §4/§5). This is a bounded, legible write surface, which doc 16 §8.2 argues makes the `write_themes` exemption case *easier* than under the old "editing an unknown merchant's arbitrary theme" framing.

## 3. What's deliberately not in this diagram

- **Arbitrary existing-theme parsing or editing** — never exists in this architecture; it's a different, unbuilt product direction, tracked only in the Future / Advanced Architecture appendices of docs 07, 09, 11, and 15 (doc 24's closing section).
- **AI-generated Liquid, HTML, CSS, or JS** — no primary-workflow `OperationType` emits code (doc 11 §3.3); the AI's entire output surface is section selection, settings, and copy/content.
- **A Shopify round trip for ordinary preview or editing** — the LiquidJS Preview Renderer is entirely local to the builder app; Shopify is only ever touched at Publish (doc 16 §6).
- **A second AI provider live at MVP** — the abstraction exists (doc 10) but only one provider is wired up until doc 24 Phase 6.

## 4. Cross-reference index

| Layer | Primary doc(s) |
|---|---|
| Positioning / differentiator | 01 |
| Competitor research | 02, 03 |
| User flows / information architecture | 04, 05 |
| Editor operation catalog | 06 |
| Section Library | 07 |
| Store Configuration schema | 08 |
| Preview Rendering & Interaction | 09 |
| AI provider abstraction | 10 |
| AI Generation & Editing Operation System | 11 |
| Context selection / token budget | 12 |
| Clarification | 13 |
| Diff / undo / versioning | 14 |
| Validation | 15 |
| Shopify Integration / Publishing | 16 |
| Database | 17 |
| API surface | 18 |
| Frontend architecture | 19 |
| Security | 20 |
| Testing | 21 |
| Billing / credits | 22 |
| MVP scope | 23 |
| Roadmap | 24 |
| Open engineering questions | 26 |

## 5. The one-paragraph statement this entire document set now agrees on

We own the base Shopify theme and fixed section library. AI generates structured configuration and content, not Liquid code. React/Next.js powers the builder UI. LiquidJS renders the storefront preview into a same-origin iframe. The visual editor interacts with that rendered DOM and updates the Store Configuration. Shopify ultimately renders our controlled Liquid sections using the published configuration.
