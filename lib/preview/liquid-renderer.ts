import { Liquid } from "liquidjs";
import { registerShopifyFilters } from "@/lib/shopify-compat/filters";
import { resolveSectionDefinition, mergeSettingsWithDefaults } from "./section-resolver";
import { StoreConfiguration } from "@/lib/store-config/types";
import { NormalizedProduct } from "@/lib/product/types";
import { TemplateReader } from "./template-loader";

/** Real Liquid files carry a Shopify-native `{% schema %}` block that LiquidJS has no tag for — stripped before parsing, never persisted back. */
function stripSchemaBlock(source: string): string {
  return source.replace(/{%-?\s*schema\s*-?%}[\s\S]*?{%-?\s*endschema\s*-?%}/, "");
}

export interface RenderOptions {
  configuration: StoreConfiguration;
  product: NormalizedProduct | null;
  storeName: string;
  readTemplate: TemplateReader;
}

/**
 * PreviewRuntime's LiquidRenderer stage: resolve each SectionInstance's real .liquid
 * template, inject Store Configuration settings + hydrated product into a Shopify-shaped
 * context, render through LiquidJS, and assemble a full page inside the Base Theme layout.
 * Always a fresh render() — no DOM patching (docs/product-spec/06-preview-architecture.md).
 */
export async function renderStorePreview(opts: RenderOptions): Promise<string> {
  const engine = new Liquid({ cache: false });
  const localeSource = await opts.readTemplate("locales/en.default.json");
  const locale = JSON.parse(localeSource) as Record<string, unknown>;
  registerShopifyFilters(engine, locale);

  const shop = { name: opts.storeName };
  const routes = { root_url: "/" };
  const settings: Record<string, unknown> = {};

  const sectionsHtml = await Promise.all(
    opts.configuration.pages.product.sections.map(async (instance) => {
      const def = resolveSectionDefinition(instance.type);
      const source = await opts.readTemplate(def.liquidPath);
      const context = {
        section: { id: instance.id, settings: mergeSettingsWithDefaults(def, instance.settings) },
        product: opts.product,
        shop,
        routes,
        settings,
        localization: locale,
      };
      return engine.parseAndRender(stripSchemaBlock(source), context);
    }),
  );

  const layoutSource = await opts.readTemplate("layout/theme.liquid");
  return engine.parseAndRender(stripSchemaBlock(layoutSource), {
    shop,
    routes,
    settings,
    content_for_layout: sectionsHtml.join("\n"),
  });
}
