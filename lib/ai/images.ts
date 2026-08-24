import { NormalizedProduct } from "@/lib/product/types";
import { ShopifyTemplate } from "@/lib/preview/shopify-template";
import { SectionSchema, BlockSchema } from "./catalog";
import { AiConfig, requireApiKey } from "./config";

// The image toggle (AiConfig.generateImages).
//
//   off (default) — every image setting is filled directly from the imported product's own
//                   images, round-robin. No image model is called, nothing is billed, and the
//                   store shows the real product.
//   on            — image settings whose schema opts in via `_image_generation` are generated
//                   from a prompt derived from the product, and anything not generated still
//                   falls back to a product image rather than rendering empty.
//
// Either way the same settings get populated, so a template renders identically apart from
// which URLs it points at.

/** Setting types in the catalog schemas that hold an image URL. */
const IMAGE_SETTING_TYPES = new Set(["image_picker", "image", "video"]);

export interface ImageTarget {
  /** Where the value lives, for writing it back. */
  apply: (url: string) => void;
  sectionType: string;
  settingId: string;
  /** Prompt from the schema's `_image_generation`, when the schema opts in. */
  generationPrompt?: string;
}

export function imageSettingIds(schema: SectionSchema | BlockSchema | undefined): string[] {
  if (!schema?.settings) return [];
  return Object.entries(schema.settings)
    .filter(([, spec]) => typeof spec === "string" && IMAGE_SETTING_TYPES.has(spec))
    .map(([id]) => id);
}

/**
 * Walks a generated template and collects every image-valued setting, on sections and on
 * their (possibly nested) blocks. Collecting targets separately from filling them is what
 * lets the same walk serve both sides of the toggle.
 */
export function collectImageTargets(
  template: ShopifyTemplate,
  sections: SectionSchema[],
  blocks: BlockSchema[],
): ImageTarget[] {
  const sectionById = new Map(sections.map((s) => [s.id, s]));
  const blockById = new Map(blocks.map((b) => [b.id, b]));
  const targets: ImageTarget[] = [];

  const visitBlocks = (
    container: { blocks?: Record<string, { type: string; settings?: Record<string, unknown>; blocks?: Record<string, unknown> }> },
    sectionType: string,
  ) => {
    for (const block of Object.values(container.blocks ?? {})) {
      const schema = blockById.get(block.type);
      const settings = (block.settings ??= {});
      for (const settingId of imageSettingIds(schema)) {
        // Block schemas carry no prompt of their own, so these fall back to the prompt
        // derived from the product in buildImagePrompt().
        targets.push({
          apply: (url) => {
            settings[settingId] = url;
          },
          sectionType,
          settingId,
        });
      }
      visitBlocks(block as { blocks?: Record<string, never> }, sectionType);
    }
  };

  for (const section of Object.values(template.sections)) {
    const schema = sectionById.get(section.type);
    const settings = (section.settings ??= {});
    for (const settingId of imageSettingIds(schema)) {
      targets.push({
        apply: (url) => {
          settings[settingId] = url;
        },
        sectionType: section.type,
        settingId,
        generationPrompt: schema?._image_generation?.prompt,
      });
    }
    visitBlocks(section, section.type);
  }

  return targets;
}

/**
 * Toggle OFF: fill from the product's own images, cycling if there are more slots than
 * photos. A `data:` URI embeds the whole image inline — cycling one across many slots (as
 * happens whenever there are fewer photos than image-valued settings) would multiply its
 * size by the slot count. Harmless for a short CDN URL, but an AI-generated photo (the
 * wizard's Product Images step can select one; a real product photo never is one) can be
 * several hundred KB to a few MB, so each `data:` URI is applied at most once — a slot that
 * would have repeated one is left empty rather than ballooning the stored configuration.
 */
export function applyProductImages(targets: ImageTarget[], product: NormalizedProduct | null): number {
  const urls = product?.images.map((i) => i.url).filter(Boolean) ?? [];
  if (urls.length === 0) return 0;
  const usedDataUrls = new Set<string>();
  let filled = 0;
  targets.forEach((target, i) => {
    const url = urls[i % urls.length];
    if (url.startsWith("data:")) {
      if (usedDataUrls.has(url)) return;
      usedDataUrls.add(url);
    }
    target.apply(url);
    filled++;
  });
  return filled;
}

export interface GeneratedImage {
  url: string;
}

/**
 * Toggle ON: generate one image per target through OpenRouter's image endpoint.
 *
 * Generation is best-effort per target — a target the model declines or errors on keeps its
 * product-image fallback rather than blanking the section, so a partial image run still
 * produces a complete page.
 */
export async function generateImages(
  targets: ImageTarget[],
  product: NormalizedProduct | null,
  config: AiConfig,
  signal?: AbortSignal,
): Promise<{ generated: number; failed: number }> {
  // Fallbacks first, so every target is populated even if generation fails outright.
  applyProductImages(targets, product);

  requireApiKey(config);
  let generated = 0;
  let failed = 0;

  for (const target of targets) {
    const prompt = buildImagePrompt(target, product);
    try {
      const image = await requestImage(prompt, config, signal);
      if (image) {
        target.apply(image.url);
        generated++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
  }

  return { generated, failed };
}

function buildImagePrompt(target: ImageTarget, product: NormalizedProduct | null): string {
  if (target.generationPrompt) return target.generationPrompt;
  const subject = product?.title ?? "the product";
  const brand = product?.vendor ? ` by ${product.vendor}` : "";
  return (
    `Ecommerce lifestyle photograph for the "${target.sectionType}" section of an online store ` +
    `selling ${subject}${brand}. Clean, well-lit, professional product photography. ` +
    `No text, no logos, no watermarks.`
  );
}

/** Exported so other product-specific image generators (lib/ai/product-image-generator.ts) reuse the same OpenRouter call. */
export async function requestImage(
  prompt: string,
  config: AiConfig,
  signal?: AbortSignal,
): Promise<GeneratedImage | null> {
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      "content-type": "application/json",
      "x-title": "Shopforge",
    },
    body: JSON.stringify({
      model: config.imageModel,
      messages: [{ role: "user", content: prompt }],
      modalities: ["image", "text"],
    }),
    signal,
  });

  if (!response.ok) return null;

  const payload = (await response.json()) as {
    choices?: { message?: { images?: { image_url?: { url?: string } }[] } }[];
  };
  const url = payload.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  return url ? { url } : null;
}

/** Runs whichever side of the toggle is active. */
export async function resolveImages(
  template: ShopifyTemplate,
  sections: SectionSchema[],
  blocks: BlockSchema[],
  product: NormalizedProduct | null,
  config: AiConfig,
  signal?: AbortSignal,
): Promise<{ targets: number; generated: number; fromProduct: number }> {
  const targets = collectImageTargets(template, sections, blocks);
  if (!config.generateImages) {
    const filled = applyProductImages(targets, product);
    return { targets: targets.length, generated: 0, fromProduct: filled };
  }
  const { generated } = await generateImages(targets, product, config, signal);
  return { targets: targets.length, generated, fromProduct: targets.length - generated };
}
