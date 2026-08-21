import { NormalizedProduct } from "@/lib/product/types";
import { ShopifySection, ShopifySectionSchema } from "@/lib/preview/shopify-template";
import { AiConfig, loadAiConfig } from "./config";
import { chat, parseJsonResponse } from "./openrouter";
import { loadCatalog, describeCatalog, SectionSchema, BlockSchema } from "./catalog";
import { describeProduct } from "./content-generator";
import { imageSettingIds } from "./images";
import { getBlockAt, setSettingAtPath } from "@/lib/store-config/template-ops";

// Section-scoped AI editing (docs/SECTION-AI-EDITING.md): "rewrite this section" with an
// instruction — a typed prompt or a preset chip — rather than regenerating the whole page.
// The same contract as full generation applies: the model writes copy and settings against
// the section's catalog schema, never Liquid/HTML/CSS, and everything it returns passes
// through sanitizeRewrittenSection before it can reach the template.

/** Narrows a rewrite to ONE setting — the inline text toolbar (docs/EDITOR-TOOLBARS.md). */
export interface RewriteScope {
  /** Block ids from the section down to the setting owner; empty = a section-level setting. */
  blockPath: string[];
  settingId: string;
}

export interface RewriteSectionOptions {
  product: NormalizedProduct;
  sectionId: string;
  section: ShopifySection;
  instruction: string;
  scope?: RewriteScope;
  config?: Partial<AiConfig>;
  signal?: AbortSignal;
}

export interface RewriteSectionResult {
  section: ShopifySection;
  model: string;
}

export class SectionNotRewritableError extends Error {
  constructor(readonly sectionType: string) {
    super(
      `Section type "${sectionType}" is not in the AI catalog, so it cannot be rewritten with AI. ` +
        `Edit it through its settings instead.`,
    );
  }
}

const SYSTEM_PROMPT = `You edit ONE existing section of an online store page. You are given
the section's current JSON, the schema of settings it may use, the product the store sells,
and an instruction. Apply the instruction to this section.

Hard rules:
- Keep "type" exactly as it is. You are editing this section, not replacing it.
- Only use setting keys listed in the schema. Never invent a setting.
- Where a setting lists allowed values, use exactly one of those values.
- Return every image and video setting with its current value, unchanged.
- Keep the existing blocks and their ids unless the instruction requires adding or removing
  one. New blocks may only use the block types the schema allows.
- Never write Liquid, HTML structure, CSS or JavaScript. Rich-text settings may contain only
  simple <p>, <strong> and <em> tags.
- Write specific, concrete copy about the actual product given. No lorem ipsum, no
  placeholders, no square-bracket blanks.
- Change only what the instruction calls for; return every unrelated setting untouched.

Return a single JSON object of this exact shape and nothing else:
{ "section": { "type": "...", "settings": { }, "blocks": { }, "block_order": [ ] } }`;

type BlockShape = NonNullable<ShopifySection["blocks"]>[string];

/**
 * The post-parse guard, mirroring generation's pruneToCatalog but for a single section:
 * the original type is forced back, blocks outside the schema's allowlist are dropped,
 * max_blocks is enforced, settings outside the catalog vocabulary keep their original
 * values, and image settings are restored from the original section — images are owned by
 * the image toggle, never by a rewrite. Exported for tests.
 *
 * The settings clamp exists because the model is shown the section's CURRENT JSON, which
 * (for theme-seeded sections) carries dozens of presentation settings the catalog never
 * exposes — echoing them back with drift is how a rewrite once flipped a heading's
 * enable_custom_color while "fixing spelling". A rewrite may only change what the catalog
 * describes; everything else is the original's, verbatim.
 */
export function sanitizeRewrittenSection(
  original: ShopifySection,
  rewritten: ShopifySection,
  schema: SectionSchema,
  blocks: BlockSchema[],
  product: NormalizedProduct,
): { section: ShopifySection; dropped: string[] } {
  const blockById = new Map(blocks.map((b) => [b.id, b]));
  const allowed = new Set(schema.allowed_blocks ?? []);
  const dropped: string[] = [];

  // Model-writable keys per schema: exactly what describeCatalog showed it.
  const catalogKeys = (s: { settings?: Record<string, unknown> } | undefined) =>
    new Set(Object.keys(s?.settings ?? {}));
  const clampSettings = (
    modelSettings: Record<string, unknown> | undefined,
    originalSettings: Record<string, unknown> | undefined,
    keys: Set<string>,
  ): Record<string, unknown> => {
    const kept: Record<string, unknown> = { ...(originalSettings ?? {}) };
    for (const [id, value] of Object.entries(modelSettings ?? {})) {
      if (keys.has(id) || !(id in kept)) kept[id] = value;
    }
    return kept;
  };

  const section: ShopifySection = { ...rewritten, type: original.type };
  section.settings = clampSettings(rewritten.settings, original.settings, catalogKeys(schema));

  if (section.blocks) {
    const kept: Record<string, BlockShape> = {};
    for (const [blockId, block] of Object.entries(section.blocks)) {
      if (allowed.has(block.type)) kept[blockId] = block;
      else dropped.push(`${original.type}/${block.type}`);
    }
    section.blocks = kept;
    let order = (section.block_order ?? Object.keys(kept)).filter((id) => kept[id]);
    if (schema.max_blocks && order.length > schema.max_blocks) {
      for (const id of order.slice(schema.max_blocks)) {
        dropped.push(`${original.type}/${kept[id].type} (over max_blocks)`);
        delete kept[id];
      }
      order = order.slice(0, schema.max_blocks);
    }
    section.block_order = order;
  }

  // Image settings: the original value wins; a slot the original never had (a new block)
  // is filled from the product's own photos rather than whatever the model put there.
  const urls = product.images.map((i) => i.url).filter(Boolean);
  let next = 0;
  const fillImages = (
    target: Record<string, unknown>,
    source: Record<string, unknown> | undefined,
    ids: string[],
  ) => {
    for (const id of ids) {
      const originalValue = source?.[id];
      if (typeof originalValue === "string" && originalValue !== "") target[id] = originalValue;
      else if (!target[id] && urls.length > 0) target[id] = urls[next++ % urls.length];
    }
  };

  section.settings = { ...section.settings };
  fillImages(section.settings, original.settings, imageSettingIds(schema));

  const visit = (
    current: Record<string, BlockShape> | undefined,
    previous: Record<string, BlockShape> | undefined,
  ) => {
    for (const [blockId, block] of Object.entries(current ?? {})) {
      const before = previous?.[blockId];
      const sameBlock = before?.type === block.type;
      block.settings = clampSettings(
        block.settings,
        sameBlock ? before!.settings : undefined,
        catalogKeys(blockById.get(block.type)),
      );
      fillImages(
        block.settings,
        sameBlock ? before!.settings : undefined,
        imageSettingIds(blockById.get(block.type)),
      );
      visit(block.blocks, sameBlock ? before!.blocks : undefined);
    }
  };
  visit(section.blocks, original.blocks);

  return { section, dropped };
}

/**
 * Scoped rewrites are enforced structurally, not just by prompt: the result is the ORIGINAL
 * section with only the scoped setting taking the model's value — so a scoped rewrite
 * cannot touch anything else no matter what the model returns. Exported for tests.
 */
export function applyScopedRewrite(
  original: ShopifySection,
  rewritten: ShopifySection,
  scope: RewriteScope,
): ShopifySection {
  const node = getBlockAt(rewritten, scope.blockPath);
  const value = node?.settings?.[scope.settingId];
  if (value === undefined) return original;
  return setSettingAtPath(original, scope.blockPath, scope.settingId, value);
}

/** Rewrites one section against its own catalog schema. Throws SectionNotRewritableError for types outside the catalog. */
export async function rewriteSection(options: RewriteSectionOptions): Promise<RewriteSectionResult> {
  const config = loadAiConfig(options.config);
  const { sections, blocks } = await loadCatalog();

  const schema = sections.find((s) => s.id === options.section.type);
  if (!schema) throw new SectionNotRewritableError(options.section.type);

  const raw = await chat({
    config,
    json: true,
    signal: options.signal,
    // Rewrites should stay close to the original: lower temperature than full generation.
    temperature: 0.4,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          `SECTION SCHEMA (the only settings and blocks you may use):`,
          describeCatalog([schema], blocks),
          ``,
          `PRODUCT:`,
          describeProduct(options.product),
          ``,
          `CURRENT SECTION JSON (id "${options.sectionId}"):`,
          JSON.stringify(options.section, null, 2),
          ``,
          `INSTRUCTION:`,
          options.instruction,
          ...(options.scope
            ? [
                ``,
                `SCOPE: change ONLY the setting "${options.scope.settingId}"` +
                  (options.scope.blockPath.length > 0
                    ? ` inside block "${options.scope.blockPath.join("/")}"`
                    : ``) +
                  `. Return every other setting and block exactly as given.`,
              ]
            : []),
        ].join("\n"),
      },
    ],
  });

  const parsed = parseJsonResponse<{ section?: unknown }>(raw);
  // Tolerate a model that returns the section object bare instead of wrapped.
  const rewritten = ShopifySectionSchema.parse(parsed.section ?? parsed);
  const { section } = sanitizeRewrittenSection(
    options.section,
    rewritten,
    schema,
    blocks,
    options.product,
  );

  return {
    section: options.scope ? applyScopedRewrite(options.section, section, options.scope) : section,
    model: config.model,
  };
}
