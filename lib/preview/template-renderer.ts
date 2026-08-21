import type { Liquid } from "liquidjs";
import { NormalizedProduct } from "@/lib/product/types";
import { createShopifyLiquid } from "@/lib/shopify-compat/engine";
import { BlockInstance, buildGlobalContext, buildProductDrop, buildSectionDrop } from "@/lib/shopify-compat/drops";
import { TemplateReader } from "./template-loader";
import { ShopifyTemplate, orderedSections } from "./shopify-template";
import { applyPreviewShims } from "./preview-shims";
import { loadThemeSettings } from "./theme-settings";
import { extractSectionSchema, ShopifySettingDef } from "./section-schema";
import { ResolveContext, defaultResolveContext, resolveSettings } from "@/lib/shopify-compat/resolve-settings";
import { defaultLinkLists } from "@/lib/shopify-compat/setting-drops";
import { normalizeRenderTagArgs } from "@/lib/shopify-compat/render-args";

export interface RenderTemplateOptions {
  /** The template JSON to render — the AI-generated one, or one read from the theme. */
  template: ShopifyTemplate;
  product: NormalizedProduct | null;
  storeName: string;
  readTemplate: TemplateReader;
  /** Which Shopify template this is, so `request.page_type` and `template.name` are right. */
  templateName?: string;
}

async function readJson<T>(readTemplate: TemplateReader, path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readTemplate(path)) as T;
  } catch {
    return fallback;
  }
}

/**
 * Template JSON keys blocks by id and orders them with `block_order`; the drop layer wants
 * an ordered list. Nested blocks (a column inside a container) recurse through the same shape.
 */
function collectBlocks(
  blocks: Record<string, unknown> | undefined,
  order: string[] | undefined,
): BlockInstance[] {
  if (!blocks) return [];
  const ids = order ?? Object.keys(blocks);
  return ids
    .filter((id) => blocks[id])
    .map((id) => {
      const block = blocks[id] as {
        type: string;
        settings?: Record<string, unknown>;
        blocks?: Record<string, unknown>;
        block_order?: string[];
      };
      return {
        id,
        type: block.type,
        settings: block.settings ?? {},
        blocks: collectBlocks(block.blocks, block.block_order),
      };
    });
}

/**
 * Resolves each block's settings against whichever schema declares them: a block type listed
 * in the section's own `{% schema %}`, or — for Online Store 2.0 theme blocks — the schema
 * inside `blocks/<type>.liquid`.
 */
async function resolveBlockSettings(
  blocks: BlockInstance[],
  sectionBlockSchemas: Map<string, ShopifySettingDef[] | undefined>,
  readTemplate: TemplateReader,
  ctx: ResolveContext,
): Promise<BlockInstance[]> {
  return Promise.all(
    blocks.map(async (block) => {
      let schema = sectionBlockSchemas.get(block.type);
      if (!schema) {
        try {
          schema = extractSectionSchema(await readTemplate(`blocks/${block.type}.liquid`))?.settings;
        } catch {
          schema = undefined;
        }
      }
      return {
        ...block,
        settings: resolveSettings(block.settings, schema, ctx),
        blocks: await resolveBlockSettings(block.blocks ?? [], sectionBlockSchemas, readTemplate, ctx),
      };
    }),
  );
}

/**
 * Renders one section instance. The Base Theme's own sections do not emit Shopforge's
 * `data-sf-*` selection metadata (they are authored for Shopify, not for this editor), so
 * the renderer wraps each one in a marker element instead of editing 86 section files.
 * This gives the editor section-level click-to-select; field-level selection still requires
 * the section to opt in with `data-sf-setting` (docs/product-spec/10-dom-metadata-and-selection.md).
 */
async function renderSection(
  engine: Liquid,
  readTemplate: TemplateReader,
  id: string,
  instance: { type: string; settings?: Record<string, unknown>; blocks?: Record<string, unknown>; block_order?: string[] },
  index: number,
  globals: Record<string, unknown>,
  ctx: ResolveContext,
): Promise<string> {
  let source: string;
  try {
    source = await readTemplate(`sections/${instance.type}.liquid`);
  } catch {
    return `<!-- shopforge: section type "${instance.type}" is not in this theme -->`;
  }

  // The section's own {% schema %} declares each setting's type, which is what turns the raw
  // values in template JSON into Color/Image/LinkList objects the theme can read.
  const schema = extractSectionSchema(source);
  const blockSchemas = new Map((schema?.blocks ?? []).map((b) => [b.type, b.settings]));

  const section = buildSectionDrop(
    id,
    instance.type,
    resolveSettings(instance.settings, schema?.settings, ctx),
    await resolveBlockSettings(
      collectBlocks(instance.blocks, instance.block_order),
      blockSchemas,
      readTemplate,
      ctx,
    ),
    index,
  );

  let inner: string;
  try {
    // Passed as `globals`, not as the render scope. LiquidJS isolates `{% render %}` from the
    // caller's scope but propagates globals into it — and the theme calls `{% render %}` 639
    // times, with the snippets reading `shop`, `settings`, `section` and `product` directly
    // (snippets/header-logo.liquid renders `{{ shop.name }}` that way). Shopify's own
    // `{% render %}` behaves the same: outer *variables* are hidden, global objects are not.
    inner = await engine.parseAndRender(source, {}, { globals: { ...globals, section } });
  } catch (error) {
    // One broken section must not blank the whole page — the preview degrades to a visible
    // marker so the editor still renders every other section.
    const message = error instanceof Error ? error.message : String(error);
    inner = `<!-- shopforge: "${instance.type}" failed to render: ${message.replace(/-->/g, "")} -->`;
  }

  return (
    `<div data-sf-section-id="${id}" data-sf-section-type="${instance.type}">${inner}</div>`
  );
}

/** Renders a section group file (`sections/<name>.json`) — header-group / footer-group. */
async function renderSectionGroup(
  engine: Liquid,
  readTemplate: TemplateReader,
  name: string,
  globals: Record<string, unknown>,
  ctx: ResolveContext,
): Promise<string> {
  const group = await readJson<ShopifyTemplate | null>(readTemplate, `sections/${name}.json`, null);
  if (!group) return "";
  const parts = await Promise.all(
    orderedSections(group).map(([id, instance], i) =>
      renderSection(engine, readTemplate, id, instance, i, globals, ctx),
    ),
  );
  return parts.join("\n");
}

/**
 * Renders a Shopify-native template JSON through the real Base Theme's layout — the
 * LiquidRenderer stage of PreviewRuntime (docs/product-spec/06-preview-architecture.md).
 * Always a fresh render, never a DOM patch.
 */
export async function renderTemplate(opts: RenderTemplateOptions): Promise<string> {
  const { template, product, storeName } = opts;
  const templateName = opts.templateName ?? "index";

  // Every .liquid source — sections, snippets (via the engine's fs), and the layout — gets
  // Shopify's bare `{% render 'x', section %}` shorthand rewritten to `section: section`;
  // LiquidJS would otherwise pass `section: undefined` and shadow the global (render-args.ts).
  const readTemplate: TemplateReader = async (path) => {
    const raw = await opts.readTemplate(path);
    return path.endsWith(".liquid") ? normalizeRenderTagArgs(raw) : raw;
  };

  const [locale, settings] = await Promise.all([
    readJson<Record<string, unknown>>(readTemplate, "locales/en.default.json", {}),
    loadThemeSettings(readTemplate),
  ]);

  const engine = createShopifyLiquid({ readTemplate, locale, currency: product?.currency });

  const ctx = defaultResolveContext();
  // Theme settings are typed by config/settings_schema.json the same way section settings are
  // typed by their own {% schema %} — `settings.logo` is an image, the colour settings are
  // Color objects, `type_body_font` is a font.
  const schemaGroups = await readJson<{ settings?: ShopifySettingDef[] }[]>(
    readTemplate,
    "config/settings_schema.json",
    [],
  );
  const themeSettings = resolveSettings(
    settings,
    schemaGroups.flatMap((group) => group.settings ?? []),
    ctx,
  );

  const globals: Record<string, unknown> = {
    ...buildGlobalContext({
      storeName,
      currency: product?.currency,
      settings: themeSettings,
      locale,
    }),
    linklists: defaultLinkLists(),
    product: buildProductDrop(product),
  };
  (globals.request as Record<string, unknown>).page_type = templateName;
  (globals.template as Record<string, unknown>).name = templateName;

  const sections = orderedSections(template);
  const [body, headerGroup, footerGroup] = await Promise.all([
    Promise.all(
      sections.map(([id, instance], i) => renderSection(engine, readTemplate, id, instance, i, globals, ctx)),
    ).then((parts) => parts.join("\n")),
    renderSectionGroup(engine, readTemplate, "header-group", globals, ctx),
    renderSectionGroup(engine, readTemplate, "footer-group", globals, ctx),
  ]);

  const layout = await readTemplate("layout/theme.liquid");
  const page = await engine.parseAndRender(
    layout,
    {},
    {
      globals: {
        ...globals,
        content_for_layout: body,
        content_for_header_group: headerGroup,
        content_for_footer_group: footerGroup,
      },
    },
  );

  // The iframe runs the theme without its JavaScript, so anything the theme's own scripts
  // would have revealed on load has to be pinned open here.
  return applyPreviewShims(page);
}
