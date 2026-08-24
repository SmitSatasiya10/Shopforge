import { z } from "zod";

// Product Images wizard step (shopforge-personalization-image-selection-plan.md §9-18): shown
// after the persona/marketing-angle step, before the final "Generate my store" action. Like
// persona.ts and marketing-angle.ts this module is dependency-light and shared by the "use
// client" wizard and the API routes; the actual sourcing (AI generation, web search) lives in
// lib/ai/product-image-generator.ts and lib/product/images/*.

/** Where a candidate image came from — surfaced so the UI/generation pipeline can tell them apart. */
export const IMAGE_SOURCES = ["original", "web", "ai-generated"] as const;
export type ImageSource = (typeof IMAGE_SOURCES)[number];

export const MAX_SELECTED_IMAGES = 5;

/** One selectable image card. Stable within a single candidate set (re-generation reassigns ids). */
export const ImageCandidateSchema = z.object({
  id: z.string().min(1),
  url: z.string().min(1),
  altText: z.string().nullable().default(null),
  source: z.enum(IMAGE_SOURCES),
});
export type ImageCandidate = z.infer<typeof ImageCandidateSchema>;

/**
 * The generated/found candidate set cached on the Product row. `primary` is the prominent
 * row ("Your free AI-generated images" — falls back to the product's own photos when AI
 * generation is unavailable or fails outright, so the primary row is never empty while a real
 * product photo exists); `other` is "Other images we found for your product" — whatever
 * wasn't used as primary, deduplicated by URL.
 *
 * Cached only by product id, not by language/persona/angle: images are costly to (re)generate
 * and the product itself is the primary relevance signal, so revisiting the step — including
 * after a language or persona change — reuses the same set rather than re-billing AI/search
 * calls. A different product is a different Product row, which invalidates this naturally.
 */
export const ImageCandidatesCacheSchema = z.object({
  primary: z.array(ImageCandidateSchema),
  other: z.array(ImageCandidateSchema),
});
export type ImageCandidatesCache = z.infer<typeof ImageCandidatesCacheSchema>;

/** The persisted selection (Project.selectedImagesJson): at most five, order = gallery order, first = featured. */
export const SelectedImagesSchema = z.object({
  images: z.array(ImageCandidateSchema).max(MAX_SELECTED_IMAGES),
});
export type SelectedImages = z.infer<typeof SelectedImagesSchema>;

/** Reads a persisted selection back into a typed value; null for null/invalid/empty data. */
export function parseSelectedImages(value: unknown): SelectedImages | null {
  const parsed = SelectedImagesSchema.safeParse(value);
  if (!parsed.success || parsed.data.images.length === 0) return null;
  return parsed.data;
}

/** Every candidate across both rows, for looking a selected id up by value. */
export function allCandidates(cache: ImageCandidatesCache): ImageCandidate[] {
  return [...cache.primary, ...cache.other];
}
