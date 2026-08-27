import { PRESENTATIONAL_TYPES, ShopifySectionSchema } from "@/lib/preview/section-schema";
import { ShopifyBlock, ShopifySection } from "@/lib/preview/shopify-template";

// Builds a brand-new section instance the way Shopify's own admin does when a merchant adds
// a section: settings come from the section's `{% schema %}` field defaults, and its starting
// blocks come from the schema's first preset (`presets[0].blocks`) — the only place a "default
// set of blocks" is defined for a section type. A type with no presets (e.g. main-product, a
// `fixed_blocks` section) simply starts blockless, same as it would in Shopify's own editor.

interface SectionPreset {
  name?: string;
  blocks?: { type: string }[];
}

function presetBlocks(schema: ShopifySectionSchema): { type: string }[] {
  const preset = schema.presets?.[0] as SectionPreset | undefined;
  return preset?.blocks ?? [];
}

/** Every distinct block type a section's first preset needs — callers resolve each type's own
 * schema (async, via loadBlockSchema) before calling createSectionInstance. */
export function presetBlockTypes(schema: ShopifySectionSchema): string[] {
  return [...new Set(presetBlocks(schema).map((b) => b.type))];
}

function defaultSettingsFrom(schema: Pick<ShopifySectionSchema, "settings">): Record<string, unknown> {
  const settings: Record<string, unknown> = {};
  for (const def of schema.settings) {
    if (!def.id || PRESENTATIONAL_TYPES.has(def.type) || def.default === undefined) continue;
    settings[def.id] = def.default;
  }
  return settings;
}

/** `${type}-${random}` — this app has no id-generation utility elsewhere to reuse. */
export function generateInstanceId(type: string): string {
  return `${type}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Creates one new section instance of `type`. `blockSchemas` must already hold the schema
 * (or `null`, if it couldn't be loaded) for every block type referenced by `schema`'s first
 * preset — the caller resolves those via `loadBlockSchema` before calling this, since schema
 * loading is async and this function stays a pure, synchronous builder.
 */
export function createSectionInstance(
  type: string,
  schema: ShopifySectionSchema,
  blockSchemas: Map<string, ShopifySectionSchema | null>,
): ShopifySection {
  const section: ShopifySection = { type, settings: defaultSettingsFrom(schema) };

  const blocks: Record<string, ShopifyBlock> = {};
  const block_order: string[] = [];
  for (const { type: blockType } of presetBlocks(schema)) {
    const blockSchema = blockSchemas.get(blockType);
    const id = generateInstanceId(blockType);
    blocks[id] = { type: blockType, settings: blockSchema ? defaultSettingsFrom(blockSchema) : {} };
    block_order.push(id);
  }
  if (block_order.length > 0) {
    section.blocks = blocks;
    section.block_order = block_order;
  }

  return section;
}
