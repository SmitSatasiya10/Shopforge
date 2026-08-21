import { z } from "zod";
import { ShopifyTemplate, ShopifyTemplateSchema } from "@/lib/preview/shopify-template";
import { TemplateReader } from "@/lib/preview/template-loader";

// A project's Store Configuration is now the Shopify template JSON for each page it owns,
// rather than a Shopforge-specific section list. The preview renders these templates and the
// Shopify Admin API accepts the same objects at publish time, so there is one artifact
// instead of two representations that have to be kept in sync
// (docs/product-spec/03-store-configuration.md, 14-shopify-publishing.md).

export const PAGE_TEMPLATES = ["index", "product"] as const;
export type PageTemplate = (typeof PAGE_TEMPLATES)[number];

export const StoreConfigurationSchema = z.object({
  version: z.literal(2),
  templates: z.object({
    index: ShopifyTemplateSchema,
    product: ShopifyTemplateSchema,
  }),
  /** Set once AI generation has run, so the editor can tell generated from default. */
  generatedAt: z.string().nullable().default(null),
});

export type StoreConfiguration = z.infer<typeof StoreConfigurationSchema>;

/**
 * The Base Theme's own templates, used as a project's starting point. A new project is
 * immediately previewable this way, before (and if) AI generation ever runs — generation is
 * a separate, slower step rather than something project creation blocks on.
 */
export async function defaultConfiguration(readTemplate: TemplateReader): Promise<StoreConfiguration> {
  const [index, product] = await Promise.all(
    PAGE_TEMPLATES.map(async (name) =>
      ShopifyTemplateSchema.parse(JSON.parse(await readTemplate(`templates/${name}.json`))),
    ),
  );
  return { version: 2, templates: { index, product }, generatedAt: null };
}

/** Reads a persisted configurationJson, rejecting anything that is not the v2 shape. */
export function parseConfiguration(value: unknown): StoreConfiguration {
  return StoreConfigurationSchema.parse(value);
}

export function templateFor(config: StoreConfiguration, page: PageTemplate): ShopifyTemplate {
  return config.templates[page];
}
