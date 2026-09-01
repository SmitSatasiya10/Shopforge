import { PRESENTATIONAL_TYPES, ShopifySectionSchema, ShopifySettingDef } from "@/lib/preview/section-schema";
import { ShopifyBlock, ShopifySection } from "@/lib/preview/shopify-template";

// Builds a brand-new section instance the way Shopify's own admin does when a merchant adds
// a section: settings come from the section's `{% schema %}` field defaults, and its starting
// blocks come from the schema's first preset (`presets[0].blocks`) — the only place a "default
// set of blocks" is defined for a section type. A type with no presets (e.g. main-product, a
// `fixed_blocks` section) simply starts blockless, same as it would in Shopify's own editor.

interface SectionPresetBlock {
  type: string;
  settings?: Record<string, unknown>;
  blocks?: SectionPresetBlock[];
}

interface SectionPreset {
  name?: string;
  blocks?: SectionPresetBlock[];
}

function presetBlocks(schema: ShopifySectionSchema): SectionPresetBlock[] {
  const preset = schema.presets?.[0] as SectionPreset | undefined;
  return preset?.blocks ?? [];
}

function collectBlockTypes(blocks: SectionPresetBlock[], into: Set<string>): void {
  for (const block of blocks) {
    into.add(block.type);
    if (block.blocks) collectBlockTypes(block.blocks, into);
  }
}

/** Every distinct block type a section's first preset needs, at any nesting depth (a container
 * block like Custom Columns' "Column" can itself preset its own child blocks) — callers resolve
 * each type's own schema (async, via loadBlockSchema) before calling createSectionInstance. */
export function presetBlockTypes(schema: ShopifySectionSchema): string[] {
  const types = new Set<string>();
  collectBlockTypes(presetBlocks(schema), types);
  return [...types];
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

/** Creates one new block instance of `type`, its settings defaulted from its own schema entry
 * (either a real theme block's `{% schema %}`, or a section's inline `blocks[]` definition). */
export function createBlockInstance(
  type: string,
  schema: { settings?: ShopifySettingDef[] } | null,
): ShopifyBlock {
  return { type, settings: schema ? defaultSettingsFrom({ settings: schema.settings ?? [] }) : {} };
}

/** Builds one preset block (and, recursively, its own nested preset blocks — a container block
 * like Custom Columns' "Column" presets child blocks one level deeper). Settings start from the
 * block's own schema defaults, then the preset's explicit `settings` override on top, matching
 * how Shopify's admin resolves a preset block's starting settings. */
function buildPresetBlock(
  presetBlock: SectionPresetBlock,
  blockSchemas: Map<string, ShopifySectionSchema | null>,
): ShopifyBlock {
  const blockSchema = blockSchemas.get(presetBlock.type);
  const settings = { ...(blockSchema ? defaultSettingsFrom(blockSchema) : {}), ...presetBlock.settings };
  const block: ShopifyBlock = { type: presetBlock.type, settings };

  if (presetBlock.blocks?.length) {
    const blocks: Record<string, ShopifyBlock> = {};
    const block_order: string[] = [];
    for (const child of presetBlock.blocks) {
      const id = generateInstanceId(child.type);
      blocks[id] = buildPresetBlock(child, blockSchemas);
      block_order.push(id);
    }
    block.blocks = blocks;
    block.block_order = block_order;
  }

  return block;
}

/**
 * Creates one new section instance of `type`. `blockSchemas` must already hold the schema
 * (or `null`, if it couldn't be loaded) for every block type referenced by `schema`'s first
 * preset, at any nesting depth — the caller resolves those via `loadBlockSchema` (guided by
 * `presetBlockTypes`) before calling this, since schema loading is async and this function
 * stays a pure, synchronous builder.
 */
export function createSectionInstance(
  type: string,
  schema: ShopifySectionSchema,
  blockSchemas: Map<string, ShopifySectionSchema | null>,
): ShopifySection {
  const section: ShopifySection = { type, settings: defaultSettingsFrom(schema) };

  const blocks: Record<string, ShopifyBlock> = {};
  const block_order: string[] = [];
  for (const presetBlock of presetBlocks(schema)) {
    const id = generateInstanceId(presetBlock.type);
    blocks[id] = buildPresetBlock(presetBlock, blockSchemas);
    block_order.push(id);
  }
  if (block_order.length > 0) {
    section.blocks = blocks;
    section.block_order = block_order;
  }

  return section;
}
