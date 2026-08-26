import { NormalizedProduct } from "@/lib/product/types";
import { AiConfig, loadAiConfig } from "./config";
import { chat, parseJsonResponse, OpenRouterError } from "./openrouter";
import { describeProduct } from "./content-generator";
import { languageInstruction } from "@/lib/store-config/language";
import { personaInstruction, type CustomerPersona } from "@/lib/store-config/persona";
import { marketingAngleInstruction, type MarketingAngle } from "@/lib/store-config/marketing-angle";
import { part, joinParts, type PromptPart } from "./prompt-breakdown";

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

/** The message content's parts, decomposed for audit-log breakdown. Exported for tests and for `promptBreakdown`. */
export function buildTitleRewritePromptParts(options: RewriteProductTitleOptions): PromptPart[] {
  const persona = personaInstruction(options.customerPersona);
  const angle = marketingAngleInstruction(options.marketingAngle);
  return [
    part("product_data", "Product data", `PRODUCT:`, describeProduct(options.product)),
    part("language_instruction", "Target language", `TARGET LANGUAGE:`, languageInstruction(options.language)),
    ...(persona ? [part("persona", "Target customer persona", `TARGET CUSTOMER PERSONA:`, persona)] : []),
    ...(angle ? [part("marketing_angle", "Marketing angle", `MARKETING ANGLE:`, angle)] : []),
    part("existing_content", "Existing title", `CURRENT TITLE:`, options.product.title || "(missing)"),
    part("user_instruction", "Instruction", `INSTRUCTION:`, options.instruction),
  ];
}

/** The full message list for a title rewrite. Exported for tests. */
export function buildTitleRewriteMessages(
  options: RewriteProductTitleOptions,
): { role: "system" | "user"; content: string }[] {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: joinParts(buildTitleRewritePromptParts(options)) },
  ];
}

export async function rewriteProductTitle(
  options: RewriteProductTitleOptions,
): Promise<RewriteProductTitleResult> {
  const config = loadAiConfig(options.config);

  const raw = await chat({
    config,
    json: true,
    signal: options.signal,
    // Rewrites should stay close to the original: lower temperature than full generation.
    temperature: 0.4,
    messages: buildTitleRewriteMessages(options),
    promptBreakdown: buildTitleRewritePromptParts(options),
  });

  const parsed = parseJsonResponse<{ title?: unknown }>(raw);
  const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
  if (!title) throw new OpenRouterError("Model did not return a title");

  return { title, model: config.model };
}
