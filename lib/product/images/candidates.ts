import type { NormalizedProduct } from "../types";
import type { AiConfig } from "@/lib/ai/config";
import { generateProductImages } from "@/lib/ai/product-image-generator";
import { findWebProductImages } from "./web-search";
import type { CustomerPersona } from "@/lib/store-config/persona";
import type { MarketingAngle } from "@/lib/store-config/marketing-angle";
import { type ImageCandidate, type ImageCandidatesCache } from "@/lib/store-config/product-images";

// Assembles the wizard's Product Images candidate set (shopforge-personalization-image-
// selection-plan.md §9-12) from the three sources the investigation found: the product's own
// imported photos (always available, always relevant — the highest-confidence source), AI-
// generated product photography (lib/ai/product-image-generator.ts), and web-found photos of
// the same product (lib/product/images/web-search.ts). Runs the AI and web lookups in
// parallel and tolerates either failing outright, since a real product always has at least
// its own photos to fall back on.
//
// primary = the reference UI's "Your free AI-generated images" row. When AI generation is
// unavailable/disabled/fails entirely, the product's own photos take that row instead, so it
// is never empty while a real photo exists — an unrelated placeholder is never used to fill it.
// other = "Other images we found for your product": whatever wasn't used as primary, deduped
// by URL so the same photo never appears twice across the two rows.

export interface BuildImageCandidatesOptions {
  persona?: CustomerPersona | null;
  marketingAngle?: MarketingAngle | null;
  config?: Partial<AiConfig>;
  signal?: AbortSignal;
}

function toCandidates(items: { url: string; altText: string | null }[], source: ImageCandidate["source"], prefix: string): ImageCandidate[] {
  return items.map((item, i) => ({ id: `${prefix}-${i}`, url: item.url, altText: item.altText, source }));
}

export async function buildImageCandidates(
  product: NormalizedProduct,
  options: BuildImageCandidatesOptions = {},
): Promise<ImageCandidatesCache> {
  const original = toCandidates(product.images, "original", "original");

  const [aiResult, webResult] = await Promise.allSettled([
    generateProductImages({
      product,
      persona: options.persona,
      marketingAngle: options.marketingAngle,
      config: options.config,
      signal: options.signal,
    }),
    findWebProductImages(product),
  ]);

  const ai =
    aiResult.status === "fulfilled"
      ? toCandidates(
          aiResult.value.map((img) => ({ url: img.url, altText: null })),
          "ai-generated",
          "ai",
        )
      : [];
  const web = webResult.status === "fulfilled" ? toCandidates(webResult.value, "web", "web") : [];

  const primary = ai.length > 0 ? ai : original;
  const usedUrls = new Set(primary.map((c) => c.url));
  const other = [...(ai.length > 0 ? original : []), ...web].filter((c) => {
    if (usedUrls.has(c.url)) return false;
    usedUrls.add(c.url);
    return true;
  });

  return { primary, other };
}
