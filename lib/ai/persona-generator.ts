import { z } from "zod";
import { NormalizedProduct } from "@/lib/product/types";
import { AiConfig, loadAiConfig } from "./config";
import { chat, parseJsonResponse } from "./openrouter";
import { describeProduct } from "./content-generator";
import {
  PERSONA_CATEGORIES,
  assignPersonaIcons,
  type PersonaOption,
} from "@/lib/store-config/persona";
import { DEFAULT_STORE_LANGUAGE, findStoreLanguage } from "@/lib/store-config/language";
import { part, joinParts, type PromptPart } from "./prompt-breakdown";

export type { PersonaOption };

// Product -> four distinct customer personas for the wizard's "Who are you selling to?"
// step (product_based_customer_persona_implementation.md). The options are derived from the
// imported product data already in the wizard — never from re-scraping the supplier — and
// the card copy is written in the customer's store-content language. Ids stay
// language-neutral so a selection survives a language change when the model re-derives the
// same buyer.

export interface GeneratePersonasOptions {
  product: NormalizedProduct;
  /** Customer store-content language code, e.g. "de". Defaults to English. */
  language?: string;
  config?: Partial<AiConfig>;
  signal?: AbortSignal;
}

export class PersonaGenerationError extends Error {}

const SYSTEM_PROMPT = `You are an ecommerce marketing strategist. Given one product, you
identify the four most plausible distinct customer personas — realistic buyers a
single-product store should speak to.

Hard rules:
- Exactly four personas, all strongly relevant to the given product. Never pad with buyers
  who would not realistically purchase it.
- The four personas must be meaningfully distinct from one another: different life
  situations, motivations or buying reasons — not four rewordings of the same buyer.
- "name": 2-4 words. "description": ONE short sentence saying what this buyer cares about
  or the problem they are solving. Both are customer-research copy, useful for ecommerce
  marketing.
- "id": a stable language-neutral identifier in lowercase English kebab-case, e.g.
  "frequent-traveler". Ids never change with the display language.
- "category": exactly one of: ${PERSONA_CATEGORIES.join(", ")}.

Return a single JSON object of this exact shape and nothing else:
{ "personas": [ { "id": "...", "name": "...", "description": "...", "category": "..." } ] }`;

/** The message content's parts, decomposed for audit-log breakdown. Exported for tests and for `promptBreakdown`. */
export function buildPersonaPromptParts(
  product: NormalizedProduct,
  language: string | undefined,
): PromptPart[] {
  const code = language?.trim().toLowerCase() || DEFAULT_STORE_LANGUAGE;
  const label = findStoreLanguage(code)?.label ?? code;
  return [
    part("product_data", "Product data", `PRODUCT:`, describeProduct(product)),
    part(
      "language_instruction",
      "Persona language",
      `PERSONA LANGUAGE:`,
      `Write every persona "name" and "description" in ${label} (${code}) — this is the`,
      `customer-facing store language. Keep every "id" in English kebab-case and every`,
      `"category" as one of the allowed English values.`,
    ),
    part("user_instruction", "Task brief", `TASK:`, `Generate exactly four distinct customer personas for this product.`),
  ];
}

/**
 * The messages sent to generate persona options. Exported so tests can verify the product
 * data and the customer language actually reach the persona prompt.
 */
export function buildPersonaMessages(
  product: NormalizedProduct,
  language: string | undefined,
): { role: "system" | "user"; content: string }[] {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: joinParts(buildPersonaPromptParts(product, language)) },
  ];
}

const RawPersonaSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  category: z.enum(PERSONA_CATEGORIES).catch("general"),
});
const RawResponseSchema = z.object({ personas: z.array(RawPersonaSchema) });

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Validates and normalizes the model's response into exactly four options: ids slugified
 * and de-duplicated, whitespace trimmed, icon derived deterministically from the category.
 * Exported for tests. Throws PersonaGenerationError when four usable personas can't be made.
 */
export function parsePersonaOptions(raw: unknown): PersonaOption[] {
  const parsed = RawResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PersonaGenerationError("Persona generation returned an unexpected shape.");
  }

  const seen = new Set<string>();
  const options: Omit<PersonaOption, "icon">[] = [];
  for (const persona of parsed.data.personas) {
    const name = persona.name.trim();
    const description = persona.description.trim();
    const id = slugify(persona.id) || slugify(name);
    if (!id || !name || !description || seen.has(id)) continue;
    seen.add(id);
    options.push({ id, name, description, category: persona.category });
    if (options.length === 4) break;
  }

  if (options.length !== 4) {
    throw new PersonaGenerationError(
      `Persona generation produced ${options.length} usable personas instead of 4.`,
    );
  }
  return assignPersonaIcons(options);
}

/** Generates the four persona options for one product in the given customer language. */
export async function generatePersonaOptions(
  options: GeneratePersonasOptions,
): Promise<{ options: PersonaOption[]; model: string }> {
  const config = loadAiConfig(options.config);
  const raw = await chat({
    config,
    json: true,
    // Four short cards (a name + one sentence each) — nowhere near chat()'s 16000 default,
    // which exists for generateTemplate()'s full-page output. Matches the structurally
    // identical marketing-angle-generator.ts's budget: a lower ceiling here (previously 100)
    // truncated the model's JSON mid-array on anything but the tersest possible output.
    maxTokens: 2000,
    signal: options.signal,
    messages: buildPersonaMessages(options.product, options.language),
    promptBreakdown: buildPersonaPromptParts(options.product, options.language),
  });
  return { options: parsePersonaOptions(parseJsonResponse(raw)), model: config.model };
}
