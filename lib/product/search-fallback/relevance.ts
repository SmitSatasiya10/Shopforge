// Deterministic relevance model for web-search fallback candidates.
//
// The model's judgment alone proved too loose (observed live: wallets returned as "related"
// to a bucket-bag request), so every candidate is also scored in code against the requested
// product's title. The scoring distinguishes *identity* tokens (what the product IS — "bucket",
// "bag", "lamp") from *modifier* tokens (color/material/size — "beige", "leather", "medium"):
// a candidate that only shares modifiers ("Leather Wallet" for a leather bucket bag) is a
// different product wearing the same attributes and must be rejected, while identity overlap
// is the strongest possible signal (the product type). Exact matching is deliberately NOT
// required — the goal is high semantic similarity, not equality.

/** Words that carry no product identity at all — grammar plus Etsy/Amazon marketing filler. */
const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "this", "that", "your", "you", "our",
  "gift", "gifts", "new", "sale", "free", "shipping", "handmade", "custom", "personalized",
  "her", "him", "mom", "dad", "cute", "aesthetic", "perfect", "unique", "quality",
  // "one of a kind", "made to order" — listing-title boilerplate, not product identity
  "one", "kind", "made", "order",
]);

/** Color words are attributes of a product, never the product itself. */
const COLOR_WORDS = new Set([
  "beige", "black", "white", "red", "blue", "navy", "green", "yellow", "pink", "purple",
  "brown", "gray", "grey", "cream", "ivory", "tan", "orange", "burgundy", "maroon", "teal",
  "turquoise", "lavender", "lilac", "nude", "cognac", "camel", "khaki", "olive", "coral",
  "magenta", "violet", "indigo", "charcoal", "taupe", "blush", "mint", "mustard", "rust",
]);

/** Material words — strong attributes, but sharing only a material is not product overlap. */
const MATERIAL_WORDS = new Set([
  "leather", "suede", "cotton", "linen", "silk", "wool", "velvet", "canvas", "denim",
  "ceramic", "porcelain", "stoneware", "clay", "glass", "crystal", "marble", "stone",
  "wood", "wooden", "bamboo", "resin", "acrylic", "plastic", "silicone", "metal", "brass",
  "copper", "steel", "iron", "gold", "silver", "pewter", "felt", "rattan", "wicker", "jute",
]);

/** Size words — the weakest attribute class. */
const SIZE_WORDS = new Set([
  "small", "medium", "large", "mini", "tiny", "big", "xl", "xxl", "oversized", "petite", "size",
]);

function foldPlural(word: string): string {
  // Naive singular/plural fold ("mugs" matches "mug"); applied to both sides so it stays symmetric.
  return word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word;
}

function rawTokens(title: string): string[] {
  return title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
    .map(foldPlural);
}

function isModifier(token: string): boolean {
  return COLOR_WORDS.has(token) || MATERIAL_WORDS.has(token) || SIZE_WORDS.has(token);
}

export interface TitleTokens {
  /** What the product is — every meaningful token that isn't a color/material/size. */
  identity: Set<string>;
  /** Color/material/size attributes. */
  modifiers: Set<string>;
}

export function classifyTitleTokens(title: string): TitleTokens {
  const identity = new Set<string>();
  const modifiers = new Set<string>();
  for (const token of rawTokens(title)) {
    (isModifier(token) ? modifiers : identity).add(token);
  }
  return { identity, modifiers };
}

export interface RelevanceVerdict {
  /** Whether the candidate is safe to show as "related" at all. */
  relevant: boolean;
  /** 0..1 ranking score — identity matches count double, per "type is the strongest signal". */
  score: number;
}

/**
 * Scores a candidate title against the requested product's title.
 *
 * relevant requires (a) at least one shared identity token — sharing only attributes
 * ("leather", "beige") means a different product type — and (b) for requests with enough
 * meaningful words to compare on, at least two shared tokens overall, so one incidental word
 * ("lamp" alone for a "cherry blossom tree lamp") isn't enough either.
 */
export function scoreTitleRelevance(requestedTitle: string, candidateTitle: string): RelevanceVerdict {
  const wanted = classifyTitleTokens(requestedTitle);
  const got = classifyTitleTokens(candidateTitle);
  const wantedMeaningful = wanted.identity.size + wanted.modifiers.size;
  if (wantedMeaningful === 0) return { relevant: true, score: 0 }; // nothing to compare against

  const gotAll = new Set([...got.identity, ...got.modifiers]);
  let matchedIdentity = 0;
  for (const token of wanted.identity) if (gotAll.has(token)) matchedIdentity++;
  let matchedModifiers = 0;
  for (const token of wanted.modifiers) if (gotAll.has(token)) matchedModifiers++;
  const matchedTotal = matchedIdentity + matchedModifiers;

  const identityOk = wanted.identity.size === 0 ? matchedModifiers >= 1 : matchedIdentity >= 1;
  const breadthOk = wantedMeaningful < 4 || matchedTotal >= 2;
  const score = (2 * matchedIdentity + matchedModifiers) / (2 * wanted.identity.size + wanted.modifiers.size);
  return { relevant: identityOk && breadthOk, score };
}

/**
 * The focused search query for a title: meaningful tokens in original order, deduped, capped.
 * Long marketing titles ("Beige Bucket Bag, Medium Size Leather Bucket Bag, Crossbody Bag, …")
 * collapse to their core identity + attributes ("beige bucket bag medium leather crossbody")
 * instead of being searched verbatim. Returns null when nothing meaningful remains.
 */
export function coreSearchQuery(title: string, maxTerms: number): string | null {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const token of rawTokens(title)) {
    if (seen.has(token)) continue;
    seen.add(token);
    terms.push(token);
    if (terms.length >= maxTerms) break;
  }
  return terms.length > 0 ? terms.join(" ") : null;
}
