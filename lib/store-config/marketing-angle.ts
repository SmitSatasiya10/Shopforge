import { z } from "zod";

// Marketing angle for generated store content (persona_step_marketing_angle_implementation.md).
// Chosen on the SECOND internal state of the wizard's Persona step (never a 7th progress
// step): after picking who the store sells to, the user picks how to sell it. Like the
// persona and language modules this file is dependency-light and shared by the "use client"
// wizard and the API routes; the AI call lives in lib/ai/marketing-angle-generator.ts.

/** One selectable marketing-angle card. Title/description are in the customer language. */
export const MarketingAngleOptionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  icon: z.string().min(1),
});
export type MarketingAngleOption = z.infer<typeof MarketingAngleOptionSchema>;

/**
 * The generated set cached on the Product row. Angles are derived from product + persona +
 * language, so the cache is keyed by the persona it was written for (see personaCacheKey)
 * and the language — changing either regenerates; anything else reuses.
 */
export const MarketingAngleCacheSchema = z.object({
  language: z.string().min(1),
  personaKey: z.string().min(1),
  options: z.array(MarketingAngleOptionSchema).length(4),
  /** The strongest angle per the model — what "Let AI decide" resolves to. */
  recommendedId: z.string().min(1),
});
export type MarketingAngleCache = z.infer<typeof MarketingAngleCacheSchema>;

/**
 * The persisted selection. selectionType records HOW it was chosen: "generated" = the user
 * picked the card themselves, "ai" = the user chose "Let AI decide" and the model's
 * recommended angle was taken. Either way the actual content is persisted, never an index.
 */
export const MarketingAngleSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  selectionType: z.enum(["generated", "ai"]),
});
export type MarketingAngle = z.infer<typeof MarketingAngleSchema>;

/** Reads a persisted angle (Project.marketingAngleJson) back; null for null/invalid data. */
export function parseMarketingAngle(value: unknown): MarketingAngle | null {
  const parsed = MarketingAngleSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Cache key for the persona a set of angles was generated for. Persona objects have no
 * stable identity of their own across custom edits, so the key is derived from content:
 * a generated persona keys by its language-neutral id, a custom persona by its text.
 */
export function personaCacheKey(persona: { type: "generated"; id: string } | { type: "custom"; text: string }): string {
  return persona.type === "generated" ? `generated:${persona.id}` : `custom:${persona.text.trim()}`;
}

/**
 * The explicit prompt constraint carried into every content-generation call alongside the
 * language and persona instructions — the chosen positioning must reach the actual
 * generation layer, not stay a UI selection.
 */
export function marketingAngleInstruction(angle: MarketingAngle | null | undefined): string | null {
  if (!angle) return null;
  return [
    `Marketing angle: "${angle.title}"`,
    `Angle description: ${angle.description}`,
    ...(angle.selectionType === "ai"
      ? [`(This angle was selected automatically as the strongest positioning for this product.)`]
      : []),
    `ALL customer-facing store content must consistently communicate this positioning: the`,
    `hero headline and description, product messaging, benefit statements, feature copy,`,
    `promotional messaging and CTA wording should all reinforce this angle. Do not generate`,
    `generic copy that ignores it, and do not drift into a different positioning.`,
  ].join("\n");
}
