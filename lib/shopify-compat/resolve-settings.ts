import { ShopifySettingDef } from "@/lib/preview/section-schema";
import { BinaryReader } from "@/lib/preview/template-loader";
import { ColorDrop, FontDrop, ImageDrop, LinkListDrop, defaultLinkLists } from "./setting-drops";
import { parseImageDimensions } from "./image-dimensions";

// Turns the raw values stored in template JSON / settings_data.json into the objects the
// theme's Liquid expects, using the `type` each setting declares in its own `{% schema %}`.
// Anything whose type needs no resolution passes through untouched.

/** `shopify://shop_images/<file>` is a merchant upload; the theme's are vendored locally. */
function resolveImageUrl(raw: string): string {
  const uploaded = raw.match(/^shopify:\/\/(?:shop_images|files)\/(.+)$/);
  if (uploaded) return `/base-theme/images/${uploaded[1]}`;
  if (raw.startsWith("shopify:")) return "";
  return raw;
}

export interface ResolveContext {
  linklists: Record<string, LinkListDrop>;
  /** Reads a Base Theme asset's bytes, for real aspect_ratio on the theme's own vendored images. */
  readBinary?: BinaryReader;
}

export function defaultResolveContext(readBinary?: BinaryReader): ResolveContext {
  return { linklists: defaultLinkLists(), readBinary };
}

const LOCAL_IMAGE = /^\/base-theme\/(images\/.+)$/;
// Same image is often referenced by several settings in one render (a logo, a repeated icon);
// cache dimensions per URL for the process lifetime rather than re-reading/re-parsing bytes.
const dimensionsCache = new Map<string, Promise<{ width: number; height: number } | null>>();

/**
 * A merchant's uploaded image is an arbitrary remote URL — fetching it during render would be
 * slow and unreliable, so it keeps the ImageDrop's 1:1 default. The Base Theme's OWN images
 * are real files this render already has local/fetchable access to (via the same reader
 * abstraction `readTemplate` uses for everything else), so their real dimensions are cheap and
 * safe to read.
 */
async function resolveImageDrop(url: string, ctx: ResolveContext): Promise<ImageDrop> {
  const local = url.match(LOCAL_IMAGE);
  if (!local || !ctx.readBinary) return new ImageDrop(url);
  const relativePath = local[1];
  let cached = dimensionsCache.get(relativePath);
  if (!cached) {
    cached = ctx
      .readBinary(relativePath)
      .then(parseImageDimensions)
      .catch(() => null);
    dimensionsCache.set(relativePath, cached);
  }
  return new ImageDrop(url, "", await cached);
}

async function resolveOne(type: string, value: unknown, ctx: ResolveContext): Promise<unknown> {
  // An unset setting must stay falsy so the theme's `!= blank` guards take the empty branch.
  if (value === "" || value === null || value === undefined) {
    return type === "checkbox" ? false : "";
  }

  switch (type) {
    case "color":
      return new ColorDrop(String(value));

    case "image_picker": {
      const url = resolveImageUrl(String(value));
      return url ? await resolveImageDrop(url, ctx) : "";
    }

    case "link_list":
      return ctx.linklists[String(value)] ?? { handle: String(value), title: "", levels: 0, links: [] };

    case "font_picker":
      return new FontDrop(String(value));

    // Objects the preview has no store to resolve against. Returning null (not the raw
    // handle) is what makes the theme's `{% if section.settings.x %}` guards take the empty
    // branch instead of reading properties off a string.
    case "collection":
    case "product":
    case "blog":
    case "page":
    case "article":
      return null;
    case "collection_list":
    case "product_list":
      return [];

    // `color_background` holds a CSS gradient, `video`/`video_url` hold URLs — all strings.
    default:
      return value;
  }
}

/** Resolves one settings object against the schema that declares its types. */
export async function resolveSettings(
  raw: Record<string, unknown> | undefined,
  schema: ShopifySettingDef[] | undefined,
  ctx: ResolveContext,
): Promise<Record<string, unknown>> {
  const values = { ...(raw ?? {}) };
  if (!schema) return values;

  const resolved: Record<string, unknown> = { ...values };
  await Promise.all(
    schema.map(async (setting) => {
      if (!setting.id) return;
      const value = setting.id in values ? values[setting.id] : setting.default;
      resolved[setting.id] = await resolveOne(setting.type, value, ctx);
    }),
  );
  return resolved;
}
