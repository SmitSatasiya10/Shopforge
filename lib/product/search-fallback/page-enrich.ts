import { mapWithConcurrency } from "../discovery";
import { extractFromHtml } from "../extractor";
import { fetchTextWithLimits } from "../fetcher";
import { normalizeFromJsonLd, normalizeFromOpenGraph } from "../normalizer";
import { extractAmazonHtmlFallback } from "../suppliers/amazon";
import type { NormalizedProduct } from "../types";
import { PLATFORM_CONFIGS } from "./platforms";

// Candidate page enrichment — the first stage that runs on every accepted search candidate.
//
// Search results alone carry no image URLs (verified live: Perplexity answers and OpenRouter's
// web_fetch both return cleaned text), so each incomplete candidate's own product page is
// fetched once and mined with the SAME structured-data extractors the direct import path uses,
// in this trust order: JSON-LD `image`, then OpenGraph `og:image`, then the platform's static
// HTML fallback (Amazon's #landingImage). Everything extracted this way provably belongs to
// the candidate — it came from the candidate's own page.
//
// This stage is strictly best-effort: bot-blocked pages (Etsy answers 403 to effectively every
// server-side fetch; Amazon often serves an HTTP-200 captcha shell that extracts to nothing)
// just pass the candidate through unchanged, and the platform's own enrichment (e.g. Etsy shop
// RSS) still runs afterwards. Existing candidate fields are never overwritten — only gaps fill.

const ENRICH_CONCURRENCY = 4;

function isHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

export async function enrichCandidatesFromPages(
  platform: string,
  products: NormalizedProduct[],
  fetchText: (url: string) => Promise<string | null> = fetchTextWithLimits,
): Promise<NormalizedProduct[]> {
  const config = PLATFORM_CONFIGS[platform];
  if (!config) return products;

  return mapWithConcurrency(products, ENRICH_CONCURRENCY, async (product) => {
    const complete = product.images.length > 0 && product.price !== null && product.description !== null;
    if (complete) return product;

    const html = await fetchText(product.productUrl);
    if (!html) return product;

    const extraction = extractFromHtml(html);
    const page = extraction
      ? extraction.source === "jsonld"
        ? normalizeFromJsonLd(extraction, product.productUrl)
        : normalizeFromOpenGraph(extraction, product.productUrl)
      : null;
    const htmlFallback = platform === "amazon" ? extractAmazonHtmlFallback(html) : null;
    if (!page && !htmlFallback) return product;

    // Image candidates in extraction-trust order; platform-CDN-hosted ones win within that
    // order ("prefer the supplier's own CDN"), but any image extracted from the candidate's
    // own page is provably associated with it, so an off-CDN structured-data image still
    // beats showing nothing.
    const imageCandidates = [...(page?.images.map((i) => i.url) ?? []), htmlFallback?.image ?? null]
      .filter((url): url is string => !!url && isHttpsUrl(url))
      .sort((a, b) => Number(config.isTrustedImageUrl(b)) - Number(config.isTrustedImageUrl(a)));

    return {
      ...product,
      images:
        product.images.length === 0 && imageCandidates.length > 0
          ? [{ url: imageCandidates[0], altText: product.title }]
          : product.images,
      price: product.price ?? page?.price ?? htmlFallback?.price ?? null,
      currency: product.currency ?? page?.currency ?? htmlFallback?.currency ?? null,
      description: product.description ?? page?.description ?? null,
      vendor: product.vendor ?? page?.vendor ?? null,
    };
  });
}
