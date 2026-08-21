import { NormalizedProduct } from "@/lib/product/types";
import { ShopifyTemplate, ShopifyTemplateSchema } from "@/lib/preview/shopify-template";
import { AiConfig, loadAiConfig } from "./config";
import { chat, parseJsonResponse } from "./openrouter";
import { loadCatalog, describeCatalog, sectionsForTemplate, SectionSchema } from "./catalog";
import { resolveImages } from "./images";

// Product -> Shopify template JSON, generated against the section catalog. The model writes
// copy and chooses sections; it never writes Liquid, HTML or CSS (docs/product-spec/02 §1:
// "AI never generates or modifies Liquid, HTML, CSS, or JavaScript"). Anything the model
// returns that is not in the catalog is dropped before the template is accepted.

export type TemplateName = "index" | "product";

export interface GenerateOptions {
  product: NormalizedProduct;
  templateName: TemplateName;
  config?: Partial<AiConfig>;
  signal?: AbortSignal;
}

export interface GenerateResult {
  template: ShopifyTemplate;
  templateName: TemplateName;
  images: { targets: number; generated: number; fromProduct: number };
  droppedSections: string[];
  model: string;
}

const SYSTEM_PROMPT = `You are a Shopify store merchandiser. You lay out and write the copy for
one page of an online store by choosing sections from a fixed catalog and filling in their
settings.

Hard rules:
- Only use section types and block types that appear in the catalog. Never invent one.
- Only use setting keys listed under that section or block. Never invent a setting.
- Where a setting lists allowed values, use exactly one of those values.
- Never write Liquid, HTML structure, CSS or JavaScript. Rich-text settings may contain only
  simple <p>, <strong> and <em> tags.
- Leave every image setting as an empty string "". Images are filled in outside of you.
- Write specific, concrete copy about the actual product given. No lorem ipsum, no
  placeholders like "Your headline here", no square-bracket blanks.

Return a single JSON object of this exact shape and nothing else:
{
  "order": ["section-id-1", "section-id-2"],
  "sections": {
    "section-id-1": {
      "type": "<catalog section type>",
      "settings": { },
      "blocks": { "block-id-1": { "type": "<allowed block type>", "settings": { } } },
      "block_order": ["block-id-1"]
    }
  }
}
The keys in "sections" are ids you invent (lowercase, hyphenated, descriptive). "order" must
list exactly those ids, in the order the sections should appear down the page.`;

export function describeProduct(product: NormalizedProduct): string {
  const money = (n: number | null) =>
    n === null ? "unknown" : `${product.currency ?? "USD"} ${n.toFixed(2)}`;
  return [
    `Title: ${product.title ?? "(missing)"}`,
    `Vendor/brand: ${product.vendor ?? "(missing)"}`,
    `Price: ${money(product.price)}`,
    `Compare-at price: ${money(product.compareAtPrice)}`,
    `Description: ${product.description ?? "(missing)"}`,
    `Options: ${product.options.map((o) => `${o.name} (${o.values.join(", ")})`).join("; ") || "(none)"}`,
    `Variants: ${product.variants.map((v) => v.title).join(", ") || "(none)"}`,
    `Number of product photos available: ${product.images.length}`,
    `Source URL: ${product.productUrl}`,
  ].join("\n");
}

function pageBrief(templateName: TemplateName, product: NormalizedProduct): string {
  if (templateName === "product") {
    return `Build the PRODUCT PAGE for this product. It must include the main product purchase
area, and then sections that answer a shopper's objections: what it is, why it is better,
what other customers say, and answers to common questions. Do not include a homepage-style
hero carousel.`;
  }
  return `Build the HOMEPAGE for a single-product store selling this product. Lead with a strong
above-the-fold section, then trust/benefit sections, social proof, and a closing call to
action. The store sells essentially one product — ${product.title ?? "this product"} — so do
not lay out a multi-category catalog.`;
}

/** Drops anything the model invented, so an unrenderable section can never reach the preview. */
function pruneToCatalog(
  template: ShopifyTemplate,
  allowed: SectionSchema[],
): { template: ShopifyTemplate; dropped: string[] } {
  const allowedIds = new Set(allowed.map((s) => s.id));
  const allowedBlocks = new Map(allowed.map((s) => [s.id, new Set(s.allowed_blocks ?? [])]));
  const dropped: string[] = [];

  const sections: ShopifyTemplate["sections"] = {};
  for (const [id, section] of Object.entries(template.sections)) {
    if (!allowedIds.has(section.type)) {
      dropped.push(section.type);
      continue;
    }
    const permitted = allowedBlocks.get(section.type) ?? new Set<string>();
    if (section.blocks) {
      const kept: NonNullable<typeof section.blocks> = {};
      for (const [blockId, block] of Object.entries(section.blocks)) {
        if (permitted.has(block.type)) kept[blockId] = block;
        else dropped.push(`${section.type}/${block.type}`);
      }
      section.blocks = kept;
      section.block_order = (section.block_order ?? Object.keys(kept)).filter((b) => kept[b]);
    }
    sections[id] = section;
  }

  const order = (template.order ?? Object.keys(sections)).filter((id) => sections[id]);
  return { template: { ...template, sections, order }, dropped };
}

/**
 * Generates one template. Image settings are populated after generation by the image toggle
 * (lib/ai/images.ts) — the model is told to leave them empty precisely so that step owns them.
 */
export async function generateTemplate(options: GenerateOptions): Promise<GenerateResult> {
  const config = loadAiConfig(options.config);
  const { sections, blocks } = await loadCatalog();
  const allowed = sectionsForTemplate(sections, options.templateName);

  const raw = await chat({
    config,
    json: true,
    signal: options.signal,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          `SECTION CATALOG (the only sections and blocks you may use):`,
          describeCatalog(allowed, blocks),
          ``,
          `PRODUCT:`,
          describeProduct(options.product),
          ``,
          `TASK:`,
          pageBrief(options.templateName, options.product),
        ].join("\n"),
      },
    ],
  });

  const parsed = ShopifyTemplateSchema.parse(parseJsonResponse(raw));
  const { template, dropped } = pruneToCatalog(parsed, allowed);
  const images = await resolveImages(
    template,
    sections,
    blocks,
    options.product,
    config,
    options.signal,
  );

  return {
    template,
    templateName: options.templateName,
    images,
    droppedSections: dropped,
    model: config.model,
  };
}

/** Generates the homepage and the product page for one imported product. */
export async function generateStore(
  product: NormalizedProduct,
  options: { config?: Partial<AiConfig>; signal?: AbortSignal } = {},
): Promise<Record<TemplateName, GenerateResult>> {
  const [index, productPage] = await Promise.all([
    generateTemplate({ product, templateName: "index", ...options }),
    generateTemplate({ product, templateName: "product", ...options }),
  ]);
  return { index, product: productPage };
}
