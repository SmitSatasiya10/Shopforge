# Assets

Media (images, fonts, and other binary files) referenced by a Store Configuration — where they come from, how
they're stored, how a section setting references one, and what happens to that reference at publish time.

## 1. Lifecycle

```
Product Import        User Upload        AI Image Generation
(scraped image URL)                      (deferred, post-MVP — see §3.3)
        \                  |                    /
         v                 v                   v
              Asset ingestion  (type/size validation, security re-encode — §4)
                             |
                             v
                       Asset Storage
             (Project media library, checksum-deduped — §5)
                             |
                             v
        Store Configuration reference  (AssetRef, on an image_picker/video setting — §6)
                             |
                             v
                    Preview URL resolution
              (LiquidJS Preview Renderer reads the same URL — §7)
                             |
                             v
                          Publish
                             |
                             v
                  Shopify Theme Asset reference  (§9)
      product-bound images -> native Shopify product image/CDN
      every other asset (hero/banner/upload/AI-generated) -> stays referenced
      by its Shopforge-hosted URL inside the published theme's JSON
```

## 2. Entities

Three distinct names cover an asset's lifecycle. They are kept separate deliberately — collapsing them loses
either dedup/library semantics or generation provenance.

| Entity | What it is |
|---|---|
| **`Asset`** | The canonical, DB-queryable record of one accepted media item in a Project's media library (image, font, other). This is what the asset-library UI lists, what checksum-dedup operates on, and what storage-size accounting sums over. |
| **`GeneratedAsset`** | Tracks one AI generation attempt (image or copy) with its provenance — prompt, model, source operation, status — kept separate from `Asset` so that discarded/unaccepted candidates never appear in the media library. This document covers `GeneratedAsset` only in its `type: "image"` role; its `type: "copy"` role (AI-authored text provenance) belongs to [AI Architecture](04-ai-architecture.md). |
| **`AssetRef`** | The value shape a Store Configuration setting actually holds when its `SettingDef.type` is `"image_picker"` or `"video"` (§6). Not a database entity — it's the reference form embedded directly in JSON. |

### 2.1 `Asset` — field reference

| Field | Type | Notes |
|---|---|---|
| `id` | uuid (pk) | |
| `projectId` | uuid (fk Project) | |
| `type` | enum(`image`, `font`, `other`) | |
| `url` | string | Storage location — the value referenced from `AssetRef.url` (§6). |
| `sizeBytes` | integer | |
| `uploadedBy` | enum(`user`, `ai`) | |
| `sourceGeneratedAssetId` | uuid (fk `GeneratedAsset`), nullable | Set when this `Asset` was promoted from an accepted generation (§8). |
| `checksum` | string | |
| `createdAt` / `updatedAt` | timestamp | |

**Constraint:** `unique(projectId, checksum)` — the dedup key. Uploading or generating a byte-identical asset a
second time within the same Project resolves to the existing `Asset` row rather than creating a duplicate.

There is no theme file tree for an `Asset` to live inside — this architecture owns one controlled Base Theme
(see [Base Theme and Section Library](02-base-theme-and-section-library.md)), and an asset is referenced by URL
from a setting value, never by a file path into a theme structure.

### 2.2 `GeneratedAsset` — field reference

| Field | Type | Notes |
|---|---|---|
| `id` | uuid (pk) | |
| `organizationId` | uuid (fk Organization) | |
| `storeConfigVersionId` | uuid (fk `StoreConfigVersion`), nullable | |
| `operationId` | uuid (fk `StoreOperation`), nullable | The AI operation that requested this generation. |
| `sourceGeneratedAssetId` | uuid (fk `GeneratedAsset`), nullable | Self-reference, for regenerate/variation chains. |
| `assetId` | uuid (fk `Asset`), nullable | Set once promoted into the Project's media library (§8). |
| `type` | enum(`image`, `copy`) | This document covers `image` only. |
| `prompt` | text | |
| `modelUsed` | string | |
| `status` | enum(`generated`, `accepted`, `discarded`) | |
| `createdByUserId` | uuid (fk User) | |
| `createdAt` | timestamp | |

## 3. Sources

### 3.1 Product Import (scraped images)

Product Import turns a merchant-supplied product URL into normalized Product Data, including the source
product's image URLs (see [Product Import](05-product-import.md)). Those images are not referenced directly by
their original external URL — the ingestion pipeline (§4) fetches, re-encodes, and stores them as first-party
`Asset` rows, the same as a direct upload. A scraped image is external input twice over (fetched from an
arbitrary URL, then stored), so it gets both the SSRF controls on the fetch itself and the same content
validation every other upload gets (§4).

### 3.2 User uploads

A user can upload an image (or other supported file type) directly through the Visual Editor — e.g. into an
`image_picker` setting, or into the Project's asset library for later reuse. Every upload goes through the same
ingestion pipeline (§4) before it becomes a queryable `Asset`.

### 3.3 AI-generated assets — deferred (post-MVP)

AI image generation (`generate_image`) is a documented capability, not a current one: it is explicitly out of
MVP scope. MVP's image needs are covered by Product Import's scraped images plus manually uploaded assets. The
data model already accounts for it — `GeneratedAsset.type: "image"`, its `status` lifecycle
(`generated` -> `accepted`/`discarded`), and its promotion path into `Asset` (§8) — so that generation can be
turned on post-MVP without a schema change, but no generation pipeline runs at MVP. See
[MVP Scope](24-mvp-scope.md).

When it ships, a generated image is still subject to the identical ingestion validation as any other asset
before it can be referenced by a Store Configuration (§4) — provider output is external input to Shopforge's
storage layer, not a trusted internal artifact.

## 4. Ingestion and Security Validation

Every asset — uploaded, scraped, or (once shipped) AI-generated — passes through the same ingestion pipeline
before it becomes a stored `Asset` a Store Configuration can reference:

| Check | Applies to | Design |
|---|---|---|
| **Type validation** | All assets | Accepted file types are allowlisted by actual content sniffing (magic-byte/MIME detection performed server-side) — never by trusting a client-reported MIME type or file extension. |
| **Size limits** | All assets | Per-file and per-store size caps, enforced server-side before persistence, independent of any client-side check. |
| **Image re-encoding** | Raster images (PNG/JPEG/WebP), including Product Import images | Every image is decoded and re-encoded server-side — never copied through byte-for-byte — which strips EXIF/XMP metadata, embedded scripts/polyglot payloads, and steganographic payloads that rely on the original byte stream. |
| **SVG handling** | SVG uploads | Treated as executable content, not a plain image: sanitized to strip `<script>`, event-handler attributes, and external references, or rejected outright for flows that don't specifically need vector uploads — SVG is a common XSS vector when rendered inline, including inside the LiquidJS preview iframe. |
| **Font/other binary uploads** | Fonts, misc assets | Validated against expected format signatures; served with a restrictive `Content-Type`/`Content-Disposition`, from a storage origin isolated from the builder app's own origin. |
| **AI-generated images** | Once §3.3 ships | Same re-encode/format-validation step as any other asset before being referenced by a setting — provider output is still external input. |
| **Scraped/imported product images** | Product Import (§3.1) | The fetch itself is subject to the same SSRF controls as any other import fetch (allowlisted sources, no recursive following, size/timeout caps); the fetched bytes then go through the identical re-encode/validation as a direct upload. |

See [Security and Multi-Tenancy](21-security-and-multi-tenancy.md) for the full control set this table
summarizes.

## 5. Storage

- An `Asset` is stored once per distinct file per Project; `unique(projectId, checksum)` on the `Asset` table
  is the dedup mechanism (§2.1) — re-uploading or re-scraping byte-identical content resolves to the existing
  row rather than duplicating storage.
- Storage size is tracked per `Asset.sizeBytes` and rolled up for per-store size accounting and (post-MVP)
  billing.
- **Final storage provider: TBD — Needs Investigation.** Not decided in the source planning record and not
  invented here. See [Technical Dependencies](22-technical-dependencies.md).

## 6. Store Configuration Reference — `AssetRef`

A section setting whose `SettingDef.type` is `"image_picker"` or `"video"` (see
[Store Configuration](03-store-configuration.md) §3.7) holds an `AssetRef`, not a bare URL string:

```
AssetRef {
  url: string
  alt?: string
  source: "ai-generated" | "scraped" | "stock" | "user-uploaded"
}
```

```json
{
  "settings": {
    "image": {
      "url": "https://cdn.shopforge.app/assets/sc_7f2a91/hero-bg.jpg",
      "alt": "Model wearing the Field Sling in charcoal",
      "source": "ai-generated"
    }
  }
}
```

`source` carries provenance for the same reason `Asset.uploadedBy` does at the database layer: it drives editor
UI treatment (e.g. an `"ai-generated"` image gets a regenerate affordance once §3.3 ships) and downstream cost
accounting. `AssetRef.url` is the same URL as the referenced `Asset.url` — the Store Configuration never embeds
or duplicates file bytes, only the reference.

A Store Configuration must be **fully resolved** — no dangling `AssetRef` — at the moment it's handed to
Publish (§9); see §11 for how a reference that stops resolving is caught before that point.

## 7. Preview Resolution

The LiquidJS Preview Renderer does not proxy, transform, or re-host asset URLs — it renders the section's
Liquid template with the Store Configuration's `AssetRef.url` values injected as-is, so the same-origin preview
iframe requests the identical asset URL the published store will later serve. There is no separate
"preview-quality" vs. "production-quality" asset variant. See [Preview Architecture](06-preview-architecture.md)
§8 for how this fits into the renderer's CSS/asset resolution step.

## 8. `GeneratedAsset` Status and Promotion (image role)

Once AI image generation ships (§3.3), a generation request can produce multiple candidate images before one is
accepted — this is why `GeneratedAsset` is not just nullable columns bolted onto `Asset`: `Asset`'s
`unique(projectId, checksum)` constraint represents one *accepted* library item, which a multi-candidate
generation request doesn't fit without a separate staging record.

| Status | Meaning |
|---|---|
| `generated` | A candidate image exists but hasn't been accepted or discarded yet. |
| `accepted` | The user (or the AI's applied operation) chose this candidate. It is promoted into `Asset` (`GeneratedAsset.assetId` is set, `Asset.sourceGeneratedAssetId` points back), and it now participates in the Project's media library, dedup, and storage accounting like any other `Asset`.
| `discarded` | Not chosen. It never appears in `Asset`-backed queries (the media library, the asset picker) — filtering discarded generations out of every `Asset` query would be more error-prone than never inserting them there in the first place. |

`GeneratedAsset.sourceGeneratedAssetId` self-references for regenerate/variation chains — a "generate another
version" request produces a new `GeneratedAsset` row pointing back at the one it varied from, independent of
whether the original was ever accepted.

## 9. Publish: Asset Resolution to Shopify

Publish serializes the Store Configuration into the Base Theme's real `templates/*.json` section entries and
`config/settings_data.json`, then pushes that JSON through the Shopify Admin API (see
[Shopify Publishing](14-shopify-publishing.md)). Liquid is never generated or written at publish time — only
configuration/JSON changes — and the same is true of assets: publish does not re-upload asset files into
Shopify's own theme `assets/` directory, because this architecture has no theme file tree for an asset to live
inside (§2.1).

What actually happens to an asset reference at publish depends on what it's attached to:

- **Product-bound image references** — a setting driven by `ProductRef` (see
  [Store Configuration](03-store-configuration.md) §3.8) — resolve to the real Shopify product's native image
  once that product exists in the merchant's store (`ProductRef.source` flips from `"scraped"` to `"shopify"`
  post-publish). From that point the image is served through Shopify's own CDN with Shopify's own transform
  parameters, the same as any native Shopify product image.
- **Every other asset reference** — hero/banner images, other `image_picker`/`video` settings not bound to a
  product, fonts — stays exactly what it was in the Store Configuration: an `AssetRef.url` pointing at
  Shopforge's own asset storage (§5), written verbatim into the published theme's JSON. Shopify's Liquid engine
  renders it as a normal external image URL, not a Shopify-native `Image` object.

This split is the documented cause of an allowlisted, expected difference in preview/production parity testing
(Shopify CDN image URL/transform parameters on native product images vs. a Shopforge-hosted asset URL elsewhere)
— see [Preview-to-Shopify Parity](16-preview-shopify-parity.md).

## 10. Field Index

| Path | Type | Defined in |
|---|---|---|
| `Asset.id` / `.projectId` / `.type` / `.url` / `.sizeBytes` / `.uploadedBy` / `.sourceGeneratedAssetId` / `.checksum` | — | §2.1 |
| `GeneratedAsset.id` / `.organizationId` / `.storeConfigVersionId` / `.operationId` / `.sourceGeneratedAssetId` / `.assetId` / `.type` / `.prompt` / `.modelUsed` / `.status` / `.createdByUserId` | — | §2.2 |
| `AssetRef.url` / `.alt` / `.source` | — | §6 |

Full field-level detail for `Asset` and `GeneratedAsset` lives in [Data Model](19-data-model.md).

## 11. Broken-Asset Handling

Assets validation is one of the mutation-pipeline's validation layers (see
[Validation and Error Handling](17-validation-and-error-handling.md)): it runs alongside settings validation on
every AI Operation or editor save that touches an image/asset-reference setting, and again as a live re-check
immediately before Publish, because an asset that resolved when a draft was built can stop resolving later — a
scraped image URL going stale, an uploaded asset having been deleted from the library.

**Checks:**
- Every `AssetRef` resolves to a real `Asset` — not a broken link or a dangling internal id.
- The resolved asset's file type is one the section's contract and the renderer/Shopify actually support for
  that setting (an image slot doesn't silently accept a PDF).
- The resolved asset is retrievable at validation time — a live fetch/HEAD check, not just the presence of a
  reference string. This is what catches a URL that was valid when scraped but has since gone offline.

**Hard block:** the reference doesn't resolve at all — a 404, a deleted asset id, or a non-transient fetch
failure. A section with a broken image reference is a section that will render with a visibly broken image,
which fails the same "would this actually work" bar as every other hard block in the validation pipeline.
Example: a Hero section's `settings.image` was scraped from the merchant's previous storefront during Product
Import, and that URL now 404s → hard block, surfaced as "this image can no longer be found — please choose
another."

**Warning (non-blocking):** the asset resolves, but with a soft concern — file size approaching Shopify's
per-asset limit, or an aspect ratio poorly suited to the section's image slot.

**Feedback loop:** for an AI-caused failure (most commonly, an image chosen during initial generation that
later goes stale before the user gets to it), this routes back to the AI proposing a replacement — either
another asset already available in the Project's Product Data/media library, or a Clarification asking the user
to upload one. See [AI Architecture](04-ai-architecture.md).

## 12. Cleanup and Orphan Handling

**Status: TBD — not specified in the source planning record.** No policy for reclaiming an `Asset` that is no
longer referenced by any Store Configuration (a removed section, a replaced image, a discarded draft) is
defined. What is settled: a `GeneratedAsset` with `status: "discarded"` never enters the `Asset` table at all
(§8), so unaccepted generation candidates are not a cleanup concern — only orphaned *accepted* `Asset` rows are.
Whether orphaned assets are garbage-collected, retained indefinitely, or flagged for manual review is undecided
and should not be assumed.

## 13. Transformations and Optimization

**Status: TBD — not specified in the source planning record**, beyond the security-motivated re-encode step
every raster image passes through at ingestion (§4), which is a content-safety measure, not an optimization or
responsive-delivery pipeline. Format conversion (e.g. WebP), on-the-fly resizing, or responsive `srcset`
generation for Shopforge-hosted assets are not designed at this layer. This is a natural extension of the asset
storage provider decision (§5) — several plausible providers bundle transform/optimization delivery — but no
provider has been chosen, so no transformation behavior is asserted here. Note this only concerns
Shopforge-hosted assets: a product-bound image already gets Shopify's own transform/CDN behavior once resolved
post-publish (§9).

## 14. Open Questions / TBD

- **Final storage provider for assets** — TBD, Needs Investigation. Not to be invented here; blocks §5, §13,
  and the exact mechanics of §9's "Shopforge-hosted URL." See [Technical Dependencies](22-technical-dependencies.md).
- **Orphan/unused-asset cleanup policy** — TBD, Needs Investigation. See §12.
- **Image transformation/optimization pipeline for Shopforge-hosted assets** — TBD, Needs Investigation, likely
  resolved alongside the storage provider decision. See §13.
- **AI image generation (`generate_image`)** — deferred to post-MVP by product scope, not unresolved as a
  design question; the data model (`GeneratedAsset`, §8) is ready for it. See [MVP Scope](24-mvp-scope.md).
