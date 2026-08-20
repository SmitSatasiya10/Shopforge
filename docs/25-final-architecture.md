# 25 — Final Architecture

## 1. Architecture diagram

The brief's proposed diagram (§41) is a reasonable skeleton but omits two things research revealed as load-bearing: (1) the duplicate-first working-copy model (doc 16 §5) sits *between* Theme Importer and Theme Parser — Shopforge never parses/edits the merchant's live `MAIN` theme directly — and (2) Validation and the Diff Engine both feed back into Clarification, not just forward to Preview, because a validation failure on a generative operation must surface to the user rather than dead-end (doc 15's closing section). The revised diagram:

```
                         Shopify Store
                              |
                              v
                       Shopify Connector  (OAuth, doc 16 §2)
                              |
                              v
                    Theme Importer (list + download, doc 16 §3-4)
                              |
                              v
              Theme Duplicator -> Working-Copy Theme   (doc 16 §5 — safe default,
                              |                          never edits MAIN directly)
                              v
                        Theme Parser              (doc 07)
                              |
                              v
                       Theme Manifest              (doc 08 — cached, versioned)
                              |
                              v
                        Theme Model                (doc 09 — shared, mutable)
                              |
                +-------------+-------------+
                |                           |
                v                           v
          Visual Editor                AI Workspace
        (doc 06, doc 19)                    |
                |                    AI Context Engine        (doc 12 — capability
                |                           |                   index -> embedding
                |                    Clarification System       fallback, doc 13)
                |                           |                          ^
                |                    Operation Planner          (doc 11)|
                |                           |                          |
                |                    Operation Executor                |
                |                           |                          |
                +-------------+-------------+                         |
                              |                                        |
                              v                                        |
                        Diff Engine                (doc 14)            |
                              |                                        |
                              v                                        |
                     Validator (9 layers)          (doc 15) --- fail --+
                              |  pass
                              v
                    Theme Serializer                (doc 09 §Serializer
                              |                        -- writes files back)
                              v
                   Preview (working-copy theme)      (doc 16 §8 -- confirmed
                              |                        gap, needs spike)
                              v
                 Shopify Theme API (write_themes +    (doc 16 §7, §9-10 --
                    exemption, or dev-store/            gated dependency)
                    custom-app fallback)
                              |
                              v
                   Published (role: MAIN)
```

Every box maps to a specific doc; nothing here is invented beyond what docs 06–19 already specify — this diagram is a synthesis view, not a new design.

## 2. Why this shape, restated in one paragraph per layer

**Connector → Duplicator**: theme editing without a live-store-safe entry point is the exact risk profile of the "breaks on uninstall" JS-overlay competitors (doc 03 §4.2); duplicating first makes every downstream step reversible by construction, independent of Shopforge's own bug surface (doc 16 §5.2).

**Parser → Manifest → Model**: this is the layer that makes "targeted edit" possible instead of "regenerate and hope" — without a structured understanding of what a theme can already do, an AI has no way to distinguish "reuse an existing setting" from "write new code," which is the single gap no competitor fills (doc 03 §4.7).

**Visual Editor + AI Workspace over one Model**: Principle 7 exists because two representations of the same theme drifting apart is how editors and AI features become unreliable in tandem — every mutation, regardless of source, goes through the same functions (doc 09's mutation API) and produces the same kind of Diff (doc 14).

**Context Engine → Clarification → Planner**: this is the cost-and-trust layer — it's what stops the AI from sending (and paying for) the whole theme on every request (doc 12), and what stops it from guessing on ambiguous asks (doc 13), before it ever proposes an Operation.

**Diff → Validator → Serializer**: nothing reaches real theme files without passing 9 layers of validation (doc 15), and everything that does is fully traceable and reversible (doc 14) — this is what makes AI-driven edits to a merchant's live business asset defensible.

**Shopify Theme API**: gated by the `write_themes` exemption (doc 16 §10) — the one dependency in this entire diagram that isn't purely an engineering decision, and the reason Phase 0/1 of the roadmap (doc 24) explicitly decouples engineering validation (dev store) from production distribution (exemption-gated).

## 3. What's deliberately not in this diagram

- A "full theme regeneration" path — never exists in this architecture; Principle 1 rules it out by design, not by omission.
- A proprietary rendering runtime — every write is real Liquid/OS 2.0 JSON through the Shopify Theme API; there is no Shopforge-hosted storefront layer, unlike PageFly/GemPages' client-JS overlay (doc 03 §4.2) or Shogun Frontend's sunset headless approach (doc 03 §4.5).
- A second AI provider live at MVP — the abstraction exists (doc 10) but only one provider is wired up until Phase 9 (doc 24).

## 4. Cross-reference index

| Layer | Primary doc(s) |
|---|---|
| Shopify connection, duplication, publish | 16 |
| Parser / Manifest / Model | 07, 08, 09 |
| Visual Editor | 06, 19 |
| AI provider abstraction | 10 |
| Context selection / token budget | 12 |
| Clarification | 13 |
| Operation Planner / Operation schema | 11, architecture-core §3 |
| Diff / undo / snapshots | 14 |
| Validation | 15 |
| Database | 17 |
| API surface | 18 |
| Security | 20 |
| Testing | 21 |
| Billing / credits | 22 |
| MVP scope | 23 |
| Roadmap | 24 |
