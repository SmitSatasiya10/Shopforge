# Technical Dependencies and Requirements

## 1. Dependency matrix

| Area | Technology | Status | Purpose |
|---|---|---|---|
| Builder UI | Next.js / React | Decided | Application UI — toolbar, sidebar, inspector, AI panel, iframe host. Never the storefront renderer. |
| Application language | TypeScript | Decided | Application code across builder and backend |
| Storefront preview rendering | LiquidJS | Decided | Renders real production Liquid section templates into HTML for the preview |
| Preview isolation | Same-origin iframe | Decided | Hosts the rendered preview, isolated in CSS/JS from the builder chrome |
| Preview execution placement | TBD | Needs Investigation | Client-side (Web Worker) vs. server-rendered per-section fragment for live-editing-session preview rendering; server-side rendering is assumed for share-link/thumbnail rendering only |
| Editor DOM metadata | `data-sf-*` attribute namespace | Decided/Final — see [DOM Metadata and Selection](10-dom-metadata-and-selection.md) for the six finalized attribute names | Maps rendered DOM elements back to Section/Block/Setting identity for click-to-select |
| Production rendering | Shopify's native Liquid engine | Decided | Renders the same controlled section templates on the real storefront |
| Shopify integration | Shopify Admin API (GraphQL) | Decided (mechanism); exact rate-limit figures TBD | Theme install/update, Store Configuration publish, OAuth |
| Shopify write access | `write_themes` scope + public-app exemption | Needs Investigation | Required before any real-merchant publish; exemption approval criteria/timeline unresolved |
| AI provider | Provider-neutral abstraction; one live provider at MVP | Decided (abstraction); provider choice implementation detail | Generation and conversational editing |
| Drag/drop (section reorder) | TBD | Needs Investigation | Section reorder interaction in the Visual Editor |
| State management (editor) | TBD | Needs Investigation | Client-side Store Configuration + editor UI state |
| Asset storage provider | TBD | Needs Investigation | Storage for imported, uploaded, and generated assets |
| Billing / payments | TBD | Needs Investigation | Plan/subscription and credit-purchase processing beyond the internal usage ledger |

## 2. Notes

- Do not fabricate package versions. Where a specific library, version, or hosting provider is not decided in
  the source planning record, this document marks it TBD rather than assuming one.
- This matrix is the target for a dedicated technical dependency research pass before implementation begins on
  any row marked "Needs Investigation."
- "Decided" here means the *category* of technology is settled (e.g., "LiquidJS renders the preview"), not
  necessarily every implementation parameter within it (e.g., exact execution placement can still be TBD within
  a decided category).

## 3. Cross-references

- Preview execution placement TBD: see [Preview Architecture](06-preview-architecture.md).
- `data-sf-*` metadata: see [DOM Metadata and Selection](10-dom-metadata-and-selection.md).
- `write_themes` exemption: see [Shopify Publishing](14-shopify-publishing.md).
- Asset storage: see [Assets](13-assets.md).
- Drag/drop and editor state management: see [Visual Editor](09-visual-editor.md).
