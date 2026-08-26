import { NormalizedProduct } from "@/lib/product/types";
import { AiConfig, loadAiConfig } from "./config";
import { chat, parseJsonResponse, OpenRouterError } from "./openrouter";
import { describeProduct } from "./content-generator";
import { languageInstruction } from "@/lib/store-config/language";
import { personaInstruction, type CustomerPersona } from "@/lib/store-config/persona";
import { marketingAngleInstruction, type MarketingAngle } from "@/lib/store-config/marketing-angle";
import { part, joinParts, type PromptPart } from "./prompt-breakdown";

// AI rewrite of the product DESCRIPTION (docs/EDITOR-TOOLBARS.md "Editing the product
// description"): the description is product data, not a template setting, so — same as the
// title — it can't go through rewriteSection's catalog-scoped machinery. That machinery only
// ever reads and writes the section/block JSON in configurationJson, and the description was
// never part of that JSON to begin with, so no amount of section-rewrite scoping (whole
// section or one block) could ever actually change it. This is a standalone, single-string
// rewrite that persists to the Product record instead.

export interface RewriteProductDescriptionOptions {
  product: NormalizedProduct;
  instruction: string;
  language?: string;
  customerPersona?: CustomerPersona | null;
  marketingAngle?: MarketingAngle | null;
  config?: Partial<AiConfig>;
  signal?: AbortSignal;
}

export interface RewriteProductDescriptionResult {
  description: string;
  model: string;
}

const SYSTEM_PROMPT = `You edit the DESCRIPTION of one product listing in an online store. You
are given the product's current details and an instruction. Apply the instruction and return a
new description.

Hard rules:
- Plain text only — no HTML, no markdown, no surrounding quotes.
- Paragraph breaks, where wanted, are a blank line between paragraphs.
- Keep it recognizably the same product; do not invent features or claims not supported by
  the product details given.
- Write specific, concrete wording about the actual product given. No lorem ipsum, no
  placeholders, no square-bracket blanks.

Return a single JSON object of this exact shape and nothing else:
{ "description": "..." }`;

/** The message content's parts, decomposed for audit-log breakdown. Exported for tests and for `promptBreakdown`. */
export function buildDescriptionRewritePromptParts(options: RewriteProductDescriptionOptions): PromptPart[] {
  const persona = personaInstruction(options.customerPersona);
  const angle = marketingAngleInstruction(options.marketingAngle);
  return [
    part("product_data", "Product data", `PRODUCT:`, describeProduct(options.product)),
    part("language_instruction", "Target language", `TARGET LANGUAGE:`, languageInstruction(options.language)),
    ...(persona ? [part("persona", "Target customer persona", `TARGET CUSTOMER PERSONA:`, persona)] : []),
    ...(angle ? [part("marketing_angle", "Marketing angle", `MARKETING ANGLE:`, angle)] : []),
    part(
      "existing_content",
      "Existing description",
      `CURRENT DESCRIPTION:`,
      options.product.description || "(missing)",
    ),
    part("user_instruction", "Instruction", `INSTRUCTION:`, options.instruction),
  ];
}

/** The full message list for a description rewrite. Exported for tests. */
export function buildDescriptionRewriteMessages(
  options: RewriteProductDescriptionOptions,
): { role: "system" | "user"; content: string }[] {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: joinParts(buildDescriptionRewritePromptParts(options)) },
  ];
}

export async function rewriteProductDescription(
  options: RewriteProductDescriptionOptions,
): Promise<RewriteProductDescriptionResult> {
  const config = loadAiConfig(options.config);

  const raw = await chat({
    config,
    json: true,
    signal: options.signal,
    // Rewrites should stay close to the original: lower temperature than full generation.
    temperature: 0.4,
    messages: buildDescriptionRewriteMessages(options),
    promptBreakdown: buildDescriptionRewritePromptParts(options),
  });

  const parsed = parseJsonResponse<{ description?: unknown }>(raw);
  const description = typeof parsed.description === "string" ? parsed.description.trim() : "";
  if (!description) throw new OpenRouterError("Model did not return a description");

  return { description, model: config.model };
}
