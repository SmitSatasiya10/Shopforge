import { z } from "zod";

// Editor-driven "Edit with AI" results (plan-image-editing-clever-curry.md) — an append-only
// log on Product.generatedImagesJson, distinct from lib/store-config/product-images.ts's
// ImageCandidatesCache: that cache is a full-replace snapshot built once by the wizard's
// Product Images step, while this log grows one entry at a time as the merchant accepts
// generations from any theme belonging to the product's store, and is never cleared.
//
// Kept dependency-light on purpose, like lib/store-config/product-images.ts: this module
// (via lib/product/db-mapping.ts's toProductDTO) is reachable from the "use client" editor
// page, so it must never import lib/ai/* — that pulls in debug-logger.ts's node:async_hooks/
// node:fs, which Turbopack cannot put in a client bundle. lib/ai/image-editor.ts imports the
// mode list from here instead, not the other way around.

export const GENERATED_IMAGE_MODES = ["generate", "edit", "infographic"] as const;
export type GeneratedImageMode = (typeof GENERATED_IMAGE_MODES)[number];

export const GeneratedImageSchema = z.object({
  id: z.string().min(1),
  url: z.string().min(1),
  prompt: z.string(),
  /** The reference image used, if any. */
  sourceImageUrl: z.string().nullable().default(null),
  mode: z.enum(GENERATED_IMAGE_MODES),
  createdAt: z.string(),
});
export type GeneratedImage = z.infer<typeof GeneratedImageSchema>;

export const GeneratedImagesSchema = z.array(GeneratedImageSchema);

/** Reads the persisted log back into typed values; empty for null/invalid/corrupt data rather than throwing. */
export function parseGeneratedImages(value: unknown): GeneratedImage[] {
  const parsed = GeneratedImagesSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

/** Appends one entry to the persisted log, for the route that records a successful generation. */
export function appendGeneratedImage(existing: unknown, entry: GeneratedImage): GeneratedImage[] {
  return [...parseGeneratedImages(existing), entry];
}
