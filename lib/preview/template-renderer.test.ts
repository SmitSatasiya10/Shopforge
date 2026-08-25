import { describe, expect, it } from "vitest";
import { renderTemplate } from "./template-renderer";
import { createFsTemplateReader, createFsBinaryReader } from "./fs-template-reader";
import { ShopifyTemplate, ShopifyTemplateSchema, orderedSections } from "./shopify-template";
import { NormalizedProduct } from "@/lib/product/types";

const product: NormalizedProduct = {
  title: "Aurora Merino Crew",
  description: "A midweight merino crew knit for everyday layering.",
  price: 128,
  compareAtPrice: 160,
  currency: "USD",
  images: [
    { url: "https://example.com/front.jpg", altText: "Front view" },
    { url: "https://example.com/detail.jpg", altText: null },
  ],
  variants: [{ title: "Small / Fog", price: 128, sku: "AMC-S-FOG" }],
  options: [{ name: "Size", values: ["Small", "Medium", "Large"] }],
  vendor: "Northwake",
  productUrl: "https://example.com/products/aurora-merino-crew",
  source: "shopify",
};

const readTemplate = createFsTemplateReader();

async function readThemeTemplate(name: string): Promise<ShopifyTemplate> {
  return ShopifyTemplateSchema.parse(JSON.parse(await readTemplate(`templates/${name}.json`)));
}

/** Section-level render failures are emitted as HTML comments rather than thrown. */
function sectionFailures(html: string): string[] {
  return [...html.matchAll(/<!-- shopforge: [^>]*?-->/g)].map((m) => m[0]);
}

describe("rendering the real Base Theme", () => {
  for (const name of ["product", "index"]) {
    it(`renders the theme's own ${name}.json with no section failures`, async () => {
      const html = await renderTemplate({
        template: await readThemeTemplate(name),
        product,
        storeName: "Northwake",
        readTemplate,
        templateName: name,
      });

      expect(html).toContain("<!doctype html>");
      expect(sectionFailures(html)).toEqual([]);
      // The theme's real sections produce a substantial page; a near-empty render means the
      // layout rendered but its section groups silently dropped out.
      expect(html.length).toBeGreaterThan(50_000);
    }, 60_000);
  }

  it("renders the header and footer section groups into the layout", async () => {
    const html = await renderTemplate({
      template: await readThemeTemplate("product"),
      product,
      storeName: "Northwake",
      readTemplate,
      templateName: "product",
    });
    // {% sections 'header-group' %} / 'footer-group' resolve through the sections tag.
    expect(html).toContain('data-sf-section-type="header"');
    expect(html).toContain('data-sf-section-type="footer"');
  }, 60_000);

  it("wraps every section instance in selection metadata the editor can resolve", async () => {
    const template = await readThemeTemplate("product");
    const html = await renderTemplate({
      template,
      product,
      storeName: "Northwake",
      readTemplate,
      templateName: "product",
    });
    for (const [id, instance] of orderedSections(template)) {
      expect(html).toContain(`data-sf-section-id="${id}"`);
      expect(html).toContain(`data-sf-section-type="${instance.type}"`);
    }
  }, 60_000);

  it("puts the imported product's own data into the page", async () => {
    const html = await renderTemplate({
      template: await readThemeTemplate("product"),
      product,
      storeName: "Northwake",
      readTemplate,
      templateName: "product",
    });
    expect(html).toContain("Aurora Merino Crew");
  }, 60_000);

  it("renders theme blocks, converting decimal prices to the cents Shopify's Liquid expects", async () => {
    // This test builds its own minimal template rather than loading templates/product.json,
    // so the price path is exercised with an explicit price block rather than assumed.
    const template: ShopifyTemplate = {
      sections: {
        main: {
          type: "main-product",
          settings: {},
          blocks: {
            title: { type: "product_title", settings: {} },
            price: { type: "product_price", settings: {} },
          },
          block_order: ["title", "price"],
        },
      },
      order: ["main"],
    };
    const html = await renderTemplate({
      template,
      product,
      storeName: "Northwake",
      readTemplate,
      templateName: "product",
    });

    expect(html).toContain("Aurora Merino Crew");
    // price 128 (decimal) -> 12800 (cents) -> "$128.00" through the money filter.
    expect(html).toContain("$128.00");
    expect(html).toContain("$160.00"); // compare-at price
  }, 60_000);

  it("resolves theme settings into the layout's CSS variables", async () => {
    const html = await renderTemplate({
      template: await readThemeTemplate("index"),
      product,
      storeName: "Northwake",
      readTemplate,
      templateName: "index",
    });

    // The blank-preview regression. `settings_data.json` omits body_scale, so without the
    // schema-default fallback the layout emits `--font-body-scale: 0`, the root font-size
    // computes to 0px, and every rem-based dimension in the theme collapses to zero — the
    // page renders into the DOM and is invisible.
    expect(html).toContain("--font-body-scale: 1");
    expect(html).not.toContain("--font-body-scale: 0;");
    expect(html).toMatch(/--page-width:\s*\d+(\.\d+)?rem/);
  }, 60_000);

  it("presents the page as though the theme's JavaScript had run", async () => {
    const html = await renderTemplate({
      template: await readThemeTemplate("index"),
      product,
      storeName: "Northwake",
      readTemplate,
      templateName: "index",
    });
    // The iframe has no allow-scripts, so the theme can never reveal its own content.
    expect(html).toContain('<html class="js"');
    expect(html).toContain("data-shopforge-preview");
  }, 60_000);

  it("rewrites shopify:// image references to the vendored theme images", async () => {
    const template: ShopifyTemplate = {
      sections: {
        hero: {
          type: "image-with-text",
          settings: { image: "shopify://shop_images/Jane_Doe.png" },
        },
      },
      order: ["hero"],
    };
    const html = await renderTemplate({
      template,
      product,
      storeName: "Northwake",
      readTemplate,
      templateName: "index",
    });
    expect(html).toContain("/base-theme/images/Jane_Doe.png");
    expect(html).not.toContain("shopify://shop_images/Jane_Doe.png");
  }, 60_000);

  it("exposes global objects to snippets rendered with {% render %}", async () => {
    const html = await renderTemplate({
      template: await readThemeTemplate("index"),
      product,
      storeName: "Northwake",
      readTemplate,
      templateName: "index",
    });
    // sections/header.liquid's JSON-LD block renders `"name": {{ shop.name | json }}`, which
    // (unlike header-logo.liquid's text-logo fallback, only used when no logo image is
    // configured) always renders regardless of theme settings. LiquidJS hides the caller's
    // *scope* from {% render %} but propagates globals — passing the Shopify context as scope
    // left all 639 render sites without shop/section/settings.
    expect(html).toContain('"name": "Northwake"');
  }, 60_000);

  it("resolves link_list settings so the header renders its menu", async () => {
    const html = await renderTemplate({
      template: await readThemeTemplate("index"),
      product,
      storeName: "Northwake",
      readTemplate,
      templateName: "index",
    });
    // header-group.json stores `"menu": "main-menu"` — a handle Shopify resolves to a
    // LinkList. Left as a string, `section.settings.menu.links` is undefined and the nav
    // renders empty while still claiming the `header--has-menu` class.
    expect(html).toContain("Catalog");
    expect(html).toContain("/collections/all");
  }, 60_000);

  it("computes a realistic --header-height from the logo's real aspect ratio, not a wrong 1:1 guess", async () => {
    // slideshow-hero's transparent-header design (snippets/transparent-header-css.liquid)
    // pulls the hero up by `calc(var(--header-height) * -1)` so the header can float on top of
    // it. header.liquid derives that height from `settings.logo_width / settings.logo.aspect_ratio`
    // — with the Image drop's un-corrected 1:1 default, a real theme's wide logo (~4.8:1)
    // computed a wildly tall "logo height" (~240px instead of ~50px), inflating the header to
    // ~264px and pulling the hero up far enough to cover the header entirely. Passing a real
    // readBinary must keep this small and sane.
    const html = await renderTemplate({
      template: await readThemeTemplate("index"),
      product,
      storeName: "Northwake",
      readTemplate,
      readBinary: createFsBinaryReader(),
      templateName: "index",
    });
    const match = html.match(/--header-height:\s*(\d+)px/);
    expect(match).not.toBeNull();
    const headerHeight = Number(match![1]);
    expect(headerHeight).toBeGreaterThan(40);
    expect(headerHeight).toBeLessThan(150);
  }, 60_000);

  it("resolves color settings into rgb components the theme's CSS variables need", async () => {
    const html = await renderTemplate({
      template: await readThemeTemplate("index"),
      product,
      storeName: "Northwake",
      readTemplate,
      templateName: "index",
    });
    // Sections emit `--color-background: {{ x.red }}, {{ x.green }}, {{ x.blue }};`. Left as
    // a raw string every one of those resolved to `, , ` and the page lost all of its colour.
    const filled = html.match(/--color-[a-z-]+:\s*\d+,\s*\d+,\s*\d+/g) ?? [];
    expect(filled.length).toBeGreaterThan(20);

    // Blanks still appear where a setting genuinely has no value — the slideshow emits a
    // `.color-custom` rule for slides that never enable custom colours — which is what real
    // Shopify emits too. What must not happen is *every* colour resolving blank.
    const blank = html.match(/--color-[a-z-]+:\s*,\s*,\s*;/g) ?? [];
    expect(blank.length).toBeLessThan(filled.length);
  }, 60_000);

  it("renders with no product at all", async () => {
    const html = await renderTemplate({
      template: await readThemeTemplate("index"),
      product: null,
      storeName: "Shopforge Demo",
      readTemplate,
      templateName: "index",
    });
    expect(html).toContain("<!doctype html>");
    expect(sectionFailures(html)).toEqual([]);
  }, 60_000);

  it("degrades a single unknown section instead of failing the page", async () => {
    const template: ShopifyTemplate = {
      sections: {
        real: { type: "rich-text", settings: {} },
        fake: { type: "not-a-real-section", settings: {} },
      },
      order: ["real", "fake"],
    };
    const html = await renderTemplate({
      template,
      product,
      storeName: "Northwake",
      readTemplate,
      templateName: "index",
    });
    expect(html).toContain('data-sf-section-type="rich-text"');
    expect(html).toContain('section type "not-a-real-section" is not in this theme');
  }, 60_000);
});
