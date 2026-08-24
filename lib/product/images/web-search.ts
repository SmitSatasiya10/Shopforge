import { z } from "zod";
import { callOpenRouterChat, resolveSearchModel } from "../search-fallback/openrouter-client";
import { scoreTitleRelevance, coreSearchQuery } from "../search-fallback/relevance";
import { validateImageUrl } from "../fetcher";
import type { NormalizedProduct } from "../types";

// "Other images we found for your product" (shopforge-personalization-image-selection-plan.md
// §9-12): real photos of the same product discovered on the web, as a secondary source
// alongside the product's own imported photos and AI-generated photography. Deliberately NOT
// the Etsy/Amazon-specific search-fallback pipeline (lib/product/search-fallback/index.ts) —
// that pipeline finds an alternate LISTING of the product on one named supplier platform; this
// module finds additional IMAGES of an already-known product anywhere on the web, so it has no
// platform/domain restriction and returns image URLs directly rather than a competing product
// record. It reuses the same OpenRouter caller and the same title-relevance guard (a beige
// leather bucket bag must not come back with unrelated handbag/wallet images).

const MAX_CANDIDATES = 4;
const QUERY_TERMS = 6;

const CandidateSchema = z.object({
  title: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  pageUrl: z.string().nullable().optional(),
});
const ResponseSchema = z.object({ images: z.array(CandidateSchema) });

function isHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

function buildPrompt(product: NormalizedProduct, query: string, nativeSearch: boolean) {
  const known = [
    product.vendor ? `Brand/seller: ${product.vendor}` : null,
    product.description ? `Description: ${product.description.slice(0, 300)}` : null,
  ].filter(Boolean);
  return [
    nativeSearch
      ? `You are finding real product photographs on the web for an ecommerce store.`
      : `You are finding real product photographs on the web for an ecommerce store. You have a web search tool restricted to image results.`,
    `Product: ${product.title ?? query}`,
    ...known,
    `Search for: "${query}" product photo`,
    `Return up to ${MAX_CANDIDATES} images that show THIS EXACT product (or, if unavailable, a` +
      ` clearly identical product from the same listing/brand) — never a different product that` +
      ` merely shares a category or a color/material with it.`,
    `Only report an image URL you actually found in your search results — never invent or guess` +
      ` one. "pageUrl" is the page the image came from, when known.`,
    `Respond with ONLY a single JSON object, no other text, matching exactly this shape:`,
    `{"images":[{"title":string|null,"imageUrl":string|null,"pageUrl":string|null}]}`,
    `Use an empty array if you found nothing suitable.`,
  ].join("\n\n");
}

function extractJsonObject(text: string): unknown | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

export interface WebImageCandidate {
  url: string;
  altText: string | null;
}

/**
 * Finds up to MAX_CANDIDATES real, relevant, reachable photos of the given product on the
 * web. Best-effort and silent on failure (no API key, search error, unreadable response, or
 * every candidate rejected all just resolve to an empty list) — this is one of three image
 * sources feeding the wizard step, never the only one, so it must never throw or block the
 * step (shopforge-personalization-image-selection-plan.md §8/§28).
 */
export async function findWebProductImages(product: NormalizedProduct): Promise<WebImageCandidate[]> {
  const title = product.title;
  if (!title) return [];
  const query = coreSearchQuery(title, QUERY_TERMS) ?? title;

  const { nativeSearch } = resolveSearchModel();
  const result = await callOpenRouterChat({
    systemPrompt: buildPrompt(product, query, nativeSearch),
    userPrompt: `Find real product photographs for: ${title}`,
    tools: nativeSearch ? [] : [{ type: "openrouter:web_search", max_results: 8 }],
  });
  if (!result.ok) return [];

  const raw = extractJsonObject(result.text);
  const parsed = raw === null ? null : ResponseSchema.safeParse(raw);
  if (!parsed?.success) return [];

  // Relevance guard first (cheap, no network) — a wallet returned for a bucket-bag query is
  // rejected before ever spending a reachability check on it.
  const relevant = parsed.data.images.filter((c): c is z.infer<typeof CandidateSchema> & { imageUrl: string } => {
    if (!c.imageUrl || !isHttpsUrl(c.imageUrl)) return false;
    if (!c.title) return true; // no title to score — let the reachability check be the guard
    return scoreTitleRelevance(title, c.title).relevant;
  });

  // Reachability guard (network) — only spend it on candidates that already passed relevance,
  // and stop once enough valid images are found rather than validating every candidate.
  const accepted: WebImageCandidate[] = [];
  for (const candidate of relevant) {
    if (accepted.length >= MAX_CANDIDATES) break;
    if (await validateImageUrl(candidate.imageUrl)) {
      accepted.push({ url: candidate.imageUrl, altText: candidate.title ?? null });
    }
  }
  return accepted;
}
