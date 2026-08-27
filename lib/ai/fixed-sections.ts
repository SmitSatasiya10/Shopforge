import { TemplateReader } from "@/lib/preview/template-loader";
import { ShopifySection, ShopifyTemplate, ShopifyTemplateSchema } from "@/lib/preview/shopify-template";
import { SectionSchema, describeSettings, sectionsForTemplate, BlockSchema } from "./catalog";

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
 * Lists the fixed section ids/types the model must fill, then two appendices — one section
 * schema per section TYPE actually used above, one block schema per block TYPE actually
 * referenced above (as a fixed block id or as an allowed-block menu choice) — each described
 * exactly once regardless of how many instances/ids on the page share that type. Sections
 * whose schema is `locked` are omitted entirely — they always keep the base theme's own seeded
 * content (lib/ai/content-generator.ts's applyToFixedStructure), so the model is never asked to
 * write for them and never told an id it isn't allowed to return.
 */
export function describeFixedSections(fixed: FixedSection[], blocks: BlockSchema[]): string {
  const visible = fixed.filter(({ schema }) => !schema.locked);
  const blockById = new Map(blocks.map((b) => [b.id, b]));

  const sectionTypesSeen = new Map<string, SectionSchema>();
  // A block type's `_notes` is only ever shown to the model where it was reached as an
  // allowed-block menu choice (matching the old per-instance behavior) — never for a type only
  // ever seen as a fixed_blocks seed, which historically got settings only. Tracking `viaMenu`
  // keeps the dedup a strict no-op on prompt size instead of bulk-adding every fixed_blocks
  // type's notes (some sections seed a couple dozen structural block types), which would work
  // directly against the point of deduplicating in the first place.
  const blockTypesSeen = new Map<string, { block: BlockSchema | undefined; viaMenu: boolean }>();
  const noteBlockType = (type: string, viaMenu: boolean) => {
    const existing = blockTypesSeen.get(type);
    if (existing) {
      if (viaMenu) existing.viaMenu = true;
    } else {
      blockTypesSeen.set(type, { block: blockById.get(type), viaMenu });
    }
  };

  const structure = visible
    .map(({ id, type, schema, seed }) => {
      if (!sectionTypesSeen.has(type)) sectionTypesSeen.set(type, schema);
      const head = `- id "${id}" (${type} — ${schema.label}${schema.purpose ? `: ${schema.purpose}` : ""})`;

      if (schema.fixed_blocks) {
        const order = seed.block_order ?? Object.keys(seed.blocks ?? {});
        const body = order
          .map((blockId) => {
            const block = seed.blocks?.[blockId];
            if (!block) return null;
            noteBlockType(block.type, false);
            return `    - block id "${blockId}" (${block.type})`;
          })
          .filter((line): line is string => line !== null)
          .join("\n");
        return `${head}\n  blocks (fixed — write settings for exactly these block ids, in this order; do not add, remove, or reorder blocks):\n${body}`;
      }

      for (const blockType of schema.allowed_blocks ?? []) {
        noteBlockType(blockType, true);
      }
      return head;
    })
    .join("\n\n");

  const sectionSchemas = [...sectionTypesSeen.entries()]
    .map(([type, schema]) => {
      const settings = `  settings:\n${describeSettings(schema.settings)}`;
      const allowed = schema.fixed_blocks
        ? ""
        : `\n  allowed blocks: ${schema.allowed_blocks?.length ? schema.allowed_blocks.join(", ") : "(no blocks)"}`;
      const notes = schema._notes ? `\n  note: ${schema._notes}` : "";
      return `Section schema: ${type}\n${settings}${allowed}${notes}`;
    })
    .join("\n\n");

  const blockSchemas = [...blockTypesSeen.entries()]
    .map(([type, { block, viaMenu }]) => {
      const settings = `  settings:\n${describeSettings(block?.settings)}`;
      const notes = viaMenu && block?._notes ? `\n  note: ${block._notes}` : "";
      return `Block schema: ${type}\n${settings}${notes}`;
    })
    .join("\n\n");

  return [
    structure,
    sectionSchemas &&
      `SECTION SCHEMAS (one entry per section type used above — applies to every section id above of that type):\n\n${sectionSchemas}`,
    blockSchemas &&
      `BLOCK SCHEMAS (one entry per block type referenced above — applies to every block of that type, whether listed as a fixed block id or offered as an allowed-block choice):\n\n${blockSchemas}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}
