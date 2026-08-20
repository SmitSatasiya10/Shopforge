# Decisions

This file lists only finalized architectural decisions for Shopforge. Every entry here is settled and binding
on every other document in this folder. Anything not listed here that is still under discussion belongs in the
"Open Questions / TBD" section of the relevant topic document, not here — an item does not become a decision by
being convenient; it becomes one when the source planning record marks it resolved.

## Product model

1. **The Store Configuration is the single source of truth** for a generated store. AI, the visual editor, and
   the LiquidJS preview all read and write the identical `pages -> sections[] -> {id, type, settings, blocks}`
   shape per section. See [Store Configuration](03-store-configuration.md).
2. **We own and maintain the Base Shopify Theme.** Every generated store is built on this one controlled
   theme. Arbitrary existing merchant themes are not parsed, imported, or edited in MVP. See
   [Base Theme and Section Library](02-base-theme-and-section-library.md).
3. **We own the Section Library.** It is a fixed, first-party catalog of reusable Liquid sections (target
   ~40-60, MVP slice ~15-20). Each section's Liquid template, schema, and settings contract are authored and
   controlled by us. See [Base Theme and Section Library](02-base-theme-and-section-library.md) and
   [Shared Section Contract](12-shared-section-contract.md).
4. **AI generates structured configuration and content, never code.** No AI operation emits Liquid, HTML, CSS,
   or JavaScript. AI output is limited to section selection, section ordering, settings, and copy/content,
   expressed as structured operations against the Store Configuration. See [AI Architecture](04-ai-architecture.md).
5. **AI regeneration is provenance-aware.** Every field is tagged `ai` or `user`. Regeneration only touches
   `ai`-tagged fields by default and never silently overwrites a manual edit. See [AI Architecture](04-ai-architecture.md).
6. **React/Next.js powers the builder application UI only** — toolbar, sidebar, section navigator, inspector,
   AI panel, and the iframe host. React is never the storefront renderer. See [Visual Editor](09-visual-editor.md).
7. **LiquidJS renders the storefront preview.** The LiquidJS Preview Renderer resolves each section's `type` to
   its real production Liquid template, injects the Store Configuration's settings/blocks, and renders it with
   LiquidJS — the same controlled Liquid template that later ships to Shopify, not a recreation of it. See
   [Preview Architecture](06-preview-architecture.md).
8. **The preview is displayed inside a same-origin iframe** owned by the builder application, isolated in CSS/
   JS from the builder chrome. The `<iframe>` element MUST be created with `sandbox="allow-same-origin"` and
   nothing else: `allow-scripts` MUST NEVER be present (not even as a workaround for a future preview-
   functionality request — preview JavaScript execution is intentionally, permanently unsupported), no other
   sandbox token (`allow-forms`, `allow-popups`, `allow-modals`, `allow-top-navigation`, `allow-downloads`, or
   any beyond `allow-same-origin`) is ever granted, and the attribute is set once at element creation and MUST
   NOT be dynamically added, removed, or modified during the iframe's lifetime. Any future change to this
   posture requires an explicit, documented architectural decision and a security review before implementation.
   This makes script execution inside the rendered preview a categorical, browser-enforced impossibility,
   independent of the iframe document's own Content-Security-Policy. See
   [Preview iframe](08-preview-iframe.md) §9 and [Security and Multi-Tenancy](21-security-and-multi-tenancy.md)
   §10 for the full rationale and threat model.
9. **The visual editor changes only the Store Configuration.** It has no private write path and no private
   render path; every operation resolves to a Store Configuration write, re-rendered through the same LiquidJS
   pipeline. See [Visual Editor](09-visual-editor.md).
10. **`contentEditable` is an interaction mechanism only.** Text edits are captured and written back into the
    Store Configuration; the DOM is never the persisted source of truth. See [contentEditable](11-contenteditable.md).
11. **Rendered Liquid exposes `data-sf-*` DOM metadata** mapping DOM elements back to Section/Block/Setting
    identity, which the editor uses for click-to-select and hover interaction. See
    [DOM Metadata and Selection](10-dom-metadata-and-selection.md).
12. **Every mutation — AI or manual — produces a Diff, passes validation, and is undoable.** Both paths write
    through the identical mutation pipeline. See [Validation and Error Handling](17-validation-and-error-handling.md)
    and [Versioning and Undo/Redo](18-versioning-and-undo-redo.md).
13. **Shopify receives the final Store Configuration only at explicit Publish.** Publish installs or updates the
    merchant's copy of the Base Theme and applies the Store Configuration to it as Shopify theme JSON/settings
    via the Shopify Admin API. Liquid is never generated or written at publish time. See
    [Shopify Publishing](14-shopify-publishing.md).
14. **A `Project` does not require a connected Shopify store to exist, build, or preview.** The Shopify
    connection is established only when the user publishes.
15. **Arbitrary existing-merchant-theme editing is out of scope for MVP.** Shopforge builds new stores on its
    own owned Base Theme; it does not parse or minimally edit a merchant's pre-existing, non-Shopforge theme.

## Cross-reference

Every document in this folder must be consistent with this list. If a document appears to contradict an entry
here, this file wins — the other document has a bug.
