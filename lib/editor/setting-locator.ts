import { ShopifySection } from "@/lib/preview/shopify-template";

// Resolves a clicked piece of preview text back to the setting it came from
// (docs/EDITOR-TOOLBARS.md). The Base Theme's sections emit no `data-sf-setting` metadata,
// so the DOM alone cannot name the setting — but the text itself can: a heading's rendered
// text IS some setting's value. The locator searches the section's JSON for that exact
// string (tags stripped, whitespace normalised) and binds only on a unique match, so two
// blocks with identical copy can never cause an edit to land on the wrong one.

export interface TextBinding {
  /** Block ids from the section down to the owner; empty = a section-level setting. */
  blockPath: string[];
  settingId: string;
}

/**
 * Pseudo-setting for text that renders `{{ product.title }}` (the product page's <h1>,
 * sticky ATC, …). The product name is product data, not a template setting, so a commit
 * bound to this id is saved to the Product record instead of configurationJson.
 */
export const PRODUCT_TITLE_SETTING = "__sf_product_title";

/**
 * Pseudo-setting for text that renders `{{ product.description }}` (the description block).
 * Same reasoning as `PRODUCT_TITLE_SETTING`: product data, not a template setting, so a commit
 * bound to this id is saved to the Product record instead of configurationJson — and, unlike a
 * template setting, it can never be reached by a section/block rewrite, whole-section or
 * scoped, since it simply isn't part of that JSON to begin with.
 */
export const PRODUCT_DESCRIPTION_SETTING = "__sf_product_description";

/** Mirrors how richtext renders to visible text: tags out, entities and whitespace normalised. */
export function normalizeText(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Path of the unique block of `type` inside the section, or null on zero/several matches.
 * Used to anchor the product-title pseudo-binding to the real `product_title` block, so the
 * toolbar can offer that block's own schema controls (size, alignment) while the text
 * itself still commits to the Product record.
 */
export function locateBlockPathByType(section: ShopifySection, type: string): string[] | null {
  const matches: string[][] = [];
  const visit = (node: { blocks?: Record<string, { type?: string }> }, path: string[]) => {
    for (const [blockId, block] of Object.entries(node.blocks ?? {})) {
      if (block.type === type) matches.push([...path, blockId]);
      visit(block as { blocks?: Record<string, { type?: string }> }, [...path, blockId]);
    }
  };
  visit(section, []);
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Finds the setting whose value renders as `text`. Returns the binding on exactly one
 * match; null on zero (theme copy, product data) or several (ambiguous — safer not to bind).
 */
export function locateTextSetting(section: ShopifySection, text: string): TextBinding | null {
  const needle = normalizeText(text);
  if (!needle) return null;

  const matches: TextBinding[] = [];
  const visit = (node: { settings?: Record<string, unknown>; blocks?: Record<string, unknown> }, path: string[]) => {
    for (const [settingId, value] of Object.entries(node.settings ?? {})) {
      if (typeof value === "string" && normalizeText(value) === needle) {
        matches.push({ blockPath: path, settingId });
      }
    }
    for (const [blockId, block] of Object.entries(node.blocks ?? {})) {
      visit(block as { settings?: Record<string, unknown> }, [...path, blockId]);
    }
  };
  visit(section, []);

  return matches.length === 1 ? matches[0] : null;
}
