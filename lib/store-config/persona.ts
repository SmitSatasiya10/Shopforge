import { z } from "zod";

// Customer persona for generated store content (product_based_customer_persona_implementation.md).
// The persona answers "who is this store selling to?" and is chosen on the wizard step after
// the customer language. Like lib/store-config/language.ts this module is dependency-light and
// safe to import from "use client" pages and API routes alike; the AI call that generates
// persona options lives in lib/ai/persona-generator.ts.

/**
 * Fixed persona categories: the model classifies each persona into one of these, and the
 * card icon is derived deterministically from the category — the icon is presentation only,
 * never the source of meaning.
 */
export const PERSONA_CATEGORIES = [
  "travel",
  "work",
  "family",
  "home",
  "fitness",
  "outdoors",
  "fashion",
  "beauty",
  "student",
  "tech",
  "pets",
  "gift",
  "hobby",
  "general",
] as const;
export type PersonaCategory = (typeof PERSONA_CATEGORIES)[number];

export const PERSONA_CATEGORY_ICONS: Record<PersonaCategory, string[]> = {
  travel: ["🧳", "✈️", "🗺️", "🎒"],
  work: ["💼", "👔", "🖊️", "🏢"],
  family: ["👨‍👩‍👧", "🍼", "🧸", "🚸"],
  home: ["🏠", "🛋️", "🪴", "🧹"],
  fitness: ["🏋️", "🏃", "🧘", "💪"],
  outdoors: ["🌄", "🏕️", "🥾", "🚵"],
  fashion: ["👜", "👗", "🕶️", "👠"],
  beauty: ["💄", "🧴", "💅", "🪞"],
  student: ["🎓", "📚", "📝", "🧑‍🎓"],
  tech: ["💻", "📱", "🎧", "⌨️"],
  pets: ["🐾", "🐶", "🐱", "🦴"],
  gift: ["🎁", "🎀", "💝", "🎉"],
  hobby: ["🎨", "🎸", "🧶", "📷"],
  general: ["🛍️", "🛒", "⭐", "💡"],
};

/**
 * Deterministically assigns one icon per persona from its category's pool, never repeating
 * an icon across the set — two personas of the same category (e.g. two travel buyers) get
 * different icons instead of duplicate cards. Also applied when cached options are read
 * back, so previously cached sets pick up the same de-duplication.
 */
export function assignPersonaIcons<T extends { category: PersonaCategory }>(
  options: T[],
): (T & { icon: string })[] {
  const used = new Set<string>();
  return options.map((option) => {
    const pool = [...PERSONA_CATEGORY_ICONS[option.category], ...PERSONA_CATEGORY_ICONS.general];
    const icon = pool.find((candidate) => !used.has(candidate)) ?? pool[0];
    used.add(icon);
    return { ...option, icon };
  });
}

/** One selectable persona card. Ids are language-neutral kebab-case; name/description are in the customer language. */
export const PersonaOptionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  category: z.enum(PERSONA_CATEGORIES),
  icon: z.string().min(1),
});
export type PersonaOption = z.infer<typeof PersonaOptionSchema>;

/** Exactly four product-specific options, cached per product for the language they were generated in. */
export const PersonaOptionsCacheSchema = z.object({
  language: z.string().min(1),
  options: z.array(PersonaOptionSchema).length(4),
});
export type PersonaOptionsCache = z.infer<typeof PersonaOptionsCacheSchema>;

/** The persisted selection: one generated card, or the merchant's own description. */
export const CustomerPersonaSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("generated"),
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1),
  }),
  z.object({ type: z.literal("custom"), text: z.string().min(1) }),
]);
export type CustomerPersona = z.infer<typeof CustomerPersonaSchema>;

/**
 * Reads a persisted persona (Project.personaJson) back into a typed value. Returns null for
 * null/invalid data rather than throwing — a project without a persona is a normal state.
 */
export function parseCustomerPersona(value: unknown): CustomerPersona | null {
  const parsed = CustomerPersonaSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * The explicit prompt constraint carried into every content-generation call, alongside
 * languageInstruction — the persona must reach the actual generation layer, not just the UI.
 */
export function personaInstruction(persona: CustomerPersona | null | undefined): string | null {
  if (!persona) return null;
  const intro =
    persona.type === "custom"
      ? [`Target customer persona (described by the merchant): ${persona.text}`]
      : [`Target customer persona: ${persona.name}`, `Persona description: ${persona.description}`];
  return [
    ...intro,
    `Use this customer persona when creating ALL customer-facing store content. Headlines,`,
    `value propositions, product descriptions, benefit statements, CTA wording, promotional`,
    `messaging and tone of voice must speak to this buyer, what they care about and the`,
    `problem they are solving. Do not write generic copy that ignores the persona.`,
  ].join("\n");
}
