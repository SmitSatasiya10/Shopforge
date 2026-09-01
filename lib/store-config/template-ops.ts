import { ShopifyBlock, ShopifySection, ShopifyTemplate } from "@/lib/preview/shopify-template";

// Pure, immutable operations on template JSON — what the section toolbar's move/delete and
// the inline text toolbar's block-delete/setting-write do (docs/EDITOR-TOOLBARS.md). All of
// them return new objects and leave the input untouched, matching how the editor updates
// React state; an id that doesn't exist returns the input unchanged rather than throwing.

/** Moves a section one step up (-1) or down (+1) in the template's order. */
export function moveSection(template: ShopifyTemplate, sectionId: string, delta: -1 | 1): ShopifyTemplate {
  const order = template.order ?? Object.keys(template.sections);
  const from = order.indexOf(sectionId);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= order.length) return template;
  const next = [...order];
  next.splice(from, 1);
  next.splice(to, 0, sectionId);
  return { ...template, order: next };
}

/**
 * Adds a new section. With no `afterSectionId` (or one that isn't in the template), appends to
 * the end — the page-level "Add section" button's behavior. With `afterSectionId`, inserts
 * right after that section — the inline "+" shown below the selected section.
 */
export function insertSection(
  template: ShopifyTemplate,
  sectionId: string,
  section: ShopifySection,
  afterSectionId?: string | null,
): ShopifyTemplate {
  const order = template.order ?? Object.keys(template.sections);
  const at = afterSectionId ? order.indexOf(afterSectionId) : -1;
  const nextOrder = [...order];
  nextOrder.splice(at === -1 ? nextOrder.length : at + 1, 0, sectionId);
  return {
    ...template,
    sections: { ...template.sections, [sectionId]: section },
    order: nextOrder,
  };
}

/** Removes a section and its order entry. */
export function removeSection(template: ShopifyTemplate, sectionId: string): ShopifyTemplate {
  if (!template.sections[sectionId]) return template;
  const sections = { ...template.sections };
  delete sections[sectionId];
  return {
    ...template,
    sections,
    order: (template.order ?? Object.keys(template.sections)).filter((id) => id !== sectionId),
  };
}

/** Follows a path of block ids down a section's (possibly nested) blocks. Empty path = the section itself. */
export function getBlockAt(section: ShopifySection, blockPath: string[]): ShopifySection | ShopifyBlock | undefined {
  let node: ShopifySection | ShopifyBlock | undefined = section;
  for (const id of blockPath) {
    node = node?.blocks?.[id];
    if (!node) return undefined;
  }
  return node;
}

/**
 * Writes one setting at a (section or nested-block) path, immutably. The editor's original
 * updateSetting only reached section-level settings; inline text editing needs block depth.
 */
export function setSettingAtPath(
  section: ShopifySection,
  blockPath: string[],
  settingId: string,
  value: unknown,
): ShopifySection {
  if (blockPath.length === 0) {
    return { ...section, settings: { ...section.settings, [settingId]: value } };
  }
  const [head, ...rest] = blockPath;
  const child = section.blocks?.[head];
  if (!child) return section;
  return {
    ...section,
    blocks: {
      ...section.blocks,
      [head]: setSettingAtPath(child as ShopifySection, rest, settingId, value) as ShopifyBlock,
    },
  };
}

/** Writes several settings at once at the same path (magic brush, color + enable pairs). */
export function setSettingsAtPath(
  section: ShopifySection,
  blockPath: string[],
  values: Record<string, unknown>,
): ShopifySection {
  return Object.entries(values).reduce(
    (acc, [id, value]) => setSettingAtPath(acc, blockPath, id, value),
    section,
  );
}

/** Removes the block at the end of the path (and its block_order entry), immutably. */
export function removeBlockAt(section: ShopifySection, blockPath: string[]): ShopifySection {
  if (blockPath.length === 0) return section;
  if (blockPath.length === 1) {
    const [id] = blockPath;
    if (!section.blocks?.[id]) return section;
    const blocks = { ...section.blocks };
    delete blocks[id];
    return {
      ...section,
      blocks,
      block_order: (section.block_order ?? Object.keys(section.blocks)).filter((b) => b !== id),
    };
  }
  const [head, ...rest] = blockPath;
  const child = section.blocks?.[head];
  if (!child) return section;
  return {
    ...section,
    blocks: {
      ...section.blocks,
      [head]: removeBlockAt(child as ShopifySection, rest) as ShopifyBlock,
    },
  };
}

/** Moves the block at the end of `blockPath` one step up (-1) or down (+1) within its parent's block_order. */
export function moveBlockAt(section: ShopifySection, blockPath: string[], delta: -1 | 1): ShopifySection {
  if (blockPath.length === 0) return section;
  if (blockPath.length === 1) {
    const [id] = blockPath;
    if (!section.blocks?.[id]) return section;
    const order = section.block_order ?? Object.keys(section.blocks);
    const from = order.indexOf(id);
    const to = from + delta;
    if (from === -1 || to < 0 || to >= order.length) return section;
    const next = [...order];
    next.splice(from, 1);
    next.splice(to, 0, id);
    return { ...section, block_order: next };
  }
  const [head, ...rest] = blockPath;
  const child = section.blocks?.[head];
  if (!child) return section;
  return {
    ...section,
    blocks: {
      ...section.blocks,
      [head]: moveBlockAt(child as ShopifySection, rest, delta) as ShopifyBlock,
    },
  };
}

/**
 * Appends a new block to the end of the block list at `blockPath` (empty = the section's own
 * top-level blocks), immutably. Mirrors `removeBlockAt`'s recursion, since a container block
 * (e.g. a Custom Columns "Column") can itself declare a `blocks` schema one level deeper.
 */
export function addBlockAt(section: ShopifySection, blockPath: string[], id: string, block: ShopifyBlock): ShopifySection {
  if (blockPath.length === 0) {
    return {
      ...section,
      blocks: { ...section.blocks, [id]: block },
      block_order: [...(section.block_order ?? Object.keys(section.blocks ?? {})), id],
    };
  }
  const [head, ...rest] = blockPath;
  const child = section.blocks?.[head];
  if (!child) return section;
  return {
    ...section,
    blocks: {
      ...section.blocks,
      [head]: addBlockAt(child as ShopifySection, rest, id, block) as ShopifyBlock,
    },
  };
}

/** Replaces one section object wholesale (what a rewrite response does client-side). */
export function replaceSection(
  template: ShopifyTemplate,
  sectionId: string,
  section: ShopifySection,
): ShopifyTemplate {
  if (!template.sections[sectionId]) return template;
  return { ...template, sections: { ...template.sections, [sectionId]: section } };
}
