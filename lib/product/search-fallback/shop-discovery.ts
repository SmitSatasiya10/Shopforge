import { z } from "zod";
import { callOpenRouterChat, OpenRouterChatResult, resolveSearchModel } from "./openrouter-client";

// Etsy shop discovery — the recovery path for listings search can't see.
//
// A brand-new Etsy listing exists in no search index yet, so the search fallback can only ever
// return related items for it — but a NEW listing is by definition among its shop's ~10 most
// recent, i.e. inside the shop RSS feed's window (the one bot-open Etsy endpoint carrying real
// images/prices). Search results readily surface SHOP names for a product type even when they
// can't surface a specific listing (verified live: the shop behind an un-indexed organza phone
// strap was found on the first try, and its feed contained the exact requested listing with
// image and price). This module makes one bounded OpenRouter call (same key, no new provider)
// asking for shops that sell the requested kind of product, harvesting both the model's answer
// and any etsy.com/shop/<name> URLs in its search citations. Strictly best-effort: any failure
// resolves to an empty list.

const MAX_SHOPS = 4;

/** Shop names are single alphanumeric tokens; anything else is not safe to splice into a URL. */
const SHOP_NAME_RE = /^[A-Za-z0-9]{3,}$/;

const ShopListSchema = z.array(z.string());

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

/** The shop name out of an etsy.com/shop/<name> URL, or null. */
export function shopFromCitationUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (!/(^|\.)etsy\.com$/i.test(url.hostname)) return null;
    return url.pathname.match(/\/shop\/([A-Za-z0-9]{3,})(?:\/|$)/)?.[1] ?? null;
  } catch {
    return null;
  }
}

// Wording matters: without the explicit site:etsy.com instruction the model's search was
// observed wandering off to Amazon/TikTok and returning nothing; with it, the shop behind an
// un-indexed listing was found on 4 of 4 live probes.
const SYSTEM_PROMPT = [
  "You are finding Etsy shops that sell a given type of product.",
  "Search etsy.com only — use site:etsy.com in your searches (for example: site:etsy.com <product terms> shop).",
  'Look at listing pages (the seller is shown as "From shop X" / "by X") and shop pages (etsy.com/shop/<name>).',
  "Etsy shop names are single alphanumeric tokens.",
  `Respond ONLY with a JSON array of shop name strings, e.g. ["ShopOne","ShopTwo"]. Up to ${MAX_SHOPS}.`,
  "Report only shop names you actually observed in your results. Never guess or invent a shop name.",
].join("\n");

/**
 * Discovers Etsy shops selling the described kind of product, in one bounded chat call.
 * Combines the model's JSON answer with shop URLs found in its search citations.
 */
export async function discoverEtsyShops(
  productQuery: string,
  chat: (req: Parameters<typeof callOpenRouterChat>[0]) => Promise<OpenRouterChatResult> = callOpenRouterChat,
): Promise<string[]> {
  const { nativeSearch } = resolveSearchModel();
  const result = await chat({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: `Product: ${productQuery}`,
    tools: nativeSearch
      ? []
      : [{ type: "openrouter:web_search", max_results: 5, filters: { allowed_domains: ["etsy.com"] } }],
  });
  if (!result.ok) return [];

  const answered = ShopListSchema.safeParse(extractJsonArray(result.text));
  const fromCitations = (result.citations ?? [])
    .map((c) => shopFromCitationUrl(c.url))
    .filter((s): s is string => s !== null);

  const shops: string[] = [];
  for (const shop of [...(answered.success ? answered.data : []), ...fromCitations]) {
    if (!SHOP_NAME_RE.test(shop) || shops.includes(shop)) continue;
    shops.push(shop);
    if (shops.length >= MAX_SHOPS) break;
  }
  return shops;
}
