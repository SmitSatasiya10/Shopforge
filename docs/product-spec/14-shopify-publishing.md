# Shopify Publishing

Publish is the only path from a Store Configuration to a real, live Shopify storefront, and it only happens on
explicit user action. This document specifies what happens end to end when the user clicks Publish: OAuth
prerequisites, theme-slot checks, Base Theme install/update, the write sequence, rollback, and the platform
dependencies the flow relies on.

## 1. Publish, in one diagram

```
Final Store Configuration
        |
Validate
        |
Convert/Apply to Shopify Theme Configuration
        |
Base Theme
        |
Theme Files / JSON / Assets
        |
Shopify
        |
Published Theme
        |
Real Storefront
```

- **Final Store Configuration** — the version currently open in the editor (the latest `ConfigurationVersion` for
  the `Project`), not a separate publish-time copy. See [Store Configuration](03-store-configuration.md).
- **Validate** — the full validation pipeline (see [Validation and Error Handling](17-validation-and-error-handling.md))
  runs again immediately before publish, independent of whatever validation already passed when each individual
  change was made. Publish never proceeds against a Store Configuration that fails validation.
- **Convert/Apply to Shopify Theme Configuration** — the Store Configuration is converted into the Shopify-native
  shapes described in [Shopify Theme Structure](15-shopify-theme-structure.md): per-page JSON templates and
  theme/section settings data. This step produces JSON only; no Liquid is generated here or anywhere in the
  publish path.
- **Base Theme** — the merchant's installed copy of Shopforge's Base Theme (see
  [Base Theme and Section Library](02-base-theme-and-section-library.md)), installed on first publish and
  updated in place on later ones (§4).
- **Theme Files / JSON / Assets** — the converted JSON templates and settings data, plus any referenced asset
  URLs, are written onto the installed theme via the Shopify Admin API.
- **Shopify → Published Theme → Real Storefront** — Shopify processes the write, the theme is published
  (`role: MAIN`), and the merchant's live storefront now reflects the Store Configuration.

## 2. Controlled code vs. store-specific configuration

Publish never regenerates or rewrites Liquid for a merchant. Exactly two categories of content ever reach a
merchant's store, and they follow different paths through this document:

| Category | Contents | Written when | Same across every store? |
|---|---|---|---|
| **Controlled code** | `layout/*.liquid`, `sections/*.liquid`, `snippets/*.liquid`, theme-level `assets/*` (CSS/JS Shopforge authored) | Base Theme install (§3) and Base Theme update (§4) only — never per-publish | Yes — identical bytes on every store running that Base Theme version |
| **Store-specific configuration** | JSON templates (`templates/*.json`), section instance settings, block instances, section order, theme settings data, per-store asset *references* (image URLs, etc.) | Every publish (§5) | No — unique per store, derived from that store's Store Configuration |

Controlled code is authored, reviewed, and versioned once by Shopforge (see
[Base Theme and Section Library](02-base-theme-and-section-library.md)) and never diverges per merchant. A
merchant's Store Configuration can only ever select, order, and parameterize the fixed set of Sections that
ship in the controlled code — it cannot introduce a Liquid construct that doesn't already exist in the Base
Theme. This is what makes publish a JSON write, not a code deploy, on every publish after the first.

## 3. Prerequisites: OAuth and theme-slot check

### 3.1 OAuth connect

A `Project` does not require a Shopify connection to be created, built, or previewed — the connection is
established only when the user initiates their first Publish (see [DECISIONS.md](DECISIONS.md)). Connecting:

1. The merchant authorizes Shopforge via Shopify's standard OAuth flow, granting `read_themes` and
   `write_themes`.
2. Shopforge exchanges the authorization code for an access token and persists it on a `ShopifyInstallation`
   record, scoped to the resulting `ShopifyStore`.
3. Shopforge registers the mandatory `app/uninstalled` webhook to clean up the `ShopifyInstallation` on
   uninstall, and registers `themes/publish` to keep `Theme`/`PublishHistory` state in sync if the merchant
   publishes a different theme directly from Shopify admin (see §9 for firing-semantics caveats).

Holding a granted `write_themes` **scope** is necessary but not sufficient for the write calls in §5 and §6 to
actually succeed — see §8.

### 3.2 Theme-slot check

Before installing anything, Shopforge lists the merchant's existing themes (`themes(first:, query:, sortKey:)`,
requires `read_themes`) to:

- Confirm whether a Shopforge-installed `Theme` already exists for this store (first publish vs. update, §4).
- Check remaining slot availability against Shopify's hard cap of 20 themes per store, and warn the merchant
  before an install would fail if the store is at or near the cap.

Shopforge never reads the *content* of a merchant's other themes — only this list-level metadata (`id`, `name`,
`role`, `processing`, `processingFailed`, `themeStoreId`). A merchant's pre-existing theme(s) are never edited.

## 4. Base Theme install and update

### 4.1 First publish: install

If no Shopforge `Theme` exists yet for this `ShopifyStore`, publish first installs the Base Theme:

- `themeCreate(source:, name:)` creates a new theme in the merchant's store from Shopforge's own hosted Base
  Theme bundle — never derived from anything already in the merchant's store.
- A theme created this way defaults to `role: UNPUBLISHED`. Shopforge relies on this default; the installed
  theme is never `MAIN` until the explicit `themePublish` call in §6.
- The resulting `shopifyThemeId` and the installed Base Theme version are recorded on a `Theme` record linked to
  the `ShopifyInstallation`.
- Exact packaging/hosting of the `source` artifact `themeCreate` consumes — **TBD / Needs Investigation**. See
  [Base Theme and Section Library §1](02-base-theme-and-section-library.md).

### 4.2 Subsequent publishes: update in place

If a Shopforge `Theme` already exists for this store, publish targets that existing `shopifyThemeId` instead of
creating a new one. Two independent things can be true on any given update publish:

1. **The Store Configuration changed but the installed Base Theme version has not** — only §5's JSON write runs;
   no controlled-code files are touched.
2. **The installed Base Theme version is older than Shopforge's current version** — the bounded set of changed
   Liquid files between the store's installed version and the current version is computed (a diff of Shopforge's
   own versioned bundle, not a Shopify API concern) and pushed via `themeFilesUpsert`, plus `themeFilesDelete`
   for any removed files, batched to the 50-files-per-request cap, before or alongside the JSON write in §5.

**Auto-update vs. opt-in policy for a store that already has an older Base Theme version installed — TBD /
Needs Investigation.** Whether an already-published (`role: MAIN`) store's Base Theme should ever be updated
automatically, versus only ever as part of a fresh, merchant-initiated publish, is not decided. Auto-updating a
live storefront's Liquid outside of an explicit publish would depart from the principle that Publish is the only
path to a live-visible change (§1), so this needs a deliberate decision, not a default. See
[DECISIONS.md](DECISIONS.md).

**Section settings-schema migration across Base Theme versions — TBD / Needs Investigation.** How a Section's
settings contract changing shape across Base Theme versions is reconciled with a store's existing Store
Configuration, which references that section's settings by name, is not decided. See
[Base Theme and Section Library §5](02-base-theme-and-section-library.md) for the per-type-slug immutability
rule this interacts with.

## 5. Writing the Store Configuration onto the installed theme

Every publish — first or subsequent — writes the converted Store Configuration (§1, §2) onto the installed
theme:

- `themeFilesUpsert(themeId:, files:)` batch-creates/updates the per-page JSON templates and settings data
  described in [Shopify Theme Structure](15-shopify-theme-structure.md), targeting the installed theme's
  `shopifyThemeId`.
- Batched to the 50-files-per-request cap.
- This is JSON only — never Liquid — for this category of write (§2).
- `userErrors` on the response, and any async `job` returned for large operations, are checked before
  proceeding to §6; a failed or partial write here does not proceed to publish.

## 6. Publish call sequence

```
1. Validate current Store Configuration                         (§1)
2. [If no installed Theme]     themeCreate(source, name)         (§4.1)
   [If installed Theme exists] compute + push Base Theme file
                                diff, if any, via themeFilesUpsert/
                                themeFilesDelete                 (§4.2)
3. Convert Store Configuration -> Shopify JSON shapes            (§1, doc 15)
4. themeFilesUpsert(themeId, files)  — JSON templates + settings (§5)
5. Poll theme processing (processing / processingFailed) until
   complete — publishing a new/updated theme completes only
   after async file-extraction finishes
6. themePublish(id)  — sets role: MAIN                           (§7)
7. Poll processing again; on confirmed completion, record a
   PublishRecord (PublishHistory) capturing the ConfigurationVersion
   that was published, the Theme, and a timestamp
8. Only on confirmed completion does the merchant's live
   storefront reflect the new Store Configuration
```

`themePublish(id:)` is the only call in this sequence that changes `role` to `MAIN`, and it happens only once
per publish, only on explicit user action — never automatically, never as a side effect of an editor change
(see [DECISIONS.md](DECISIONS.md)).

If any step fails partway through, the installed theme must not be left half-applied against `MAIN` — a
partial-failure recovery path is required so a failed publish either fully completes on retry or leaves the
previous published state untouched. Exact retry/resume semantics for a partial mid-publish failure are part of
the API contract in [API Contracts](20-api-contracts.md), not redefined here.

## 7. Rollback

Every successful publish produces a `PublishRecord`. Rollback re-publishes a prior recorded entry:

1. The user selects an earlier `PublishRecord` from `PublishHistory`.
2. Shopforge re-runs §5–§6 using that record's `ConfigurationVersion` as the Store Configuration input — not a
   separate rollback-specific code path, the same convert/write/publish sequence as any other publish.
3. A new `PublishRecord` is created for the rollback itself, so `PublishHistory` remains a complete, forward-only
   log of what was actually live and when, rather than being rewritten in place.

Rollback never touches the Base Theme install/update path (§4) directly — it republishes configuration, not a
theme version. If the target `PublishRecord` was published against an older Base Theme version than what is
currently installed, that interacts with the update-policy TBD in §4.2.

## 8. The `write_themes` exemption — platform dependency

**Status: TBD / Needs Investigation.** Every write in §4 and §5, and the publish call in §6, requires the
`write_themes` scope to have been granted at the OAuth layer *and* a separate, Shopify-granted exemption for
apps distributed via the Shopify App Store. Holding the granted scope alone does not guarantee these calls
succeed.

- The exemption's exact approval criteria, required application materials, and expected timeline are not known
  and are not assumed here. No approval status or date is asserted anywhere in this document or elsewhere in
  this folder.
- Two paths let engineering proceed without depending on the exemption timeline: local development against
  Shopforge's own Base Theme source, and a Shopify Partner development store, where `themeCreate` /
  `themeFilesUpsert` / `themePublish` can be exercised end to end outside the App-Store-distribution restriction
  that triggers the exemption requirement.
- A merchant-issued Theme Access password (a free App Store app pattern issuing a time-limited,
  `write_themes`-scoped password) is a possible interim/fallback distribution shape if the exemption is not
  granted in time for a given milestone, though it changes the connect UX in §3.1 and is not the default path
  assumed by this document.

See [Technical Dependencies](22-technical-dependencies.md) and [MVP Scope](24-mvp-scope.md) for how this
dependency gates delivery, and [DECISIONS.md](DECISIONS.md) for what is and isn't settled.

## 9. Worked example: a hero heading change

1. In the editor, the user changes the `hero` section's `heading` setting on the home page from "Premium
   Comfort" to "Sleep Better Tonight." This writes to the Store Configuration immediately:
   ```json
   {
     "pages": {
       "home": {
         "sections": [
           {
             "id": "hero-1",
             "type": "hero",
             "settings": {
               "heading": "Sleep Better Tonight",
               "description": "Designed for better sleep",
               "image": "...",
               "buttonText": "Shop Now",
               "buttonLink": "/products/example"
             },
             "blocks": []
           }
         ]
       }
     }
   }
   ```
2. The LiquidJS Preview Renderer re-renders `sections/hero.liquid` against the updated Store Configuration; the
   user sees "Sleep Better Tonight" in the preview iframe immediately, entirely within Shopforge's
   infrastructure — no Shopify round trip.
3. The change is validated, diffed, saved as a new `ConfigurationVersion`, and is undoable — same as any other
   edit (see [Versioning and Undo/Redo](18-versioning-and-undo-redo.md)).
4. The user clicks Publish. Steps 1–5 of §6 run: the Store Configuration is validated, converted, and the
   `home` page's JSON template (containing the `hero-1` instance's `settings.heading: "Sleep Better Tonight"`)
   is written to the installed theme via `themeFilesUpsert`. `sections/hero.liquid` itself is not touched by
   this publish — the Liquid file that reads `section.settings.heading` was already installed as controlled
   code (§2, §4).
5. `themePublish(id:)` sets the installed theme to `role: MAIN`. Shopify's own Liquid engine renders
   `sections/hero.liquid`, reading `section.settings.heading` from the JSON just written, and produces
   "Sleep Better Tonight" on the real storefront.
6. A `PublishRecord` is written capturing this `ConfigurationVersion`. If a later change needs to be reverted,
   rollback (§7) republishes this record.

This is the general mechanism for every Store Configuration change, not a special case for text: any
setting/block/order change follows the same convert → write JSON → publish path, because Liquid is never
regenerated per merchant (§2) — only the JSON the same controlled Liquid reads changes.

## Open Questions / TBD

| Item | Blocking question |
|---|---|
| `write_themes` exemption approval criteria/timeline | Not known; see §8. No status or date is assumed. |
| Base Theme update policy for already-published stores | Auto-update vs. opt-in on new Base Theme releases; see §4.2. |
| Section settings-schema migration across Base Theme versions | How an in-place contract change is reconciled with a live store's existing Store Configuration; see §4.2. |
| `themeCreate` source artifact packaging/hosting/versioning | Exact packaging and delivery mechanism to the Shopify Admin API; see §4.1. |
| GraphQL Admin API rate-limit figures | Needs re-confirmation at implementation time; affects `themeFilesUpsert` batching cadence. |
| `themes/update`/`themes/publish` webhook firing semantics | Exact firing conditions not confirmed against an official source; affects how reliably out-of-band Shopify-admin theme changes are detected (§3.1). |
| Partial-failure recovery semantics mid-publish | Exact retry/resume contract for a publish that fails partway through §6; see [API Contracts](20-api-contracts.md). |

See [DECISIONS.md](DECISIONS.md) for the settled decisions this document assumes.
