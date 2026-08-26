import { z } from "zod";
import { NormalizedProduct } from "@/lib/product/types";
import { ShopifySection, ShopifyTemplate } from "@/lib/preview/shopify-template";
import { TemplateReader } from "@/lib/preview/template-loader";
import { createFsTemplateReader } from "@/lib/preview/fs-template-reader";
import { AiConfig, loadAiConfig } from "./config";
import { chat, parseJsonResponse } from "./openrouter";
import { withAIContext } from "./debug-logger";
import { loadCatalog, BlockSchema } from "./catalog";
import { loadFixedSections, describeFixedSections, FixedSection, FixedTemplate } from "./fixed-sections";
import { resolveImages } from "./images";
import { languageInstruction } from "@/lib/store-config/language";
import { personaInstruction, type CustomerPersona } from "@/lib/store-config/persona";
import { marketingAngleInstruction, type MarketingAngle } from "@/lib/store-config/marketing-angle";
import { part, joinParts, type PromptPart, type GenerationMeta } from "./prompt-breakdown";

// Product -> Shopify template JSON. The page's section list and order are fixed — always the
// base theme's own templates/{name}.json (lib/ai/fixed-sections.ts) — the model only writes
// copy/settings/blocks for those given ids; it never chooses which sections exist, invents a
// new one, or reorders them. It never writes Liquid, HTML or CSS (docs/product-spec/02 §1: "AI
// never generates or modifies Liquid, HTML, CSS, or JavaScript"). Anything the model returns
// that is not in the catalog is dropped before the template is accepted, and anything it
// omits falls back to the base theme's own seeded content for that section.

export type TemplateName = "index" | "product";

export interface GenerateOptions {
  product: NormalizedProduct;
  templateName: TemplateName;
  /**
   * Target language for customer-facing store copy (ISO 639-1, e.g. "de") — the wizard's
   * customer-language selection. Defaults to English. Only the generated copy is affected;
   * the product's imported source data is never rewritten.
   */
  language?: string;
  /**
   * The buyer this store speaks to, chosen on the wizard's persona step
   * (product_based_customer_persona_implementation.md). Shapes headlines, benefits, CTA
   * wording and tone; omitted = write for a general audience.
   */
  customerPersona?: CustomerPersona | null;
  /**
   * The positioning chosen on the persona step's marketing-angle state
   * (persona_step_marketing_angle_implementation.md). All customer-facing copy should
   * consistently communicate it; omitted = no specific positioning constraint.
   */
  marketingAngle?: MarketingAngle | null;
  config?: Partial<AiConfig>;
  signal?: AbortSignal;
  /** Injectable for tests; defaults to reading the real base theme off disk. */
  readTemplate?: TemplateReader;
}

export interface GenerateResult {
  template: ShopifyTemplate;
  templateName: TemplateName;
  images: { targets: number; generated: number; fromProduct: number };
  /** Disallowed block types the model returned, dropped before reaching the template. */
  droppedSections: string[];
  /** Fixed section ids the model omitted (or errored on), filled from the base theme's own seed instead. */
  fallbackSections: string[];
  model: string;
}

const SYSTEM_PROMPT = `You are a Shopify store merchandiser. You are given the FIXED list of
sections that make up one page of an online store, in the exact order they will appear. Your
job is to write the copy and settings for each of those sections for the specific product
given — not to decide which sections exist, add or remove any, or change their order.

Hard rules:
- The page's sections and their order are fixed. Return settings for EXACTLY the section ids
  you are given below — no more, no fewer, no new ids, and no "order" field (there is none to
  invent).
- Never change what a section is for — write settings/blocks appropriate to the section type
  you were told each id is.
- Only use setting keys listed for that section or block. Never invent a setting.
- Where a setting lists allowed values, use exactly one of those values.
- A section's blocks (e.g. slideshow slides, testimonial cards, icon-bar columns, ticker
  messages) are content items: choose how many and what they say for this product — write
  enough that the section looks complete and populated for a real store, not sparse. Every
  block "type" you use must be one this section allows. When a section or block lists a
  "note", that note is curated guidance (typical block order, which blocks are essential vs.
  optional) — follow it rather than defaulting to the sparsest possible set.
- Some sections list their blocks as "blocks (fixed — ...)" instead of a menu to choose from
  (e.g. the main product section) — those blocks are structural, not content items: write
  settings for EXACTLY the block ids given, in the order given, no more, no fewer. Write the
  best genuine content you can for every one of them for this product — even a block that
  doesn't perfectly fit (e.g. a bundle offer for a one-off service) still needs real,
  concrete settings, since it cannot be removed.
- Never write Liquid, HTML structure, CSS or JavaScript. Rich-text settings may contain only
  simple <p>, <strong> and <em> tags.
- Leave every image setting as an empty string "". Images are filled in outside of you.
- Write specific, concrete copy about the actual product given. No lorem ipsum, no
  placeholders like "Your headline here", no square-bracket blanks, and no merge-field-style
  tokens like "{quantity}" or "{count}" — there is no templating step that fills these in, so
  a number must be a real number you chose, not a token for one.

Return a single JSON object of this exact shape and nothing else:
{
  "sections": {
    "<one of the exact section ids given to you>": {
      "settings": { },
      "blocks": { "block-id-1": { "type": "<allowed block type>", "settings": { } } },
      "block_order": ["block-id-1"]
    }
  }
}
"sections" must have exactly one entry per section id given to you, using that id verbatim as
the key.`;

// Bounds how much of the product's description reaches the prompt. A legitimate description
// is at most a few paragraphs; anything past this is either scraped page noise (see
// lib/product/fetcher.ts's MAX_RESPONSE_BYTES) or unlikely to add value the model needs, and
// left uncapped it can balloon a generation request past the model's context limit.
const MAX_DESCRIPTION_CHARS = 4000;

export function describeProduct(product: NormalizedProduct): string {
  const money = (n: number | null) =>
    n === null ? "unknown" : `${product.currency ?? "USD"} ${n.toFixed(2)}`;
  const description = product.description?.slice(0, MAX_DESCRIPTION_CHARS) ?? null;
  return [
    `Title: ${product.title ?? "(missing)"}`,
    `Vendor/brand: ${product.vendor ?? "(missing)"}`,
    `Price: ${money(product.price)}`,
    `Compare-at price: ${money(product.compareAtPrice)}`,
    `Description: ${description ?? "(missing)"}`,
    `Options: ${product.options.map((o) => `${o.name} (${o.values.join(", ")})`).join("; ") || "(none)"}`,
    `Variants: ${product.variants.map((v) => v.title).join(", ") || "(none)"}`,
    `Number of product photos available: ${product.images.length}`,
    `Source URL: ${product.productUrl}`,
  ].join("\n");
}

function pageBrief(templateName: TemplateName, product: NormalizedProduct): string {
  if (templateName === "product") {
    return `Write the PRODUCT PAGE sections below for this product: the purchase area, then
sections that answer a shopper's objections — what it is, why it is better, what other
customers say, and answers to common questions.`;
  }
  return `Write the HOMEPAGE sections below for a single-product store selling this product —
${product.title ?? "this product"}. The store sells essentially one product, so keep every
section's copy focused on it rather than a multi-category catalog.`;
}

/**
 * The model's response shape: settings/blocks per fixed section id. No "type" (the section's
 * identity is fixed, never chosen by the model) and no "order" (also fixed).
 */
const GeneratedBlockSchema = z.object({
  type: z.string(),
  settings: z.record(z.string(), z.unknown()).default({}),
});
const GeneratedSectionSchema = z.object({
  settings: z.record(z.string(), z.unknown()).optional(),
  blocks: z.record(z.string(), GeneratedBlockSchema).optional(),
  block_order: z.array(z.string()).optional(),
});
const GeneratedTemplateSchema = z.object({
  sections: z.record(z.string(), GeneratedSectionSchema).default({}),
});
export type GeneratedSection = z.infer<typeof GeneratedSectionSchema>;

/**
 * Merges the model's response onto the base theme's fixed structure. Unlike the old
 * pruneToCatalog (purely subtractive — could only remove sections/blocks the model
 * shouldn't have invented), this is additive-safe: it iterates the fixed section list, never
 * the model's own keys, so a section the model omits or a block type it invents can never
 * change which sections end up in the final template — omissions fall back to the base
 * theme's own seeded content instead of vanishing. A `fixed_blocks` section (main product)
 * gets the same treatment one level deeper: its blocks always come from the seed's own ids/
 * order too, never the model's.
 */
export function applyToFixedStructure(
  fixedTemplate: FixedTemplate,
  modelSections: Record<string, GeneratedSection>,
  blockCatalog: BlockSchema[],
): { template: ShopifyTemplate; dropped: string[]; fallbackSections: string[] } {
  const dropped: string[] = [];
  const fallbackSections: string[] = [];
  const sections: ShopifyTemplate["sections"] = {};
  const blockSchemaByType = new Map(blockCatalog.map((b) => [b.id, b]));

  for (const { id, type, schema, seed } of fixedTemplate.fixed) {
    // Locked sections (e.g. a trust-badges strip) always keep the base theme's own seeded
    // content verbatim, regardless of what the model returns for this id — describeFixedSections
    // never tells the model about them, but this guards against a hallucinated entry too.
    const model = schema.locked ? undefined : modelSections[id];
    if (!model) {
      fallbackSections.push(id);
      sections[id] = seed;
      continue;
    }

    const settingKeys = new Set(Object.keys(schema.settings ?? {}));
    const settings: Record<string, unknown> = { ...seed.settings };
    for (const [key, value] of Object.entries(model.settings ?? {})) {
      if (settingKeys.has(key)) settings[key] = value;
    }

    let blocks = seed.blocks;
    let blockOrder = seed.block_order;
    if (schema.fixed_blocks) {
      // Structural blocks (e.g. main product's bundle offer, sticky ATC, tabs): always the
      // seed's own block ids, types, and order — only their settings are content the model
      // may overwrite, the same additive-safe treatment applyToFixedStructure gives sections.
      const order = seed.block_order ?? Object.keys(seed.blocks ?? {});
      const kept: NonNullable<ShopifySection["blocks"]> = {};
      for (const blockId of order) {
        const seedBlock = seed.blocks?.[blockId];
        if (!seedBlock) continue;
        const modelBlock = model.blocks?.[blockId];
        const blockSettingKeys = new Set(Object.keys(blockSchemaByType.get(seedBlock.type)?.settings ?? {}));
        const blockSettings: Record<string, unknown> = { ...seedBlock.settings };
        for (const [key, value] of Object.entries(modelBlock?.settings ?? {})) {
          if (blockSettingKeys.has(key)) blockSettings[key] = value;
        }
        kept[blockId] = { ...seedBlock, settings: blockSettings };
      }
      blocks = kept;
      blockOrder = order;
    } else if (model.blocks && Object.keys(model.blocks).length > 0) {
      const allowedBlocks = new Set(schema.allowed_blocks ?? []);
      const kept: NonNullable<ShopifySection["blocks"]> = {};
      for (const [blockId, block] of Object.entries(model.blocks)) {
        if (allowedBlocks.has(block.type)) kept[blockId] = block;
        else dropped.push(`${type}/${block.type}`);
      }
      let order = (model.block_order ?? Object.keys(kept)).filter((b) => kept[b]);
      if (schema.max_blocks && order.length > schema.max_blocks) {
        for (const b of order.slice(schema.max_blocks)) delete kept[b];
        order = order.slice(0, schema.max_blocks);
      }
      blocks = kept;
      blockOrder = order;
    }
    // else: the model returned no usable blocks for a block-bearing section — keep the seed's.

    sections[id] = { type, name: seed.name, settings, blocks, block_order: blockOrder };
  }

  return {
    template: { ...fixedTemplate.seedTemplate, sections, order: fixedTemplate.order },
    dropped,
    fallbackSections,
  };
}

/**
 * The full message list sent for one template generation. Exported so tests can verify the
 * selected customer language actually reaches the generation layer — the language must be a
 * prompt constraint, never just a UI selection.
 */
/** The same message content as `buildGenerationMessages`, decomposed into labeled parts for audit-log breakdown. Exported for tests and for the caller's `promptBreakdown`. */
export function buildGenerationPromptParts(
  options: GenerateOptions,
  fixed: FixedSection[],
  blocks: BlockSchema[],
): PromptPart[] {
  const persona = personaInstruction(options.customerPersona);
  const angle = marketingAngleInstruction(options.marketingAngle);
  return [
    part(
      "schema_definitions",
      "Page structure",
      `PAGE STRUCTURE (fixed — write settings/blocks for exactly these ids, in this order; do not add, remove, or reorder):`,
      describeFixedSections(fixed, blocks),
    ),
    part("product_data", "Product data", `PRODUCT:`, describeProduct(options.product)),
    part("language_instruction", "Target language", `TARGET LANGUAGE:`, languageInstruction(options.language)),
    ...(persona ? [part("persona", "Target customer persona", `TARGET CUSTOMER PERSONA:`, persona)] : []),
    ...(angle ? [part("marketing_angle", "Marketing angle", `MARKETING ANGLE:`, angle)] : []),
    part("user_instruction", "Task brief", `TASK:`, pageBrief(options.templateName, options.product)),
  ];
}

export function buildGenerationMessages(
  options: GenerateOptions,
  fixed: FixedSection[],
  blocks: BlockSchema[],
): { role: "system" | "user"; content: string }[] {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: joinParts(buildGenerationPromptParts(options, fixed, blocks)) },
  ];
}

/**
 * Structural metadata for the audit log's "Generation structure" table — computed from the
 * same `fixed`/`blocks` inputs and the already-built prompt parts (never a second independent
 * call to `describeFixedSections`), so it can never drift from what was actually sent.
 */
export function buildGenerationMeta(
  options: GenerateOptions,
  fixed: FixedSection[],
  parts: PromptPart[],
): GenerationMeta {
  const eligible = fixed.filter((f) => !f.schema.locked);
  const schemaChars = parts.find((p) => p.key === "schema_definitions")?.text.length ?? 0;
  const userChars = joinParts(parts).length;

  return {
    pageType: options.templateName,
    sectionCount: eligible.length,
    sections: eligible.map((f) => ({ id: f.id, type: f.type })),
    fixedBlockCount: eligible
      .filter((f) => f.schema.fixed_blocks)
      .reduce((n, f) => n + (f.seed.block_order ?? Object.keys(f.seed.blocks ?? {})).length, 0),
    allowedBlockTypeMenuSize: eligible
      .filter((f) => !f.schema.fixed_blocks)
      .reduce((n, f) => n + (f.schema.allowed_blocks?.length ?? 0), 0),
    schemaChars,
    contentChars: userChars - schemaChars,
  };
}

/**
 * Regression tripwire: `applyToFixedStructure()` always builds `sections`/`order` by
 * iterating `fixedTemplate.fixed`, so this should be structurally unreachable today — but a
 * future change to that function that silently reintroduces the original bug (the model's own
 * keys leaking through, a section dropped, an id/type/order drift) must fail loudly here
 * rather than silently reach the database, which is exactly how the original bug went
 * unnoticed for as long as it did.
 */
export function assertFixedTemplateStructure(template: ShopifyTemplate, fixedTemplate: FixedTemplate): void {
  const actualOrder = template.order ?? [];
  const expectedOrder = fixedTemplate.order;
  if (actualOrder.length !== expectedOrder.length || actualOrder.some((id, i) => id !== expectedOrder[i])) {
    throw new Error(
      `Generated template order [${actualOrder.join(", ")}] does not match the fixed base-theme order [${expectedOrder.join(", ")}]`,
    );
  }
  for (const { id, type } of fixedTemplate.fixed) {
    const section = template.sections[id];
    if (!section) throw new Error(`Generated template is missing fixed section "${id}"`);
    if (section.type !== type) {
      throw new Error(`Generated section "${id}" has type "${section.type}", expected fixed type "${type}"`);
    }
  }
}

/**
 * Generates one template. Image settings are populated after generation by the image toggle
 * (lib/ai/images.ts) — the model is told to leave them empty precisely so that step owns them.
 */
export async function generateTemplate(options: GenerateOptions): Promise<GenerateResult> {
  const config = loadAiConfig(options.config);
  const { sections, blocks } = await loadCatalog();
  const readTemplate = options.readTemplate ?? createFsTemplateReader();
  const fixedTemplate = await loadFixedSections(readTemplate, options.templateName, sections);

  const operation = options.templateName === "index" ? "generate-homepage" : "generate-product-page";
  const promptParts = buildGenerationPromptParts(options, fixedTemplate.fixed, blocks);
  const raw = await withAIContext({ operation, template: options.templateName }, () =>
    chat({
      config,
      json: true,
      signal: options.signal,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: joinParts(promptParts) },
      ],
      promptBreakdown: promptParts,
      generationMeta: buildGenerationMeta(options, fixedTemplate.fixed, promptParts),
    }),
  );

  const parsed = GeneratedTemplateSchema.parse(parseJsonResponse(raw));
  const { template, dropped, fallbackSections } = applyToFixedStructure(fixedTemplate, parsed.sections, blocks);
  assertFixedTemplateStructure(template, fixedTemplate);
  const images = await withAIContext({ operation: "generate-theme-images", template: options.templateName }, () =>
    resolveImages(template, sections, blocks, options.product, config, options.signal),
  );

  return {
    template,
    templateName: options.templateName,
    images,
    droppedSections: dropped,
    fallbackSections,
    model: config.model,
  };
}

/** Generates the homepage and the product page for one imported product. */
export async function generateStore(
  product: NormalizedProduct,
  options: {
    language?: string;
    customerPersona?: CustomerPersona | null;
    marketingAngle?: MarketingAngle | null;
    config?: Partial<AiConfig>;
    signal?: AbortSignal;
    readTemplate?: TemplateReader;
  } = {},
): Promise<Record<TemplateName, GenerateResult>> {
  const [index, productPage] = await Promise.all([
    generateTemplate({ product, templateName: "index", ...options }),
    generateTemplate({ product, templateName: "product", ...options }),
  ]);
  return { index, product: productPage };
}
