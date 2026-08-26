import { TemplateReader } from "@/lib/preview/template-loader";
import { ShopifySection, ShopifyTemplate, ShopifyTemplateSchema } from "@/lib/preview/shopify-template";
import { SectionSchema, describeSectionBody, describeSettings, sectionsForTemplate, BlockSchema } from "./catalog";

// The base theme's own templates/{name}.json (the same seed a brand-new project is created
// with, via lib/store-config/store.ts's defaultConfiguration) is the fixed page structure AI
// generation fills. This is what keeps every generated page showing the theme's full section
// set: the model is only ever asked to write content for these ids, never to choose which
// sections exist (docs: content-generator.ts's SYSTEM_PROMPT).

export interface FixedSection {
  /** The base theme's own instance id for this slot, e.g. "hero-slideshow". */
  id: string;
  /** Shopify section type, e.g. "slideshow" — never chosen by the model. */
  type: string;
  /** Catalog schema for this type — the settings/blocks the model may use. */
  schema: SectionSchema;
  /** The base theme's own seeded section — fallback content if the model omits this id. */
  seed: ShopifySection;
}

export interface FixedTemplate {
  seedTemplate: ShopifyTemplate;
  /** Fixed render order — always exactly the base theme's own order. */
  order: string[];
  fixed: FixedSection[];
}

/**
 * Reads the base theme's own templates/{name}.json and resolves each of its sections against
 * the AI catalog. sectionsForTemplate() is used here only to assert every seed section's type
 * really is catalog-eligible for this template — a theme/catalog authoring mismatch should
 * fail loudly at generation time rather than silently produce a broken page.
 */
export async function loadFixedSections(
  readTemplate: TemplateReader,
  templateName: string,
  sections: SectionSchema[],
): Promise<FixedTemplate> {
  const raw = ShopifyTemplateSchema.parse(JSON.parse(await readTemplate(`templates/${templateName}.json`)));
  const schemaByType = new Map(sections.map((s) => [s.id, s]));
  const eligible = new Set(sectionsForTemplate(sections, templateName).map((s) => s.id));
  const order = raw.order ?? Object.keys(raw.sections);

  const fixed = order.map((id): FixedSection => {
    const seed = raw.sections[id];
    if (!seed) {
      throw new Error(`Base theme templates/${templateName}.json: "order" references missing section id "${id}"`);
    }
    const schema = schemaByType.get(seed.type);
    if (!schema) {
      throw new Error(
        `Base theme section "${id}" (type "${seed.type}") has no AI catalog schema — ` +
          `add lib/ai/catalog/sections/${seed.type}.json before this template can be AI-generated.`,
      );
    }
    if (!eligible.has(seed.type)) {
      throw new Error(
        `Catalog schema "${seed.type}" is not allowed_on "${templateName}" but the base theme uses it there — fix the schema's allowed_on.`,
      );
    }
    return { id, type: seed.type, schema, seed };
  });

  return { seedTemplate: raw, order, fixed };
}

/**
 * Renders a `fixed_blocks` section's body: instead of `describeSectionBody`'s menu of allowed
 * block types to freely choose from, lists the base theme's own seeded block ids/types
 * verbatim — the model may only write settings for these exact ids, never add, remove, or
 * reorder them (lib/ai/content-generator.ts's applyToFixedStructure enforces this the same way
 * it enforces the section-level fixed structure).
 */
function describeFixedBlocksBody(schema: SectionSchema, seed: ShopifySection, blocks: BlockSchema[]): string {
  const blockById = new Map(blocks.map((b) => [b.id, b]));
  const settings = describeSettings(schema.settings);
  const order = seed.block_order ?? Object.keys(seed.blocks ?? {});
  const body = order
    .map((blockId) => {
      const block = seed.blocks?.[blockId];
      if (!block) return null;
      const blockSchema = blockById.get(block.type);
      return `    - block id "${blockId}" (${block.type})\n${describeSettings(blockSchema?.settings).replace(/^ {4}/gm, "        ")}`;
    })
    .filter((line): line is string => line !== null)
    .join("\n");
  const notes = schema._notes ? `\n  note: ${schema._notes}` : "";
  return `  settings:\n${settings}\n  blocks (fixed — write settings for exactly these block ids, in this order; do not add, remove, or reorder blocks):\n${body}${notes}`;
}

/**
 * Lists the fixed section ids/types the model must fill, one per catalog entry it may write
 * into. Sections whose schema is `locked` are omitted entirely — they always keep the base
 * theme's own seeded content (lib/ai/content-generator.ts's applyToFixedStructure), so the
 * model is never asked to write for them and never told an id it isn't allowed to return.
 */
export function describeFixedSections(fixed: FixedSection[], blocks: BlockSchema[]): string {
  return fixed
    .filter(({ schema }) => !schema.locked)
    .map(({ id, type, schema, seed }) => {
      const head = `- id "${id}" (${type} — ${schema.label}${schema.purpose ? `: ${schema.purpose}` : ""})`;
      const body = schema.fixed_blocks ? describeFixedBlocksBody(schema, seed, blocks) : describeSectionBody(schema, blocks);
      return `${head}\n${body}`;
    })
    .join("\n\n");
}
