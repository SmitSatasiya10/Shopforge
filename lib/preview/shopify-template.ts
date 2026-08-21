import { z } from "zod";

// Shopify-native template JSON — the same shape as `templates/*.json` in the Base Theme and
// the same shape the Shopify Admin API accepts at publish time. This replaces the prototype's
// narrower StoreConfiguration: the store configuration IS the template JSON, so what the
// preview renders and what gets published are one artifact, not two that have to stay in sync.

export const ShopifyBlockSchema: z.ZodType<ShopifyBlock> = z.lazy(() =>
  z.object({
    type: z.string(),
    settings: z.record(z.string(), z.unknown()).default({}),
    blocks: z.record(z.string(), ShopifyBlockSchema).optional(),
    block_order: z.array(z.string()).optional(),
    static: z.boolean().optional(),
  }),
);

export interface ShopifyBlock {
  type: string;
  settings: Record<string, unknown>;
  blocks?: Record<string, ShopifyBlock>;
  block_order?: string[];
  static?: boolean;
}

export const ShopifySectionSchema = z.object({
  type: z.string(),
  name: z.string().optional(),
  settings: z.record(z.string(), z.unknown()).default({}),
  blocks: z.record(z.string(), ShopifyBlockSchema).optional(),
  block_order: z.array(z.string()).optional(),
  disabled: z.boolean().optional(),
});

export const ShopifyTemplateSchema = z.object({
  sections: z.record(z.string(), ShopifySectionSchema),
  order: z.array(z.string()).optional(),
  wrapper: z.string().optional(),
});

export type ShopifySection = z.infer<typeof ShopifySectionSchema>;
export type ShopifyTemplate = z.infer<typeof ShopifyTemplateSchema>;

/**
 * Section render order. Shopify uses `order` when present and falls back to key order;
 * ids in `order` that have no matching section are skipped rather than rendered empty,
 * which is what makes a partially-generated template still previewable.
 */
export function orderedSections(template: ShopifyTemplate): [string, ShopifySection][] {
  const ids = template.order ?? Object.keys(template.sections);
  return ids
    .filter((id) => template.sections[id] && !template.sections[id].disabled)
    .map((id) => [id, template.sections[id]] as [string, ShopifySection]);
}

/** Every section type the template references — used to validate against the theme's catalog. */
export function referencedTypes(template: ShopifyTemplate): string[] {
  return [...new Set(Object.values(template.sections).map((s) => s.type))];
}
