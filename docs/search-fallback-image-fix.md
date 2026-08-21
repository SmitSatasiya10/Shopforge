# Web-Search Fallback Fix — Search, Enrichment & Image Extraction

Date: 2026-08-21 · Branch: `feat/product-scraping-import` · Follow-up to [etsy-supplier-import-audit.md](etsy-supplier-import-audit.md). Everything below was verified with live runs against the real OpenRouter key and real Etsy endpoints, then re-verified through the actual import API (`POST /api/product/import`, `source: "supplier"`).

## 1. Diagnosis of the "No image" failure (live evidence)

Traced with a fetch tap around `importSupplierProduct` for the two reported URLs (bucket bag `1612987502`, cherry-blossom lamp `4529233980`):

| Step | Finding |
| --- | --- |
| Which URLs OpenRouter returned | Real listing URLs **plus `/market/...` category pages** in the `related` list, and additional real listings only in `url_citation` annotations that the code threw away |
| Which URLs passed validation | Everything on `etsy.com` — the Etsy candidate check was hostname-only, so `/market/` and `/search` pages passed and rendered as broken cards |
| Were candidate pages fetched | Never — no candidate-enrichment stage existed |
| Did fetches succeed when tried | No — every Etsy listing/shop page 403s (DataDome), with any User-Agent; only `/shop/<name>/rss` is open |
| Did JSON-LD/OG metadata contain an image | Unreachable behind the 403; the search model itself honestly returns `image: null` (search text carries no image URLs; `return_images` does not pass through OpenRouter) |
| Was an image rejected by the trust guard | No — the guard almost never fired because no image ever arrived |
| Why `images: []` | Every related candidate arrived with `vendor: null`, so the shop-RSS enrichment (the only image source) **never ran at all**; for exact matches the listing was outside the shop feed's window |

Additional live findings: the RSS feed holds only a shop's **10 newest listings** (no pagination — `?page=`/`?limit=` are ignored; `/sold/rss` etc. are 404), currency sometimes arrives as a bare symbol (`"₪"`), and with an unfindable listing ID the model labels a *different* listing `"exact"`.

## 2. What changed

All within the existing `OPENROUTER_API_KEY` / OpenRouter setup — no new provider, key, or env var.

| Module | Change |
| --- | --- |
| [search-fallback/platforms.ts](../lib/product/search-fallback/platforms.ts) (new) | Platform config extracted; **Etsy candidate URLs now require a `/listing/<id>`** (mirrors Amazon's ASIN rule), killing `/market//search` candidates; adds canonical-URL + product-ID helpers |
| [search-fallback/relevance.ts](../lib/product/search-fallback/relevance.ts) (new) | Deterministic scorer separating *identity* tokens (bucket, bag, lamp) from *modifier* tokens (color/material/size). Candidates sharing only a modifier ("Leather Wallet") are rejected; product type is the strongest signal; ranking by weighted overlap. Also builds the focused search query from a long marketing title |
| [search-fallback/openrouter-client.ts](../lib/product/search-fallback/openrouter-client.ts) | Surfaces `url_citation` annotations (`citations`) alongside the text answer |
| [search-fallback/index.ts](../lib/product/search-fallback/index.ts) | Citations join the candidate pool (titles cleaned of `- Etsy`/ellipsis); a citation naming the requested listing ID is **promoted to an exact match**; an "exact" verdict naming a *different* ID is **demoted to related** (never substitute the product); candidates deduped by listing ID across locale variants and canonicalized; currency symbols mapped to ISO (`₪`→ILS); one bounded second search attempt with only the strongest terms when the first finds nothing (max 3 chat calls incl. the transient retry — no loop); related results capped at 5 |
| [search-fallback/page-enrich.ts](../lib/product/search-fallback/page-enrich.ts) (new) | Every incomplete candidate's own page is fetched once (bounded concurrency) and mined with the existing extractors in trust order: JSON-LD `image` → `og:image` → Amazon `#landingImage`. Best-effort: Etsy's 403s pass through in ~200ms |
| [search-fallback/vendor-resolution.ts](../lib/product/search-fallback/vendor-resolution.ts) (new) | One additional bounded OpenRouter call resolving shop names for candidates missing `vendor` (answers matched back by listing ID; invalid shop tokens rejected; failures → empty map) |
| [search-fallback/shop-discovery.ts](../lib/product/search-fallback/shop-discovery.ts) (new) | One bounded OpenRouter call finding Etsy **shops** that sell the requested kind of product (shop names surface in search results even when a specific listing doesn't); harvests the JSON answer plus `etsy.com/shop/` citation URLs; validated and capped at 4 |
| [suppliers/etsy.ts](../lib/product/suppliers/etsy.ts) | Full enrichment pipeline `enrichEtsySearchCandidates`: canonicalize → resolve shops → RSS enrichment (shared feed cache) → **shop discovery + exact-listing recovery** (see below) → **same-shop top-up**: relevant listings from known shops' feeds join the related list with guaranteed image/price/description from Etsy itself (higher relevance bar, deduped, capped at 5, ranked by score with image-bearing ties first) |
| [import.ts](../lib/product/import.ts) | Wires the stages: search → page enrichment → platform enrichment, for exact and related modes; a `search_exact` product recovered during related-mode enrichment flips the result to a single-product outcome |

**Exact-listing recovery (the key insight):** a brand-new Etsy listing exists in no search index — but a new listing is by definition among its shop's ~10 most recent, i.e. *inside the shop RSS feed's window*. So when the requested listing is still missing/imageless, the pipeline asks the search model which shops sell this kind of product, then scans those shops' feeds for the requested **listing ID**. An ID hit is airtight — it is the requested product, with its real image, price, and description, straight from Etsy. Verified live: the un-indexed organza phone strap (`4555238238`), which previously produced three imageless "Related" cards, now imports as the exact product with image, price `44.90 USD`, and vendor.

The image trust guard is unchanged: only platform-CDN images (or images extracted from the candidate's own page) are ever displayed; nothing is fabricated; a candidate without a provable image shows "No image". UI untouched.

## 3. Verification

- `npx vitest run lib/product/` — **171 tests green** (55 new, each new one pinned to a live-observed failure), `npx tsc --noEmit` clean, `npm run lint` clean.
- Through the real import API:
  - Organza phone strap `4555238238` (un-indexed; previously 3 imageless "Related" cards) → **exact product recovered via shop discovery**, with real image, price `44.90 USD`, vendor, full description.
  - Bucket bag `1612987502` → **exact match** (title, price, ISO currency, vendor `DrinaBags`). No image — the listing is outside the shop's 10-item RSS window and the page 403s; honestly shows "No image".
  - Cherry-blossom lamp `4529233980` → **exact match** (title, description, price `94.03 ILS`). Shop not visible in search and not discoverable → no image, honestly.
  - Unfindable ID + bucket-bag slug → **mode `related`**, 5 candidates, all genuinely beige/leather bucket bags (wallets/pouches rejected by the scorer), including a same-shop top-up card with a real `i.etsystatic.com` image, price, and vendor. The model's mislabeled "exact" was demoted to a related card.
  - Amazon spot-check → product with `m.media-amazon.com` image, unregressed.

## 3b. Where images still fail — traced example (denim knot pillow `4553260488`)

Every stage ran and behaved correctly; the wall is data availability, not a bug:

1. Listing page fetch → 403 (DataDome), so no JSON-LD/og:image.
2. Search verdict → 5 genuinely relevant denim-pillow candidates, but `vendor: null` on all — Google-style results for Etsy listings do not show the seller.
3. Vendor-resolution call (now with titles) → honest nulls or occasional shops whose feeds hold no pillows (feeds verified live); its citations sometimes surface a usable shop (`TatteredSisters`, whose feed is full of image-complete denim pillows) — those are now harvested and fed to the top-up, but which citations appear varies per run.
4. Shop discovery → for this niche product the model returns names taken from YouTube/off-platform pages (`KnottyButNice`, `FringedDenimPillow`); feed validation rejects them (301-to-`/people/` or 404), so nothing wrong is ever displayed — but nothing is gained either.

So a card gets an image **exactly when some real shop selling this kind of product can be attributed from search results**. That succeeded for the phone strap (exact product + image recovered) and the bucket-bag related set (top-up card with image); for the denim pillow it fails in most runs. This is the honest limit of key-less Etsy access.

## 4. Remaining known limit

Etsy images are only obtainable from a shop's RSS feed (10 newest listings per shop). Recent listings are therefore recoverable with images even when un-indexed (shop discovery), but an **older** listing that search can't attribute to a shop — or that has fallen out of its shop's feed window — can still legitimately show "No image". Every other route (page fetch, search snippets, OpenRouter image passthrough, RSS pagination, alternate feeds, Wayback snapshots, model-reported image URLs) was tested live and is closed. Raising coverage further would require Etsy's official API (out of scope: no new keys).
