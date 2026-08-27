import { NormalizedProduct } from "@/lib/product/types";
import { ShopifyBlock, ShopifySection, ShopifySectionSchema } from "@/lib/preview/shopify-template";
import { AiConfig, loadAiConfig } from "./config";
import { chat, parseJsonResponse } from "./openrouter";
import { withAIContext } from "./debug-logger";
import { loadCatalog, describeCatalog, describeSettings, describeSpec, SectionSchema, BlockSchema } from "./catalog";
import { describeProduct } from "./content-generator";
import { imageSettingIds } from "./images";
import { getBlockAt, setSettingAtPath, setSettingsAtPath } from "@/lib/store-config/template-ops";
import { languageInstruction } from "@/lib/store-config/language";
import { personaInstruction, type CustomerPersona } from "@/lib/store-config/persona";
import { marketingAngleInstruction, type MarketingAngle } from "@/lib/store-config/marketing-angle";
import { part, joinParts, type PromptPart } from "./prompt-breakdown";

// Section-scoped AI editing (docs/SECTION-AI-EDITING.md): "rewrite this section" with an
// instruction — a typed prompt or a preset chip — rather than regenerating the whole page.
// The same contract as full generation applies: the model writes copy and settings against
// the section's catalog schema, never Liquid/HTML/CSS, and everything it returns passes
// through sanitizeRewrittenSection before it can reach the template.

/**
 * Narrows a rewrite to ONE setting or ONE block (docs/EDITOR-TOOLBARS.md).
 * `settingId` set: only that setting changes (blockPath empty = a section-level setting).
 * `settingId` absent: the whole block at `blockPath` may change, nothing outside it —
 * used when the user selected a block without a single resolvable text setting.
 */
export interface RewriteScope {
  /** Block ids from the section down to the setting/block owner. */
  blockPath: string[];
  settingId?: string;
}

export interface RewriteSectionOptions {
  product: NormalizedProduct;
  sectionId: string;
  section: ShopifySection;
  instruction: string;
  /**
   * The project's customer store-content language (ISO 639-1, e.g. "de"). Rewrites carry
   * the same language constraint as full generation, so an edit never drifts a store's
   * copy back to English.
   */
  language?: string;
  /** The project's customer persona — rewrites keep speaking to the same buyer as full generation. */
  customerPersona?: CustomerPersona | null;
  /** The project's marketing angle — rewrites keep the same positioning as full generation. */
  marketingAngle?: MarketingAngle | null;
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
 * section with only the scoped setting (or, with no settingId, the scoped block's own
 * settings) taking the model's value — so a scoped rewrite cannot touch anything else no
 * matter what the model returns. Exported for tests.
 */
export function applyScopedRewrite(
  original: ShopifySection,
  rewritten: ShopifySection,
  scope: RewriteScope,
): ShopifySection {
  const node = getBlockAt(rewritten, scope.blockPath);
  if (!node) return original;
  if (scope.settingId) {
    const value = node.settings?.[scope.settingId];
    if (value === undefined) return original;
    return setSettingAtPath(original, scope.blockPath, scope.settingId, value);
  }
  // Block scope: every setting on this one block, nothing else in the section — the block's
  // own id/type/nested blocks and every sibling block or section-level setting stay original.
  if (scope.blockPath.length === 0 || !node.settings) return original;
  return setSettingsAtPath(original, scope.blockPath, node.settings);
}

/**
 * The section as shown to the model in CURRENT SECTION JSON: settings limited to what the
 * catalog schema actually declares — a section setting not in `schema.settings`, or a block
 * setting not in that block type's own schema, is stripped before the model ever sees it.
 *
 * This cannot change the final rewritten section: `sanitizeRewrittenSection`'s `clampSettings`
 * already discards the model's returned value for any such key and falls back to the ORIGINAL
 * section's value regardless of what the model echoed (or didn't echo) for it. Omitting them
 * here only stops the model from spending tokens reading — and possibly drifting — copy it was
 * never allowed to change in the first place. Block structure (ids, types, block_order) and
 * nested blocks are left exactly as they are; only settings VALUES are filtered. Exported for
 * tests.
 */
export function filterSectionForPrompt(
  section: ShopifySection,
  schema: SectionSchema,
  blocks: BlockSchema[],
): ShopifySection {
  const blockById = new Map(blocks.map((b) => [b.id, b]));

  const filterSettings = (
    settings: Record<string, unknown> | undefined,
    allowedKeys: Set<string>,
  ): Record<string, unknown> => {
    const kept: Record<string, unknown> = {};
    for (const [id, value] of Object.entries(settings ?? {})) {
      if (allowedKeys.has(id)) kept[id] = value;
    }
    return kept;
  };

  const filterBlocks = (
    current: Record<string, BlockShape> | undefined,
  ): Record<string, BlockShape> | undefined => {
    if (!current) return current;
    return Object.fromEntries(
      Object.entries(current).map(([id, block]) => {
        const blockKeys = new Set(Object.keys(blockById.get(block.type)?.settings ?? {}));
        return [
          id,
          {
            ...block,
            settings: filterSettings(block.settings, blockKeys),
            ...(block.blocks ? { blocks: filterBlocks(block.blocks) } : {}),
          },
        ];
      }),
    );
  };

  return {
    ...section,
    settings: filterSettings(section.settings, new Set(Object.keys(schema.settings ?? {}))),
    blocks: filterBlocks(section.blocks),
  };
}

/** The same message content as `buildRewriteMessages`, decomposed into labeled parts for audit-log breakdown. Exported for tests and for the caller to pass into `chat()`'s `promptBreakdown`. */
export function buildRewritePromptParts(
  options: RewriteSectionOptions,
  schema: SectionSchema,
  blocks: BlockSchema[],
): PromptPart[] {
  const persona = personaInstruction(options.customerPersona);
  const angle = marketingAngleInstruction(options.marketingAngle);
  return [
    part(
      "schema_definitions",
      "Section schema",
      `SECTION SCHEMA (the only settings and blocks you may use):`,
      describeCatalog([schema], blocks),
    ),
    part("product_data", "Product data", `PRODUCT:`, describeProduct(options.product)),
    part("language_instruction", "Target language", `TARGET LANGUAGE:`, languageInstruction(options.language)),
    ...(persona ? [part("persona", "Target customer persona", `TARGET CUSTOMER PERSONA:`, persona)] : []),
    ...(angle ? [part("marketing_angle", "Marketing angle", `MARKETING ANGLE:`, angle)] : []),
    part(
      "existing_content",
      "Existing section content",
      `CURRENT SECTION JSON (id "${options.sectionId}"):`,
      JSON.stringify(filterSectionForPrompt(options.section, schema, blocks), null, 2),
    ),
    part("user_instruction", "Instruction", `INSTRUCTION:`, options.instruction),
  ];
}

/**
 * The full message list sent for a whole-section rewrite (no scope). Exported so tests can
 * verify the project's customer language reaches the rewrite prompt, exactly like generation.
 * Scoped rewrites (one setting or one block) use the much smaller `buildScopedSettingMessages`/
 * `buildScopedBlockMessages` below instead — see the comment on `tryScopedRewrite`.
 */
export function buildRewriteMessages(
  options: RewriteSectionOptions,
  schema: SectionSchema,
  blocks: BlockSchema[],
): { role: "system" | "user"; content: string }[] {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: joinParts(buildRewritePromptParts(options, schema, blocks)) },
  ];
}

const SCOPED_SETTING_SYSTEM_PROMPT = `You edit ONE setting inside a section of an online store
page. You are given the setting's type (or allowed values), its current value, the product the
store sells, and an instruction. Apply the instruction to this ONE value only.

Hard rules:
- Where the setting lists allowed values, return exactly one of those values.
- Rich-text values may contain only simple <p>, <strong> and <em> tags. A plain-text value must
  contain no HTML at all.
- Write specific, concrete copy about the actual product given. No lorem ipsum, no
  placeholders, no square-bracket blanks.

Return a single JSON object of this exact shape and nothing else:
{ "value": <the new value> }`;

/** The same message content as `buildScopedSettingMessages`, decomposed into labeled parts for audit-log breakdown. Exported for tests and for the caller's `promptBreakdown`. */
export function buildScopedSettingPromptParts(
  options: RewriteSectionOptions,
  settingId: string,
  spec: unknown,
  currentValue: unknown,
): PromptPart[] {
  const persona = personaInstruction(options.customerPersona);
  const angle = marketingAngleInstruction(options.marketingAngle);
  return [
    part("schema_definitions", "Setting schema", `SETTING (id "${settingId}"): ${describeSpec(spec)}`),
    part("product_data", "Product data", `PRODUCT:`, describeProduct(options.product)),
    part("language_instruction", "Target language", `TARGET LANGUAGE:`, languageInstruction(options.language)),
    ...(persona ? [part("persona", "Target customer persona", `TARGET CUSTOMER PERSONA:`, persona)] : []),
    ...(angle ? [part("marketing_angle", "Marketing angle", `MARKETING ANGLE:`, angle)] : []),
    part("existing_settings", "Existing setting value", `CURRENT VALUE:`, JSON.stringify(currentValue)),
    part("user_instruction", "Instruction", `INSTRUCTION:`, options.instruction),
  ];
}

/** The small message list for a field-scoped rewrite — see `tryScopedRewrite`. Exported for tests. */
export function buildScopedSettingMessages(
  options: RewriteSectionOptions,
  settingId: string,
  spec: unknown,
  currentValue: unknown,
): { role: "system" | "user"; content: string }[] {
  return [
    { role: "system", content: SCOPED_SETTING_SYSTEM_PROMPT },
    { role: "user", content: joinParts(buildScopedSettingPromptParts(options, settingId, spec, currentValue)) },
  ];
}

const SCOPED_BLOCK_SYSTEM_PROMPT = `You edit ONE block inside a section of an online store
page. You are given the block's schema, its current settings, the product the store sells, and
an instruction. Apply the instruction to this block's settings.

Hard rules:
- Only use setting keys listed in the schema. Never invent a setting.
- Where a setting lists allowed values, use exactly one of those values.
- Return every image and video setting with its current value, unchanged.
- Never write Liquid, HTML structure, CSS or JavaScript. Rich-text settings may contain only
  simple <p>, <strong> and <em> tags.
- Write specific, concrete copy about the actual product given. No lorem ipsum, no
  placeholders, no square-bracket blanks.
- Change only what the instruction calls for; return every unrelated setting on this block
  untouched.

Return a single JSON object of this exact shape and nothing else:
{ "block": { "settings": { } } }`;

/** The same message content as `buildScopedBlockMessages`, decomposed into labeled parts for audit-log breakdown. Exported for tests and for the caller's `promptBreakdown`. */
export function buildScopedBlockPromptParts(
  options: RewriteSectionOptions,
  blockSchema: BlockSchema,
  currentBlock: ShopifyBlock,
): PromptPart[] {
  const persona = personaInstruction(options.customerPersona);
  const angle = marketingAngleInstruction(options.marketingAngle);
  return [
    part(
      "schema_definitions",
      "Block schema",
      `BLOCK SCHEMA (the only settings this block may use):`,
      describeSettings(blockSchema.settings),
    ),
    part("product_data", "Product data", `PRODUCT:`, describeProduct(options.product)),
    part("language_instruction", "Target language", `TARGET LANGUAGE:`, languageInstruction(options.language)),
    ...(persona ? [part("persona", "Target customer persona", `TARGET CUSTOMER PERSONA:`, persona)] : []),
    ...(angle ? [part("marketing_angle", "Marketing angle", `MARKETING ANGLE:`, angle)] : []),
    part(
      "existing_settings",
      "Existing block settings",
      `CURRENT BLOCK SETTINGS (type "${currentBlock.type}"):`,
      JSON.stringify(currentBlock.settings, null, 2),
    ),
    part("user_instruction", "Instruction", `INSTRUCTION:`, options.instruction),
  ];
}

/** The small message list for a block-scoped rewrite — see `tryScopedRewrite`. Exported for tests. */
export function buildScopedBlockMessages(
  options: RewriteSectionOptions,
  blockSchema: BlockSchema,
  currentBlock: ShopifyBlock,
): { role: "system" | "user"; content: string }[] {
  return [
    { role: "system", content: SCOPED_BLOCK_SYSTEM_PROMPT },
    { role: "user", content: joinParts(buildScopedBlockPromptParts(options, blockSchema, currentBlock)) },
  ];
}

const SCOPED_SECTION_SETTINGS_SYSTEM_PROMPT = `You edit the SETTINGS of one section of an
online store page (not its blocks). You are given the section's settings schema, its current
settings, the product the store sells, and an instruction. Apply the instruction to these
settings.

Hard rules:
- Only use setting keys listed in the schema. Never invent a setting.
- Where a setting lists allowed values, use exactly one of those values.
- Return every image and video setting with its current value, unchanged.
- Never write Liquid, HTML structure, CSS or JavaScript. Rich-text settings may contain only
  simple <p>, <strong> and <em> tags.
- Write specific, concrete copy about the actual product given. No lorem ipsum, no
  placeholders, no square-bracket blanks.
- Change only what the instruction calls for; return every unrelated setting untouched.

Return a single JSON object of this exact shape and nothing else:
{ "settings": { } }`;

/** The same message content as `buildScopedSectionSettingsMessages`, decomposed into labeled parts for audit-log breakdown. Exported for tests and for the caller's `promptBreakdown`. */
export function buildScopedSectionSettingsPromptParts(
  options: RewriteSectionOptions,
  schema: SectionSchema,
): PromptPart[] {
  const persona = personaInstruction(options.customerPersona);
  const angle = marketingAngleInstruction(options.marketingAngle);
  return [
    part(
      "schema_definitions",
      "Section settings schema",
      `SECTION SETTINGS SCHEMA (the only settings you may use):`,
      describeSettings(schema.settings),
    ),
    part("product_data", "Product data", `PRODUCT:`, describeProduct(options.product)),
    part("language_instruction", "Target language", `TARGET LANGUAGE:`, languageInstruction(options.language)),
    ...(persona ? [part("persona", "Target customer persona", `TARGET CUSTOMER PERSONA:`, persona)] : []),
    ...(angle ? [part("marketing_angle", "Marketing angle", `MARKETING ANGLE:`, angle)] : []),
    part(
      "existing_settings",
      "Existing section settings",
      `CURRENT SECTION SETTINGS (type "${options.section.type}"):`,
      JSON.stringify(options.section.settings, null, 2),
    ),
    part("user_instruction", "Instruction", `INSTRUCTION:`, options.instruction),
  ];
}

/** The small message list for the section-settings half of a parallelized whole-section rewrite. Exported for tests. */
export function buildScopedSectionSettingsMessages(
  options: RewriteSectionOptions,
  schema: SectionSchema,
): { role: "system" | "user"; content: string }[] {
  return [
    { role: "system", content: SCOPED_SECTION_SETTINGS_SYSTEM_PROMPT },
    { role: "user", content: joinParts(buildScopedSectionSettingsPromptParts(options, schema)) },
  ];
}

/**
 * Fast path for a scoped rewrite (docs/EDITOR-TOOLBARS.md): when the scoped setting/block is
 * one the catalog actually describes, only that slice of the section — not the whole thing,
 * which can carry a dozen-plus sibling blocks the model would otherwise have to read and
 * re-emit verbatim just to change one word — is sent to and requested from the model. Returns
 * null when the scope can't be resolved this way (the setting isn't catalog-described, or the
 * block's type isn't in the catalog), so the caller falls back to the original whole-section
 * pass, which already handles every case `applyScopedRewrite` covers.
 */
async function tryScopedRewrite(
  options: RewriteSectionOptions,
  schema: SectionSchema,
  blocks: BlockSchema[],
  config: AiConfig,
): Promise<RewriteSectionResult | null> {
  const scope = options.scope;
  if (!scope) return null;
  const node = getBlockAt(options.section, scope.blockPath);
  if (!node) return null;

  const ownerSchema: SectionSchema | BlockSchema | undefined =
    scope.blockPath.length === 0 ? schema : blocks.find((b) => b.id === (node as ShopifyBlock).type);
  if (!ownerSchema) return null;

  if (scope.settingId) {
    const spec = ownerSchema.settings?.[scope.settingId];
    if (spec === undefined) return null;
    // Images are the toggle's, never a rewrite's (see the comment on sanitizeRewrittenSection)
    // — a scoped "rewrite" of one can only ever be a no-op, so skip the model call entirely.
    if (imageSettingIds(ownerSchema).includes(scope.settingId)) {
      return { section: options.section, model: config.model };
    }
    return rewriteScopedSetting(
      options,
      scope.blockPath,
      scope.settingId,
      spec,
      (node.settings ?? {})[scope.settingId],
      config,
    );
  }

  // Block scope: ownerSchema here is the block's own schema (blockPath is non-empty).
  return rewriteScopedBlock(options, scope.blockPath, ownerSchema as BlockSchema, node as ShopifyBlock, config);
}

async function rewriteScopedSetting(
  options: RewriteSectionOptions,
  blockPath: string[],
  settingId: string,
  spec: unknown,
  currentValue: unknown,
  config: AiConfig,
): Promise<RewriteSectionResult> {
  const raw = await withAIContext({ blockId: blockPath.join("/") || undefined, field: settingId }, () =>
    chat({
      config,
      json: true,
      signal: options.signal,
      temperature: 0.4,
      messages: buildScopedSettingMessages(options, settingId, spec, currentValue),
      promptBreakdown: buildScopedSettingPromptParts(options, settingId, spec, currentValue),
    }),
  );
  const parsed = parseJsonResponse<{ value?: unknown }>(raw);
  let value = parsed.value;
  // Same clamp sanitizeRewrittenSection applies at the whole-section scale, here for one
  // value: an allowed-values list must be honored exactly, and a plain-string setting can't
  // silently become some other type — either falls back to the original rather than writing
  // something the schema (or the rest of the app) doesn't expect.
  if (Array.isArray(spec)) {
    if (typeof value !== "string" || !spec.includes(value)) value = currentValue;
  } else if (typeof currentValue === "string" && typeof value !== "string") {
    value = currentValue;
  }
  if (value === undefined) value = currentValue;

  return {
    section: setSettingAtPath(options.section, blockPath, settingId, value),
    model: config.model,
  };
}

async function rewriteScopedBlock(
  options: RewriteSectionOptions,
  blockPath: string[],
  blockSchema: BlockSchema,
  currentBlock: ShopifyBlock,
  config: AiConfig,
): Promise<RewriteSectionResult> {
  const raw = await withAIContext({ blockId: blockPath.join("/") || undefined }, () =>
    chat({
      config,
      json: true,
      signal: options.signal,
      temperature: 0.4,
      messages: buildScopedBlockMessages(options, blockSchema, currentBlock),
      promptBreakdown: buildScopedBlockPromptParts(options, blockSchema, currentBlock),
    }),
  );
  const parsed = parseJsonResponse<{ block?: { settings?: Record<string, unknown> } }>(raw);
  const kept = clampAndRestoreImages(parsed.block?.settings ?? {}, currentBlock.settings, blockSchema);

  return {
    section: setSettingsAtPath(options.section, blockPath, kept),
    model: config.model,
  };
}

/**
 * Same clamp-plus-image-restore `sanitizeRewrittenSection` applies at the whole-section scale,
 * here for one settings object (a block's, or a section's own): only catalog-described keys
 * (or ones already present) take the model's value, and every image/video setting keeps its
 * original value regardless — images are the toggle's, never a rewrite's. Exported for tests.
 */
export function clampAndRestoreImages(
  modelSettings: Record<string, unknown>,
  currentSettings: Record<string, unknown>,
  ownerSchema: SectionSchema | BlockSchema,
): Record<string, unknown> {
  const catalogKeys = new Set(Object.keys(ownerSchema.settings ?? {}));
  const kept: Record<string, unknown> = { ...currentSettings };
  for (const [id, value] of Object.entries(modelSettings)) {
    if (catalogKeys.has(id) || !(id in kept)) kept[id] = value;
  }
  for (const id of imageSettingIds(ownerSchema)) {
    const original = currentSettings[id];
    if (typeof original === "string" && original !== "") kept[id] = original;
  }
  return kept;
}

async function rewriteScopedSectionSettings(
  options: RewriteSectionOptions,
  schema: SectionSchema,
  config: AiConfig,
): Promise<Record<string, unknown>> {
  const raw = await withAIContext({ field: "settings" }, () =>
    chat({
      config,
      json: true,
      signal: options.signal,
      temperature: 0.4,
      messages: buildScopedSectionSettingsMessages(options, schema),
      promptBreakdown: buildScopedSectionSettingsPromptParts(options, schema),
    }),
  );
  const parsed = parseJsonResponse<{ settings?: Record<string, unknown> }>(raw);
  return clampAndRestoreImages(parsed.settings ?? {}, options.section.settings, schema);
}

/**
 * Below this many top-level blocks, a whole-section rewrite uses ONE model call instead of
 * `rewriteWholeSectionParallel`'s one-call-per-block fan-out: the fan-out's per-call system
 * prompt/product/language/persona/angle boilerplate is resent whole on every call, so for a
 * small section that duplication costs more tokens than the fan-out's speed is worth. Compared
 * against the section's actual top-level block count, never the catalog's menu of allowed
 * block types. Exported so tests reference the same threshold rather than a bare literal.
 */
export const SMALL_SECTION_BLOCK_THRESHOLD = 4;

/**
 * The default path for a no-scope "rewrite this section" (docs/EDITOR-TOOLBARS.md): instead of
 * one model call reading and re-emitting every block's JSON in sequence — which for a section
 * with many blocks (e.g. main-product's ~19) can take the better part of a minute, almost all
 * of it spent generating blocks the instruction never touches — one small call per EXISTING
 * catalog-known block runs concurrently (at every nesting depth — see `rewriteBlockTree`), plus
 * one small call for the section's own settings. Non-catalog block types are left exactly as
 * they were (no schema to safely rewrite against).
 *
 * Trade-off, and the reason this isn't just always used in place of the single-call path: it
 * can only ever rewrite settings on blocks that already exist — unlike the single-call path, it
 * cannot add or remove a block, since each call only ever sees and returns one block in
 * isolation. `rewriteSection` only takes this path when the section has more than
 * `SMALL_SECTION_BLOCK_THRESHOLD` top-level blocks — below that, `rewriteWholeSectionSingleCall`
 * costs fewer total tokens for the same result. Exported for tests.
 */
export async function rewriteWholeSectionParallel(
  options: RewriteSectionOptions,
  schema: SectionSchema,
  blocks: BlockSchema[],
  config: AiConfig,
): Promise<RewriteSectionResult> {
  const blockEntries = Object.entries(options.section.blocks ?? {});
  const blockById = new Map(blocks.map((b) => [b.id, b]));

  const [sectionSettings, blockPairs] = await Promise.all([
    schema.settings && Object.keys(schema.settings).length > 0
      ? rewriteScopedSectionSettings(options, schema, config)
      : options.section.settings,
    Promise.all(
      blockEntries.map(
        async ([blockId, block]): Promise<[string, ShopifyBlock]> => [
          blockId,
          await rewriteBlockTree(options, blockById, [blockId], block, config),
        ],
      ),
    ),
  ]);

  return {
    section: { ...options.section, settings: sectionSettings, blocks: Object.fromEntries(blockPairs) },
    model: config.model,
  };
}

/**
 * Rewrites one block AND recurses into its own nested blocks (docs/product-spec/02 — custom
 * page-builder sections nest blocks inside blocks, e.g. a "column" block holding "heading"/
 * "text" blocks, arbitrarily deep) — the first version of `rewriteWholeSectionParallel` walked
 * only the section's immediate blocks and silently left every nested block untouched, which for
 * a section built entirely of nested content meant the rewrite visibly did nothing at all. Every
 * block at every depth that has its own settings gets its own concurrent call (via
 * `rewriteScopedBlock`), fired alongside the recursion into its children rather than after it,
 * so the whole tree's calls go out together regardless of depth.
 */
async function rewriteBlockTree(
  options: RewriteSectionOptions,
  blockById: Map<string, BlockSchema>,
  blockPath: string[],
  block: ShopifyBlock,
  config: AiConfig,
): Promise<ShopifyBlock> {
  const blockSchema = blockById.get(block.type);
  const hasSettings = Object.keys(blockSchema?.settings ?? {}).length > 0;

  const [settings, rewrittenBlocks] = await Promise.all([
    hasSettings
      ? rewriteScopedBlock(options, blockPath, blockSchema!, block, config).then(
          (result) => (getBlockAt(result.section, blockPath) as ShopifyBlock | undefined)?.settings ?? block.settings,
        )
      : block.settings,
    block.blocks
      ? Promise.all(
          Object.entries(block.blocks).map(
            async ([childId, child]): Promise<[string, ShopifyBlock]> => [
              childId,
              await rewriteBlockTree(options, blockById, [...blockPath, childId], child, config),
            ],
          ),
        ).then(Object.fromEntries)
      : undefined,
  ]);

  return { ...block, settings, ...(rewrittenBlocks ? { blocks: rewrittenBlocks } : {}) };
}

/**
 * One model call for the whole section (settings + every block, `buildRewriteMessages`'s
 * response shape already covers both), sanitized against the catalog exactly like every other
 * rewrite path. Used both for a small no-scope whole-section rewrite and — followed by
 * `applyScopedRewrite` — as `rewriteSection`'s scope-fallback when a scoped setting/block isn't
 * catalog-resolvable via the fast path. Exported for tests.
 */
export async function rewriteWholeSectionSingleCall(
  options: RewriteSectionOptions,
  schema: SectionSchema,
  blocks: BlockSchema[],
  config: AiConfig,
): Promise<RewriteSectionResult> {
  const raw = await chat({
    config,
    json: true,
    signal: options.signal,
    // Rewrites should stay close to the original: lower temperature than full generation.
    temperature: 0.4,
    messages: buildRewriteMessages(options, schema, blocks),
    promptBreakdown: buildRewritePromptParts(options, schema, blocks),
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

  return { section, model: config.model };
}

/** Rewrites one section against its own catalog schema. Throws SectionNotRewritableError for types outside the catalog. */
export async function rewriteSection(options: RewriteSectionOptions): Promise<RewriteSectionResult> {
  const config = loadAiConfig(options.config);
  const { sections, blocks } = await loadCatalog();

  const schema = sections.find((s) => s.id === options.section.type);
  if (!schema) throw new SectionNotRewritableError(options.section.type);

  if (options.scope) {
    const fast = await tryScopedRewrite(options, schema, blocks, config);
    if (fast) return fast;
    // Scope requested but not resolvable via the fast path (a setting the catalog doesn't
    // describe) — fall through to the single-call whole-section pass, then extract just the
    // scoped slice from it via applyScopedRewrite, exactly as before scoping existed.
    const result = await rewriteWholeSectionSingleCall(options, schema, blocks, config);
    return {
      section: applyScopedRewrite(options.section, result.section, options.scope),
      model: result.model,
    };
  }

  // No scope: "rewrite the whole section." A small section (few enough top-level blocks that
  // the fan-out's per-call boilerplate would cost more tokens than it saves in latency) gets
  // ONE call; a large one keeps the concurrent fan-out — see the comments on
  // rewriteWholeSectionSingleCall/rewriteWholeSectionParallel for what each trades off.
  const blockCount = Object.keys(options.section.blocks ?? {}).length;
  if (blockCount <= SMALL_SECTION_BLOCK_THRESHOLD) {
    return rewriteWholeSectionSingleCall(options, schema, blocks, config);
  }
  return rewriteWholeSectionParallel(options, schema, blocks, config);
}
