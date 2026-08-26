// AI runtime configuration. Every value is read through here rather than off process.env at
// the call site, so a caller (an API route, a test) can override any of it per request.

export interface AiConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
  /**
   * The image toggle. When false — the default — image settings are filled directly from the
   * imported product's own images and no image model is called. When true, image settings are
   * generated. Off is the default because the scraped product photos are the real product,
   * and a generated stand-in is usually worse for a store built around that product.
   */
  generateImages: boolean;
  imageModel: string;
}

function envFlag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export function loadAiConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    apiKey: overrides.apiKey ?? process.env.OPENROUTER_API_KEY ?? "",
    model: overrides.model ?? process.env.OPENROUTER_MODEL ?? "google/gemini-3.7-flash",
    baseUrl: overrides.baseUrl ?? process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
    generateImages:
      overrides.generateImages ?? envFlag(process.env.SHOPFORGE_GENERATE_IMAGES, false),
    // openai/gpt-image-1 is OpenAI's own Images API model, not an OpenRouter chat-completions
    // image-output model — requesting it here 404s ("No endpoints found that support the
    // requested output modalities"), verified live. google/gemini-2.5-flash-image is a real
    // OpenRouter chat-completions image-output model, verified live to return a usable image.
    imageModel: overrides.imageModel ?? process.env.OPENROUTER_IMAGE_MODEL ?? "google/gemini-2.5-flash-image",
  };
}

export class AiConfigError extends Error {}

export function requireApiKey(config: AiConfig): string {
  if (!config.apiKey) {
    throw new AiConfigError(
      "OPENROUTER_API_KEY is not set. Add it to .env to generate content with AI.",
    );
  }
  return config.apiKey;
}
