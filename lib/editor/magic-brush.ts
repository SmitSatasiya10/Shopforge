import { ShopifySection } from "@/lib/preview/shopify-template";
import { ShopifySectionSchema, ShopifySettingDef } from "@/lib/preview/section-schema";
import { setSettingsAtPath } from "@/lib/store-config/template-ops";

// The Magic Brush (docs/EDITOR-TOOLBARS.md): one click restyles the selected section with a
// random palette. "Random" means random among curated palettes — a random RGB triple is
// almost always ugly and often unreadable, so the brush rolls dice over hand-picked schemes
// instead, never repeating the one it just used.

export interface Palette {
  name: string;
  background: string;
  text: string;
  accent: string;
  accentText: string;
}

export const PALETTES: Palette[] = [
  { name: "Ink", background: "#111111", text: "#f5f5f0", accent: "#c6f24e", accentText: "#111111" },
  { name: "Paper", background: "#faf7f0", text: "#1c1c1c", accent: "#1c1c1c", accentText: "#faf7f0" },
  { name: "Ocean", background: "#0b3550", text: "#eaf6ff", accent: "#ffb703", accentText: "#0b3550" },
  { name: "Forest", background: "#1e3a2a", text: "#f2f7ef", accent: "#e9c46a", accentText: "#1e3a2a" },
  { name: "Terracotta", background: "#f4e5d7", text: "#5b2a1d", accent: "#c1512f", accentText: "#fff4ec" },
  { name: "Lavender", background: "#efeaff", text: "#2f2352", accent: "#6d4aff", accentText: "#ffffff" },
  { name: "Rose", background: "#fff0f3", text: "#4a1524", accent: "#d81b60", accentText: "#ffffff" },
  { name: "Citrus", background: "#fff8e1", text: "#3e2c00", accent: "#f77f00", accentText: "#fffdf7" },
  { name: "Slate", background: "#eceff1", text: "#22303a", accent: "#22303a", accentText: "#eceff1" },
  { name: "Midnight", background: "#151a2d", text: "#e6e9ff", accent: "#5e81ff", accentText: "#ffffff" },
  { name: "Mint", background: "#e8f5ee", text: "#0f3d2e", accent: "#0f8a5f", accentText: "#f2fff9" },
  { name: "Sand", background: "#efe6d8", text: "#33291a", accent: "#8a5a2b", accentText: "#fff7ea" },
];

/** A random palette index that differs from the previous roll (or -1 for "no previous"). */
export function rollPalette(previousIndex: number): number {
  if (PALETTES.length < 2) return 0;
  let index = previousIndex;
  while (index === previousIndex) index = Math.floor(Math.random() * PALETTES.length);
  return index;
}

/**
 * The Base Theme's per-section color system: custom colors take effect only when
 * `color_scheme` is "custom" (snippets/custome-colorscheme.liquid styles `.color-custom`),
 * and the five settings below are its well-known inputs. The brush writes whichever of
 * them a schema actually declares.
 */
const CUSTOM_COLOR_SETTINGS: Record<string, keyof Palette> = {
  custom_colors_background: "background",
  custom_colors_text: "text",
  custom_colors_solid_button_background: "accent",
  custom_colors_solid_button_text: "accentText",
  custom_colors_outline_button: "accent",
};

function brushValues(defs: ShopifySettingDef[] | undefined, palette: Palette): Record<string, unknown> {
  const byId = new Map((defs ?? []).filter((d) => d.id).map((d) => [d.id!, d]));
  const values: Record<string, unknown> = {};
  for (const [id, key] of Object.entries(CUSTOM_COLOR_SETTINGS)) {
    if (byId.has(id)) values[id] = palette[key];
  }
  const scheme = byId.get("color_scheme");
  // Only switch the scheme when there are custom colors for "custom" to show.
  if (Object.keys(values).length > 0 && scheme?.options?.some((o) => o.value === "custom")) {
    values["color_scheme"] = "custom";
  }
  return values;
}

/**
 * Fallback for sections that declare no custom color settings (about half the theme, e.g.
 * main-product): step the schema's `color_scheme` select to its next option so the brush
 * still visibly recolors the section. "custom" is skipped — with no custom colors set it
 * renders as unset. Returns null when the section has no usable scheme select.
 */
export function cycleColorScheme(
  section: ShopifySection,
  schema: ShopifySectionSchema | null,
): { section: ShopifySection; label: string } | null {
  const def = schema?.settings?.find((d) => d.id === "color_scheme");
  const options = (def?.options ?? []).filter((o) => o.value !== "custom");
  if (options.length < 2) return null;
  const current = (section.settings["color_scheme"] as string) ?? def?.default;
  const index = options.findIndex((o) => o.value === current);
  const nextOption = options[(index + 1) % options.length];
  return {
    section: setSettingsAtPath(section, [], { color_scheme: nextOption.value }),
    label: nextOption.label ?? nextOption.value,
  };
}

/**
 * Applies a palette to a section: its own settings, and — for sections like slideshow that
 * keep colors on their blocks — every block instance whose schema declares the same
 * settings. Returns the input unchanged when the section has nothing brushable, so the
 * caller can tell a no-op from a change.
 */
export function applyMagicBrush(
  section: ShopifySection,
  schema: ShopifySectionSchema | null,
  palette: Palette,
): ShopifySection {
  if (!schema) return section;
  let next = section;

  const sectionValues = brushValues(schema.settings, palette);
  if (Object.keys(sectionValues).length > 0) next = setSettingsAtPath(next, [], sectionValues);

  const blockSchemaByType = new Map((schema.blocks ?? []).map((b) => [b.type, b.settings]));
  const visit = (node: ShopifySection, path: string[]) => {
    for (const [blockId, block] of Object.entries(node.blocks ?? {})) {
      const values = brushValues(blockSchemaByType.get(block.type), palette);
      if (Object.keys(values).length > 0) next = setSettingsAtPath(next, [...path, blockId], values);
      visit(block as ShopifySection, [...path, blockId]);
    }
  };
  visit(section, []);

  return next;
}
