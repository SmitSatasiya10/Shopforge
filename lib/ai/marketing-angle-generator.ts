import { z } from "zod";
import { NormalizedProduct } from "@/lib/product/types";
import { AiConfig, loadAiConfig } from "./config";
import { chat, parseJsonResponse } from "./openrouter";
import { describeProduct } from "./content-generator";
import { type MarketingAngleOption } from "@/lib/store-config/marketing-angle";
import { type CustomerPersona } from "@/lib/store-config/persona";
import { DEFAULT_STORE_LANGUAGE, findStoreLanguage } from "@/lib/store-config/language";

// Product + persona -> four distinct marketing angles for the Persona step's second state,
// "How do you want to sell it?" (persona_step_marketing_angle_implementation.md). Angles are
// positioning strategies for THIS product aimed at THIS buyer, written in the customer's
// store-content language. The model also names the strongest angle, which is what the
// "Let AI decide" option resolves to — no second AI call needed.

export interface GenerateAnglesOptions {
  product: NormalizedProduct;
  persona: CustomerPersona;
  /** Customer store-content language code, e.g. "de". Defaults to English. */
  language?: string;
  config?: Partial<AiConfig>;
  signal?: AbortSignal;
}

export class AngleGenerationError extends Error {}

const SYSTEM_PROMPT = `You are an ecommerce positioning strategist. Given one product and the
customer persona the store sells to, you propose the four strongest distinct marketing
angles — ways to position and sell this product to that buyer.

Hard rules:
- Exactly four angles, each grounded in the product's ACTUAL characteristics. Never invent
  capabilities the product does not have.
- The selected persona is a hard constraint: every angle must speak to that buyer. Never
  target a different audience.
- The four angles must be meaningfully different positioning strategies — not the same
  positioning reworded, not generic ecommerce phrases.
- "title": a short, punchy marketing-angle headline (3-6 words). "description": ONE short
  sentence explaining who it hooks and why.
- "id": a stable language-neutral identifier in lowercase English kebab-case, e.g.
  "polished-travel". Ids never change with the display language.
- "icon": one emoji that fits the angle. Use four different emojis.
- "recommendedId": the id of the single strongest angle for this product and persona.

Return a single JSON object of this exact shape and nothing else:
{ "angles": [ { "id": "...", "title": "...", "description": "...", "icon": "..." } ],
  "recommendedId": "..." }`;

function describePersona(persona: CustomerPersona): string {
  if (persona.type === "custom") {
    return `(described by the merchant) ${persona.text}`;
  }
  return `${persona.name} — ${persona.description}`;
}

/**
 * The messages sent to generate marketing angles. Exported so tests can verify the product,
 * persona and customer language all reach the angle prompt.
 */
export function buildAngleMessages(
  product: NormalizedProduct,
  persona: CustomerPersona,
  language: string | undefined,
): { role: "system" | "user"; content: string }[] {
  const code = language?.trim().toLowerCase() || DEFAULT_STORE_LANGUAGE;
  const label = findStoreLanguage(code)?.label ?? code;
  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        `PRODUCT:`,
        describeProduct(product),
        ``,
        `CUSTOMER PERSONA (hard constraint — every angle must target this buyer):`,
        describePersona(persona),
        ``,
        `ANGLE LANGUAGE:`,
        `Write every angle "title" and "description" in ${label} (${code}) — this is the`,
        `customer-facing store language. Keep every "id" in English kebab-case.`,
        ``,
        `TASK:`,
        `Generate exactly four distinct marketing angles for selling this product to this`,
        `persona, and name the strongest one as recommendedId.`,
      ].join("\n"),
    },
  ];
}

const RawAngleSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  icon: z.string().optional(),
});
const RawResponseSchema = z.object({
  angles: z.array(RawAngleSchema),
  recommendedId: z.string().optional(),
});

const FALLBACK_ICONS = ["✨", "🎯", "💡", "🌟"];

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Validates and normalizes the model's response: ids slugified and de-duplicated, exactly
 * four angles, icons unique (missing/repeated emojis fall back to a neutral pool), and
 * recommendedId resolved to a real option (first angle when the model's pick is invalid).
 * Exported for tests. Throws AngleGenerationError when four usable angles can't be made.
 */
export function parseAngleOptions(raw: unknown): { options: MarketingAngleOption[]; recommendedId: string } {
  const parsed = RawResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AngleGenerationError("Marketing-angle generation returned an unexpected shape.");
  }

  const seenIds = new Set<string>();
  const seenIcons = new Set<string>();
  const options: MarketingAngleOption[] = [];
  for (const angle of parsed.data.angles) {
    const title = angle.title.trim();
    const description = angle.description.trim();
    const id = slugify(angle.id) || slugify(title);
    if (!id || !title || !description || seenIds.has(id)) continue;
    seenIds.add(id);
    let icon = angle.icon?.trim() ?? "";
    if (!icon || seenIcons.has(icon)) {
      icon = FALLBACK_ICONS.find((candidate) => !seenIcons.has(candidate)) ?? FALLBACK_ICONS[0];
    }
    seenIcons.add(icon);
    options.push({ id, title, description, icon });
    if (options.length === 4) break;
  }

  if (options.length !== 4) {
    throw new AngleGenerationError(
      `Marketing-angle generation produced ${options.length} usable angles instead of 4.`,
    );
  }

  const recommended = slugify(parsed.data.recommendedId ?? "");
  const recommendedId = options.some((o) => o.id === recommended) ? recommended : options[0].id;
  return { options, recommendedId };
}

/** Generates the four marketing angles for one product + persona in the given customer language. */
export async function generateAngleOptions(
  options: GenerateAnglesOptions,
): Promise<{ options: MarketingAngleOption[]; recommendedId: string; model: string }> {
  const config = loadAiConfig(options.config);
  const raw = await chat({
    config,
    json: true,
    // Four short cards (a title + one sentence each) — nowhere near chat()'s 16000 default,
    // which exists for generateTemplate()'s full-page output. A right-sized ceiling costs
    // less and is less likely to be rejected outright by an account's remaining budget.
    maxTokens: 2000,
    signal: options.signal,
    messages: buildAngleMessages(options.product, options.persona, options.language),
  });
  return { ...parseAngleOptions(parseJsonResponse(raw)), model: config.model };
}
