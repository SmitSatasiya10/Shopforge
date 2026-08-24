import { NormalizedProduct } from "@/lib/product/types";
import { AiConfig, loadAiConfig, requireApiKey } from "./config";
import { requestImage } from "./images";
import { type CustomerPersona } from "@/lib/store-config/persona";
import { type MarketingAngle } from "@/lib/store-config/marketing-angle";

// AI-generated product photography for the wizard's Product Images step
// (shopforge-personalization-image-selection-plan.md §9-11) — the "Your free AI-generated
// images" row. Distinct from lib/ai/images.ts, which generates decorative section imagery
// (hero banners, image-with-text) for the theme-generation pipeline: this module generates
// photographs OF the selected product itself, so every prompt names the actual product and,
// where available, the buyer and positioning chosen earlier in the wizard.

export interface GenerateProductImagesOptions {
  product: NormalizedProduct;
  persona?: CustomerPersona | null;
  marketingAngle?: MarketingAngle | null;
  config?: Partial<AiConfig>;
  signal?: AbortSignal;
}

export interface GeneratedProductImage {
  url: string;
}

function describePersonaForImage(persona: CustomerPersona | null | undefined): string | null {
  if (!persona) return null;
  return persona.type === "custom" ? persona.text : `${persona.name} — ${persona.description}`;
}

/**
 * Four distinct compositions, matching the "good" examples in the brief (close-up, lifestyle
 * setting, in-use by the target customer, product-focused scene) rather than four near-
 * duplicate product shots. Exported so tests can verify the product/persona/angle context
 * actually reaches every prompt, not just the first.
 */
export function buildProductImagePrompts(
  product: NormalizedProduct,
  persona?: CustomerPersona | null,
  marketingAngle?: MarketingAngle | null,
): string[] {
  const subject = product.title ?? "the product";
  const brand = product.vendor ? ` by ${product.vendor}` : "";
  const detail = product.description ? ` ${product.description.slice(0, 240)}` : "";
  const buyer = describePersonaForImage(persona);
  const angle = marketingAngle ? `${marketingAngle.title} — ${marketingAngle.description}` : null;

  const context = [
    `The product is "${subject}"${brand}.${detail}`,
    buyer ? `Target customer: ${buyer}.` : "",
    angle ? `Positioning: ${angle}.` : "",
    `No text, no logos, no watermarks, no other products in frame.`,
  ]
    .filter(Boolean)
    .join(" ");

  return [
    `Professional ecommerce product photograph of ${subject}${brand}, isolated on a clean plain background, studio lighting, sharp focus on the product. ${context}`,
    `Lifestyle photograph showing ${subject}${brand} naturally in its real-world setting. ${context}`,
    `Close-up detail photograph of ${subject}${brand}, highlighting its material, texture and craftsmanship. ${context}`,
    buyer
      ? `Photograph of ${buyer} using ${subject}${brand} in an everyday moment. ${context}`
      : `Photograph of a satisfied customer using ${subject}${brand} in an everyday moment. ${context}`,
  ];
}

/**
 * Generates up to four product-specific photographs. Best-effort per prompt — a failed or
 * declined generation is simply omitted rather than blocking the others or throwing, so a
 * partial AI outage still returns whatever succeeded (shopforge-personalization-image-
 * selection-plan.md §28: never block on a single generation failure).
 */
export async function generateProductImages(
  options: GenerateProductImagesOptions,
): Promise<GeneratedProductImage[]> {
  const config = loadAiConfig(options.config);
  requireApiKey(config);

  const prompts = buildProductImagePrompts(options.product, options.persona, options.marketingAngle);
  const results = await Promise.allSettled(
    prompts.map((prompt) => requestImage(prompt, config, options.signal)),
  );

  const images: GeneratedProductImage[] = [];
  for (const result of results) {
    if (result.status === "fulfilled" && result.value) images.push(result.value);
  }
  return images;
}
