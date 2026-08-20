# Shopforge Product Specification

This folder is the canonical, implementation-focused specification for Shopforge — how the product actually
works. It is written for an engineering team (human or AI) implementing directly against it.

This is distinct from `docs/01`–`docs/26` one level up, which are research, competitive analysis, and
architectural decision-history documents. Those remain available for understanding *why* the product is built
this way; this folder describes only *how* it works, without research framing, comparisons, or rejected
alternatives.

## Read this first

1. [Product Architecture Overview](01-product-architecture-overview.md) — the end-to-end flow and what each
   layer (React, LiquidJS, Liquid, Store Configuration, Shopify) means.
2. [DECISIONS.md](DECISIONS.md) — every finalized architectural decision, in one place.
3. [MVP Scope](24-mvp-scope.md) — what ships first.

Then read the document for whichever layer you're implementing — the index below is organized in the same
order as the product flow.

## Document index

| Doc | Contents |
|---|---|
| [DECISIONS.md](DECISIONS.md) | Finalized architectural decisions |
| [01-product-architecture-overview.md](01-product-architecture-overview.md) | End-to-end flow, stage-by-stage summary |
| [02-base-theme-and-section-library.md](02-base-theme-and-section-library.md) | The owned Base Theme and the first-party Section Library |
| [03-store-configuration.md](03-store-configuration.md) | The Store Configuration JSON schema — the central editable document |
| [04-ai-architecture.md](04-ai-architecture.md) | AI generation and conversational editing, provider abstraction, context selection, clarification, provenance |
| [05-product-import.md](05-product-import.md) | Product URL → normalized Product Data |
| [06-preview-architecture.md](06-preview-architecture.md) | The LiquidJS Preview Renderer pipeline |
| [07-liquidjs-vs-shopify-liquid.md](07-liquidjs-vs-shopify-liquid.md) | How preview (LiquidJS) and production (Shopify Liquid) relate |
| [08-preview-iframe.md](08-preview-iframe.md) | The same-origin preview iframe: isolation, communication, security |
| [09-visual-editor.md](09-visual-editor.md) | The React/Next.js builder application and its operations |
| [10-dom-metadata-and-selection.md](10-dom-metadata-and-selection.md) | `data-sf-*` metadata and click-to-select |
| [11-contenteditable.md](11-contenteditable.md) | Inline text editing as an interaction mechanism |
| [12-shared-section-contract.md](12-shared-section-contract.md) | The settings/blocks contract shared by AI, editor, preview, and Shopify |
| [13-assets.md](13-assets.md) | Asset lifecycle: import, upload, generation, storage, publish |
| [14-shopify-publishing.md](14-shopify-publishing.md) | What happens on Publish |
| [15-shopify-theme-structure.md](15-shopify-theme-structure.md) | The Shopify theme file structure and how Store Configuration maps onto it |
| [16-preview-shopify-parity.md](16-preview-shopify-parity.md) | Preview-to-Shopify parity as an engineering goal, and how it's tested |
| [17-validation-and-error-handling.md](17-validation-and-error-handling.md) | Validation layers and error handling |
| [18-versioning-and-undo-redo.md](18-versioning-and-undo-redo.md) | Versions, undo/redo, restore, publish history |
| [19-data-model.md](19-data-model.md) | Conceptual data model / entities |
| [20-api-contracts.md](20-api-contracts.md) | API surface and contracts |
| [21-security-and-multi-tenancy.md](21-security-and-multi-tenancy.md) | Auth, isolation, iframe/XSS/publish security |
| [22-technical-dependencies.md](22-technical-dependencies.md) | Technology/dependency matrix |
| [23-testing-strategy.md](23-testing-strategy.md) | Unit/integration/E2E/parity testing |
| [24-mvp-scope.md](24-mvp-scope.md) | What ships first, and what's explicitly deferred |
| [25-implementation-roadmap.md](25-implementation-roadmap.md) | Phased build sequence |

## The product flow, in one diagram

```
User -> Project/Store Creation -> Product URL -> Product Import/Scraper -> Normalized Product Data
     -> AI Generation -> Section Selection -> Section Ordering -> Section Settings/Content
     -> Store Configuration (JSON) -> LiquidJS Preview Renderer -> Same-Origin Preview iframe
     -> Visual Editor -> User Changes -> Store Configuration Updated -> LiquidJS Preview Updated
     -> Save/Version -> Publish -> Apply Configuration to Base Shopify Theme -> Shopify Theme
     -> Real Shopify Storefront
```

## Core architectural decisions (see DECISIONS.md for the full list)

- The Store Configuration is the single source of truth.
- We own the Base Shopify Theme and the Section Library.
- AI generates structured configuration and content, never Liquid, HTML, CSS, or JS.
- React/Next.js powers the builder UI only; it never renders the storefront.
- LiquidJS renders the storefront preview, using the same controlled Liquid templates that later run on
  Shopify.
- The preview renders inside a same-origin iframe.
- The editor changes only the Store Configuration.
- Shopify receives the final configuration only at explicit Publish.

## Explicitly out of scope (MVP and beyond, per current decisions)

- Parsing or editing an arbitrary pre-existing merchant theme.
- AI-generated Liquid, HTML, CSS, or JavaScript.
- A React reconstruction of the storefront.
- A Shopify round trip for ordinary preview or editing.

See [MVP Scope](24-mvp-scope.md) for the full deferred-feature list.

## How to use these documents when implementing a feature

1. Start at [Product Architecture Overview](01-product-architecture-overview.md) to place the feature in the
   flow.
2. Read the specific document(s) for the layer(s) the feature touches.
3. Check [DECISIONS.md](DECISIONS.md) before making an architectural choice the documents don't already cover
   — if it isn't decided there, it isn't decided.
4. Check the "Open Questions / TBD" section of the relevant document before assuming an unresolved detail —
   do not silently invent an answer to something marked TBD or Needs Investigation; raise it instead.
5. Keep the Store Configuration shape and entity names exactly as defined in
   [Store Configuration](03-store-configuration.md), [Shared Section Contract](12-shared-section-contract.md),
   and [Data Model](19-data-model.md) — every other document assumes those names.
