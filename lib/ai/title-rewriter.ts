import { NormalizedProduct } from "@/lib/product/types";
import { AiConfig, loadAiConfig } from "./config";
import { chat, parseJsonResponse, OpenRouterError } from "./openrouter";
import { describeProduct } from "./content-generator";
import { languageInstruction } from "@/lib/store-config/language";
import { personaInstruction, type CustomerPersona } from "@/lib/store-config/persona";
import { marketingAngleInstruction, type MarketingAngle } from "@/lib/store-config/marketing-angle";

// AI rewrite of the product TITLE (docs/EDITOR-TOOLBARS.md "Editing the product name"): the
// title is product data, not a template setting, so it can't go through rewriteSection's
// catalog-scoped machinery — this is a standalone, single-string rewrite that persists to
// the Product record instead of configurationJson.

export interface RewriteProductTitleOptions {
  product: NormalizedProduct;
  instruction: string;
  language?: string;
  customerPersona?: CustomerPersona | null;
  marketingAngle?: MarketingAngle | null;
  config?: Partial<AiConfig>;
  signal?: AbortSignal;
}

export interface RewriteProductTitleResult {
  title: string;
  model: string;
}

const SYSTEM_PROMPT = `You edit the TITLE of one product listing in an online store. You are
given the product's current details and an instruction. Apply the instruction and return a
new title.

Hard rules:
- Return one single-line product title only — plain text, no HTML, no markdown, no
  surrounding quotes.
- Keep it recognizably the same product; do not invent a different product.
- Keep it a title, not a sentence or paragraph — no trailing punctuation.
- Write specific, concrete wording about the actual product given. No lorem ipsum, no
  placeholders, no square-bracket blanks.

Return a single JSON object of this exact shape and nothing else:
{ "title": "..." }`;

export async function rewriteProductTitle(
  options: RewriteProductTitleOptions,
): Promise<RewriteProductTitleResult> {
  const config = loadAiConfig(options.config);
  const persona = personaInstruction(options.customerPersona);
  const angle = marketingAngleInstruction(options.marketingAngle);

  const raw = await chat({
    config,
    json: true,
    signal: options.signal,
    // Rewrites should stay close to the original: lower temperature than full generation.
    temperature: 0.4,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          `PRODUCT:`,
          describeProduct(options.product),
          ``,
          `TARGET LANGUAGE:`,
          languageInstruction(options.language),
          ...(persona ? [``, `TARGET CUSTOMER PERSONA:`, persona] : []),
          ...(angle ? [``, `MARKETING ANGLE:`, angle] : []),
          ``,
          `CURRENT TITLE:`,
          options.product.title || "(missing)",
          ``,
          `INSTRUCTION:`,
          options.instruction,
        ].join("\n"),
      },
    ],
  });

  const parsed = parseJsonResponse<{ title?: unknown }>(raw);
  const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
  if (!title) throw new OpenRouterError("Model did not return a title");

  return { title, model: config.model };
}
