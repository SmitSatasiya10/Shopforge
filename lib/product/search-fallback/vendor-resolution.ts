import { z } from "zod";
import { parseEtsyListingId } from "../suppliers/etsy";
import { callOpenRouterChat, OpenRouterChatResult, resolveSearchModel } from "./openrouter-client";
import { shopFromCitationUrl } from "./shop-discovery";

// Etsy shop-name resolution — the missing link between search candidates and images.
//
// Observed live: the search verdict's related candidates almost always come back with
// vendor:null, and the shop name is the ONLY key into Etsy's public per-shop RSS feed — the
// one Etsy endpoint not behind bot protection that carries real listing images. This module
// makes at most ONE additional bounded OpenRouter call (same OPENROUTER_API_KEY, no new
// provider) asking the search model to name the shop behind each candidate listing (URL plus
// title — the title lets it search by product words, not just the opaque URL). Verified live
// to resolve shops the first search call missed, and to answer null honestly for listings
// whose shop isn't visible in search results.
//
// Even when every per-listing answer is null, the call's search CITATIONS often surface
// etsy.com/shop/<name> URLs of shops selling this kind of product (observed live) — those are
// returned separately so the caller can use their feeds for relevance-gated top-ups.
// Strictly best-effort: any failure resolves to an empty result, never an error.

const MAX_LOOKUP_LISTINGS = 6;

/** Shop names are single alphanumeric tokens; anything else is not safe to splice into a URL. */
const SHOP_NAME_RE = /^[A-Za-z0-9]{3,}$/;

const ShopAnswerSchema = z.array(
  z.object({
    url: z.string(),
    shop: z.string().nullable().optional(),
  }),
);

function extractJsonArray(text: string): unknown | null {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

const SYSTEM_PROMPT = [
  "You are identifying the seller shops of specific Etsy listings.",
  "For each listing below (URL, plus its title when given), use web search — including searches like: site:etsy.com <title words> shop — to find the shop (seller) name that sells it.",
  'Etsy shop names are single alphanumeric tokens, visible on the listing page as "From shop X", as "by X", or in shop URLs like etsy.com/shop/<name>.',
  'Respond ONLY with a JSON array, no other text: [{"url": string, "shop": string|null}] — one entry per input listing.',
  "Use null when you cannot actually see the shop name for that specific listing. Never guess a shop name.",
].join("\n");

export interface EtsyShopResolution {
  /** Listing URL (exactly as passed in) -> shop name; unresolved listings are absent. */
  byUrl: Map<string, string>;
  /** Shops surfaced by the call's search citations (etsy.com/shop/... URLs) — not tied to a specific listing. */
  citedShops: string[];
}

/**
 * Resolves Etsy shop names for candidate listings in one bounded chat call.
 */
export async function resolveEtsyShopNames(
  listings: { url: string; title: string | null }[],
  chat: (req: Parameters<typeof callOpenRouterChat>[0]) => Promise<OpenRouterChatResult> = callOpenRouterChat,
): Promise<EtsyShopResolution> {
  const batch = listings.slice(0, MAX_LOOKUP_LISTINGS);
  const resolution: EtsyShopResolution = { byUrl: new Map(), citedShops: [] };
  if (batch.length === 0) return resolution;

  const { nativeSearch } = resolveSearchModel();
  const result = await chat({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: batch.map((l) => (l.title ? `${l.url} — ${l.title}` : l.url)).join("\n"),
    tools: nativeSearch
      ? []
      : [{ type: "openrouter:web_search", max_results: 5, filters: { allowed_domains: ["etsy.com"] } }],
  });
  if (!result.ok) return resolution;

  for (const citation of result.citations ?? []) {
    const shop = shopFromCitationUrl(citation.url);
    if (shop && SHOP_NAME_RE.test(shop) && !resolution.citedShops.includes(shop)) {
      resolution.citedShops.push(shop);
    }
  }

  const parsed = ShopAnswerSchema.safeParse(extractJsonArray(result.text));
  if (!parsed.success) return resolution;

  // Answers are matched back to inputs by listing ID, not by string-equal URL — the model
  // routinely echoes a locale-prefixed variant (/ca/listing/..., /il-en/listing/...) of the
  // URL it was given.
  const inputByListingId = new Map<string, string>();
  for (const { url } of batch) {
    const id = parseEtsyListingId(url);
    if (id) inputByListingId.set(id, url);
  }
  for (const entry of parsed.data) {
    if (!entry.shop || !SHOP_NAME_RE.test(entry.shop)) continue;
    const id = parseEtsyListingId(entry.url);
    const inputUrl = id ? inputByListingId.get(id) : undefined;
    if (inputUrl) resolution.byUrl.set(inputUrl, entry.shop);
  }
  return resolution;
}
