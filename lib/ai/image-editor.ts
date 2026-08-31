import { AiConfig, AiConfigError, loadAiConfig, requireApiKey } from "./config";
import { requestImage } from "./images";
import { GENERATED_IMAGE_MODES, type GeneratedImageMode } from "@/lib/product/generated-images";

// AI image editing for the theme editor's "Edit with AI" popover
// (docs plan: plan-image-editing-clever-curry.md) — points the existing OpenRouter image
// pipeline (lib/ai/images.ts's requestImage) at a specific selected image plus a written
// instruction, rather than the theme-decoration/product-photography prompts the two existing
// callers (generateImages, generateProductImages) build. Respects the generateImages toggle
// the same way those do: off returns a typed "disabled" result before any network call, rather
// than throwing something the caller has to guess the shape of.

export const IMAGE_EDIT_MODES = GENERATED_IMAGE_MODES;
export type ImageEditMode = GeneratedImageMode;

export const IMAGE_EDIT_ASPECTS = ["auto", "landscape", "portrait", "square", "circle"] as const;
export type ImageEditAspect = (typeof IMAGE_EDIT_ASPECTS)[number];

export interface EditImageOptions {
  instruction: string;
  mode: ImageEditMode;
  /** The reference/source image. Required when mode is "edit". */
  sourceImageUrl?: string | null;
  aspect?: ImageEditAspect;
  stylePreset?: string | null;
  /** Exact text to render (infographic claims) — passed through verbatim, never invented. */
  claim?: string | null;
  config?: Partial<AiConfig>;
  signal?: AbortSignal;
}

export type EditImageResult =
  | { ok: true; url: string }
  | {
      ok: false;
      reason: "disabled" | "no-api-key" | "no-reference" | "provider-error" | "no-image";
      message: string;
    };

// Shapes the requested composition/framing only — none of these are persisted as theme
// settings (no section schema exposes aspect/radius/object-position today; see the plan's
// gap analysis), they only steer what the model renders.
const ASPECT_HINTS: Record<ImageEditAspect, string> = {
  auto: "",
  landscape: "Wide landscape composition (roughly 16:9), horizontally oriented.",
  portrait: "Tall portrait composition (roughly 4:5), vertically oriented.",
  square: "Square composition (1:1), subject centered.",
  circle:
    "Square composition (1:1) with the subject centered and fully contained well within the frame, so it crops cleanly to a circular presentation.",
};

export function buildEditPrompt(options: Pick<EditImageOptions, "instruction" | "mode" | "sourceImageUrl" | "aspect" | "stylePreset" | "claim">): string {
  const parts: string[] = [];

  if (options.mode === "edit" && options.sourceImageUrl) {
    parts.push(`Edit the provided reference image as instructed: ${options.instruction}`);
  } else if (options.mode === "infographic") {
    parts.push(`Create a product infographic image: ${options.instruction}`);
  } else {
    parts.push(options.instruction);
  }

  const aspectHint = options.aspect ? ASPECT_HINTS[options.aspect] : "";
  if (aspectHint) parts.push(aspectHint);
  if (options.stylePreset) parts.push(`Style: ${options.stylePreset}.`);

  const claim = options.claim?.trim();
  if (claim) {
    // "Exactly the claim/content supplied" — no separate claim-validation layer exists
    // elsewhere in the app (persona-generator.ts / marketing-angle-generator.ts don't guard
    // against fabricated claims either), so this is the one safeguard: pass the user's text
    // through verbatim and explicitly forbid the model from adding any other claim.
    parts.push(`Render this exact text prominently and legibly in the image: "${claim}". Do not add any other claims, prices, or text.`);
  }

  parts.push("No watermarks.");
  return parts.filter(Boolean).join(" ");
}

export async function editProductImage(options: EditImageOptions): Promise<EditImageResult> {
  const config = loadAiConfig(options.config);
  if (!config.generateImages) {
    return { ok: false, reason: "disabled", message: "AI image generation is turned off for this project." };
  }
  if (options.mode === "edit" && !options.sourceImageUrl) {
    return { ok: false, reason: "no-reference", message: "Choose a reference image to edit first." };
  }

  try {
    requireApiKey(config);
  } catch (error) {
    const message = error instanceof AiConfigError ? error.message : "AI is not configured.";
    return { ok: false, reason: "no-api-key", message };
  }

  const prompt = buildEditPrompt(options);

  let image;
  try {
    image = await requestImage(prompt, config, options.signal, options.sourceImageUrl ?? undefined);
  } catch (error) {
    return {
      ok: false,
      reason: "provider-error",
      message: error instanceof Error ? error.message : "Image generation failed.",
    };
  }

  if (!image) {
    return { ok: false, reason: "no-image", message: "The model didn't return an image. Try a different instruction." };
  }

  return { ok: true, url: image.url };
}
