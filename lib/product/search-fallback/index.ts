import { z } from "zod";
import { NormalizedProduct, NormalizedProductSchema } from "../types";
import { toNumber, toStringOrNull } from "../normalizer";
import { callOpenRouterChat, resolveSearchModel, SearchCitation } from "./openrouter-client";
import { PLATFORM_CONFIGS, PlatformSearchConfig } from "./platforms";
import { coreSearchQuery, scoreTitleRelevance } from "./relevance";
import { ProductSearchInput, ProductSearchResult } from "./types";

// Generic web-search fallback (docs: generic-web-search-fallback.md, etsy-web-search-fallback.md).
// Used when a supplier's direct retrieval fails or returns too little to trust. Runs bounded
// OpenRouter chat-completion calls (at most: one search + one retry on a transient failure +
// one tighter-query search when the first parsed fine but found nothing usable) and asks the
// model for a strict verdict (exact match / related candidates / nothing found) as JSON.
// Candidates come from two places: the model's JSON answer AND the search citations attached
// to it (url_citation annotations — verified live to name real listings the answer omitted).
// Every candidate is then validated (real product URL on the platform), deduplicated by
// product ID, and relevance-scored in code (relevance.ts) before anything is returned. Never
// fabricates a field the model didn't actually report finding.

const MAX_RELATED_RESULTS = 5;
/** Meaningful-term caps for the first (broad) and second (strongest-terms-only) search query. */
const PRIMARY_QUERY_TERMS = 8;
const TIGHT_QUERY_TERMS = 4;

// Search models report prices with whatever symbol the page showed (observed live: "₪").
// The UI and DB expect ISO codes, so known symbols are mapped and unknown junk is dropped.
const CURRENCY_SYMBOL_TO_ISO: Record<string, string> = {
  $: "USD", "US$": "USD", "£": "GBP", "€": "EUR", "¥": "JPY", "₹": "INR", "₪": "ILS",
  "₩": "KRW", "₺": "TRY", "C$": "CAD", "CA$": "CAD", "A$": "AUD", "AU$": "AUD",
  "NZ$": "NZD", "HK$": "HKD", "R$": "BRL", "₽": "RUB", "₴": "UAH", "zł": "PLN",
};

function toIsoCurrency(value: unknown): string | null {
  const raw = toStringOrNull(value)?.trim();
  if (!raw) return null;
  if (/^[A-Za-z]{3}$/.test(raw)) return raw.toUpperCase();
  return CURRENCY_SYMBOL_TO_ISO[raw] ?? null;
}

const CandidateSchema = z.object({
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  price: z.union([z.number(), z.string()]).nullable().optional(),
  currency: z.string().nullable().optional(),
  image: z.string().nullable().optional(),
  vendor: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
});

type Candidate = z.infer<typeof CandidateSchema>;

const VerdictSchema = z.object({
  matchType: z.enum(["exact", "related", "none"]),
  exact: CandidateSchema.nullable().optional(),
  related: z.array(CandidateSchema).nullable().optional(),
});

/**
 * Citation titles are search-result page titles — the listing title plus site branding and a
 * truncation ellipsis ("Beige Bucket Bag, Medium Size Leather ... - Etsy"). Strips the
 * branding/ellipsis so what remains is comparable to (and displayable as) a product title.
 */
function cleanCitationTitle(title: string | null): string | null {
  if (!title) return null;
  const cleaned = title
    .replace(/^Amazon(\.[a-z.]{2,6})?\s*:\s*/i, "")
    .replace(/\s*[-|–]\s*Etsy\s*$/i, "")
    .replace(/\s*(\.\.\.|…)\s*$/, "")
    .trim();
  return cleaned.length >= 3 ? cleaned : null;
}

function candidateToNormalizedProduct(
  candidate: Candidate,
  fallbackUrl: string,
  source: "search_exact" | "search_related",
  config: PlatformSearchConfig,
): NormalizedProduct {
  // Only an image on the platform's own CDN is trustworthy enough to display — a wrong image
  // silently misrepresents the product, while a missing one honestly shows "No image".
  const image = candidate.image && config.isTrustedImageUrl(candidate.image) ? candidate.image : null;
  const rawUrl = toStringOrNull(candidate.url ?? null);
  return NormalizedProductSchema.parse({
    title: toStringOrNull(candidate.title ?? null),
    description: toStringOrNull(candidate.description ?? null),
    price: toNumber(candidate.price ?? null),
    compareAtPrice: null,
    currency: toIsoCurrency(candidate.currency ?? null),
    images: image ? [{ url: image, altText: toStringOrNull(candidate.title ?? null) }] : [],
    variants: [],
    options: [],
    vendor: toStringOrNull(candidate.vendor ?? null),
    // Canonicalized so the same listing dedupes across locale-prefixed URL variants and so
    // downstream enrichment can key off the product ID.
    productUrl: rawUrl ? config.canonicalUrl(rawUrl) ?? rawUrl : fallbackUrl,
    source,
  });
}

function buildSystemPrompt(
  input: ProductSearchInput,
  config: PlatformSearchConfig,
  domain: string,
  nativeSearch: boolean,
  searchQuery: string | null,
): string {
  // The query prioritizes the product's core identity over the raw marketing title —
  // coreSearchQuery collapses a long title to its meaningful terms; a weak/absent title
  // falls back to whatever title text exists.
  const query = [input.vendor, searchQuery ?? input.title].filter(Boolean).join(" ");
  const steps: string[] = nativeSearch
    ? [`1. Try to locate the exact listing at ${input.sourceUrl} in your search results.`]
    : [
        `1. Use the web fetch tool on the exact product URL: ${input.sourceUrl} — if it returns product page content, that IS the exact listing; extract its data and you're done.`,
      ];
  if (query) {
    steps.push(
      `${steps.length + 1}. ${nativeSearch ? "If the exact listing doesn't surface, search" : "If that fetch fails or returns no product content, search"} site:${domain} for: "${query}".` +
        (input.listingId
          ? ` A result whose URL contains the ${config.idLabel} ${input.listingId} is the exact listing${nativeSearch ? "" : " — fetch that URL to read its data"}.`
          : ""),
    );
  }
  steps.push(
    `${steps.length + 1}. If the exact listing still can't be confirmed, collect up to ${MAX_RELATED_RESULTS} clearly relevant, similar listings on ${domain} from those searches instead.`,
  );

  // Every reliable signal direct extraction produced goes into the prompt — the title is the
  // primary search signal, but a partial description/price/seller sharpens candidate ranking.
  const knownDetails: string[] = [];
  if (input.title) knownDetails.push(`Title: ${input.title}`);
  if (input.vendor) knownDetails.push(`Seller/brand: ${input.vendor}`);
  if (typeof input.price === "number") {
    knownDetails.push(`Price: ${input.price}${input.currency ? ` ${input.currency}` : ""}`);
  }
  if (input.description) knownDetails.push(`Description (from the original page): ${input.description.slice(0, 300)}`);

  return [
    nativeSearch
      ? `You are locating a product listing on ${domain} using your web search. Only consider results on ${domain}.`
      : `You are locating a product listing on ${domain}. You have a web search tool and a web fetch tool, both restricted to ${domain}.`,
    knownDetails.length > 0
      ? `Known details about the requested product:\n${knownDetails.join("\n")}`
      : "",
    `Do this, in order:`,
    steps.join("\n"),
    `Never search for the bare ${config.idLabel} on its own — numeric-ID searches mostly match unrelated sites (part numbers, phone numbers). Ignore any search result that is not on ${domain}.`,
    `A related listing must be the same type of product as the requested one AND share its key attributes (design, material, color, style, intended use) — for example, for a pink cherry-blossom tree lamp: other blossom/floral tree lamps, never generic lamps, and never another product category entirely. Sharing one word with the title is not enough. It is better to return fewer related listings, or none, than to include a product that merely resembles the request.`,
    `Only ever return direct product/listing page URLs matching ${config.productPathHint} — never search pages, category or market pages (URLs containing /search, /market/, or /s?), homepages, or shop pages.`,
    `Report each listing's seller/shop name in "vendor" whenever it appears anywhere in your results — "From shop X", "by X", or a ${domain}/shop/<name> URL. The shop name is used afterwards to retrieve the listing's real product image, so actively look for it.`,
    nativeSearch
      ? `For each listing, report the title, description, price, currency, and main product image URL (${config.imageCdnHint}) ONLY when your search results actually contain them for that specific listing. The "image" field must be the image belonging to that candidate's own page — never an image from a different result.`
      : `Search results alone often only give you a title and a snippet — not a reliable price or image. For the exact listing AND for each related listing you return, use the web fetch tool on its URL to read the actual page content (title, description, price, currency, and main product image — ${config.imageCdnHint}). The "image" field must be the image from that candidate's own page — never an image from a different result. Search snippets don't carry images, so a result without a fetch will show as an empty card. If a fetch fails or is blocked, still return that listing with whatever real data the search snippet gave you, leaving the rest null.`,
    `Extract only data actually present in what you retrieved — never invent a price, image, description, or vendor you didn't actually see. Never label a merely-similar listing as exact, and always include each related listing's ${domain} URL.`,
    `Use matchType "none" only when you found nothing relevant on ${domain} at all.`,
    `Respond with ONLY a single JSON object, no other text, matching exactly this shape:`,
    `{"matchType":"exact"|"related"|"none","exact":{"title":string|null,"description":string|null,"price":number|null,"currency":string|null,"image":string|null,"vendor":string|null,"url":string}|null,"related":[{"title":string|null,"description":string|null,"price":number|null,"currency":string|null,"image":string|null,"vendor":string|null,"url":string}]|null}`,
    `Use null for any field you don't actually have real data for. Do not guess or fabricate.`,
  ]
    .filter(Boolean)
    .join("\n\n");
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

/**
 * One chat call, parsed into a verdict (plus the search citations that came with it).
 * Distinguishes a config error (retrying can't help) from a transient one (network blip,
 * model answered prose instead of JSON — both observed live), so the caller can retry
 * exactly the failures worth retrying.
 */
async function requestVerdict(
  input: ProductSearchInput,
  config: PlatformSearchConfig,
  domain: string,
  searchQuery: string | null,
): Promise<
  | { verdict: z.infer<typeof VerdictSchema>; citations: SearchCitation[] }
  | { verdict: null; error: string; retryable: boolean }
> {
  // A search-native model (perplexity/*) performs its own web search and rejects a tools
  // array outright; anything else drives OpenRouter's search/fetch tools explicitly.
  const { nativeSearch } = resolveSearchModel();
  const chatResult = await callOpenRouterChat({
    systemPrompt: buildSystemPrompt(input, config, domain, nativeSearch, searchQuery),
    userPrompt: `Verify and, if possible, locate the product at ${input.sourceUrl}.`,
    tools: nativeSearch
      ? []
      : [
          {
            type: "openrouter:web_search",
            max_results: 5,
            filters: { allowed_domains: [domain] },
          },
          {
            // Lets the model read the actual page content for a candidate URL (title, price)
            // once identified, instead of relying only on the search snippet. Note the fetched
            // content is cleaned text with every image URL stripped (verified live) — images are
            // filled in afterwards by the supplier's own enrichment (e.g. Etsy shop RSS).
            type: "openrouter:web_fetch",
            filters: { allowed_domains: [domain] },
          },
        ],
  });

  if (!chatResult.ok) {
    return { verdict: null, error: chatResult.error, retryable: !/OPENROUTER_API_KEY|API key/.test(chatResult.error) };
  }

  const rawJson = extractJsonObject(chatResult.text);
  const parsedVerdict = rawJson === null ? null : VerdictSchema.safeParse(rawJson);
  if (!parsedVerdict?.success) {
    return { verdict: null, error: "Web search returned an unreadable response.", retryable: true };
  }
  return { verdict: parsedVerdict.data, citations: chatResult.citations ?? [] };
}

type AttemptOutcome =
  | { type: "result"; result: ProductSearchResult }
  | { type: "none" }
  | { type: "error"; error: string };

async function runSearchAttempt(
  input: ProductSearchInput,
  config: PlatformSearchConfig,
  domain: string,
  searchQuery: string | null,
  opts: { retryTransient: boolean },
): Promise<AttemptOutcome> {
  let outcome = await requestVerdict(input, config, domain, searchQuery);
  if (outcome.verdict === null && opts.retryTransient && outcome.retryable) {
    outcome = await requestVerdict(input, config, domain, searchQuery); // one bounded retry — flaky non-JSON answers are common
  }
  if (outcome.verdict === null) {
    return { type: "error", error: outcome.error };
  }
  const { verdict, citations } = outcome;

  // An "exact" verdict whose URL names a DIFFERENT product ID than the requested one is a
  // mislabel (observed live with an unfindable listing ID: the model returned a similar
  // listing as "exact") — it joins the related pool below instead of silently substituting
  // the product. A matching or missing/off-platform URL is fine: the exact match IS the
  // source listing, so those just fall back to the source URL.
  let demotedExact: Candidate | null = null;
  if (verdict.matchType === "exact" && verdict.exact) {
    const url = verdict.exact.url && config.isCandidateUrl(verdict.exact.url) ? verdict.exact.url : null;
    const claimedKey = url ? config.productKey(url) : null;
    if (input.listingId && claimedKey && claimedKey !== input.listingId) {
      demotedExact = verdict.exact;
    } else {
      const exact = { ...verdict.exact, url };
      return {
        type: "result",
        result: { matchType: "exact", product: candidateToNormalizedProduct(exact, input.sourceUrl, "search_exact", config) },
      };
    }
  }

  // OpenRouter's allowed_domains filter has been observed not to be enforced, so a candidate
  // can come from anywhere the search wandered — keep only URLs that are real product pages on
  // the supplier's platform (isCandidateUrl also rejects /market//search/category pages,
  // observed live in the model's "related" list). The citations attached to the answer are a
  // second candidate source: they regularly name real listings (with titles) the JSON omitted.
  // Also note the model sometimes fills `related` while still labeling the verdict "none"
  // (observed live) — a non-empty usable related list is a related result regardless of label,
  // as long as no exact match was confirmed.
  const modelRelated = [...(verdict.related ?? []), ...(demotedExact ? [demotedExact] : [])].filter(
    (c): c is Candidate & { url: string } => !!c.url && config.isCandidateUrl(c.url),
  );
  const citationCandidates: (Candidate & { url: string })[] = citations
    .filter((c) => config.isCandidateUrl(c.url))
    .map((c) => ({ title: cleanCitationTitle(c.title), url: c.url }));

  // A candidate (from either source) whose URL names the requested product's own ID is the
  // exact listing — search found it even though the model didn't label it "exact" (observed
  // live: the source listing appearing in citations while the verdict said "related").
  if (input.listingId) {
    const fromModel = modelRelated.find((c) => config.productKey(c.url) === input.listingId);
    const fromCitation = citationCandidates.find((c) => config.productKey(c.url) === input.listingId);
    if (fromModel || fromCitation) {
      const base = fromModel ?? fromCitation!;
      const exact = { ...base, title: base.title ?? fromCitation?.title ?? input.title };
      return {
        type: "result",
        result: { matchType: "exact", product: candidateToNormalizedProduct(exact, input.sourceUrl, "search_exact", config) },
      };
    }
  }

  // Merge the two candidate sources, model candidates first (they carry more fields), deduped
  // by product ID so the same listing's locale variants collapse to one candidate.
  const seen = new Set<string>();
  const pool: (Candidate & { url: string })[] = [];
  for (const candidate of [...modelRelated, ...citationCandidates]) {
    const key = config.productKey(candidate.url) ?? candidate.url;
    if (key === input.listingId || seen.has(key)) continue;
    seen.add(key);
    pool.push(candidate);
  }

  // Deterministic relevance guard + ranking (relevance.ts): drop candidates that aren't the
  // same type of product, rank the rest so the closest matches surface first.
  const scored = pool
    .map((candidate) => ({
      candidate,
      score: input.title && candidate.title ? scoreTitleRelevance(input.title, candidate.title) : null,
    }))
    .filter(({ candidate, score }) => {
      if (!input.title) return true; // nothing to compare against — the model's judgment stands
      if (!candidate.title) return false; // can't verify relevance without a title — don't show it
      return score!.relevant;
    });
  scored.sort((a, b) => (b.score?.score ?? 0) - (a.score?.score ?? 0));

  const related = scored
    .slice(0, MAX_RELATED_RESULTS)
    .map(({ candidate }) => candidateToNormalizedProduct(candidate, input.sourceUrl, "search_related", config));
  if (related.length > 0) {
    return { type: "result", result: { matchType: "related", products: related } };
  }
  return { type: "none" };
}

export async function searchProductFallback(input: ProductSearchInput): Promise<ProductSearchResult> {
  const config = PLATFORM_CONFIGS[input.sourcePlatform];
  const domain = config?.searchDomain(input.sourceUrl) ?? null;
  if (!config || !domain) {
    return { matchType: "error", error: `Web search fallback isn't configured for ${input.sourcePlatform}.` };
  }

  const primaryQuery = input.title ? coreSearchQuery(input.title, PRIMARY_QUERY_TERMS) : null;
  const first = await runSearchAttempt(input, config, domain, primaryQuery, { retryTransient: true });
  if (first.type === "result") return first.result;
  if (first.type === "error") return { matchType: "error", error: first.error };

  // The first search parsed fine but produced nothing usable — one bounded second attempt
  // with only the strongest product terms (a long/noisy title is the usual culprit). No
  // uncontrolled loop: this is the last search, and its transient failures aren't retried.
  const tightQuery = input.title ? coreSearchQuery(input.title, TIGHT_QUERY_TERMS) : null;
  if (tightQuery && tightQuery !== primaryQuery) {
    const second = await runSearchAttempt(input, config, domain, tightQuery, { retryTransient: false });
    if (second.type === "result") return second.result;
  }
  return { matchType: "none" };
}
