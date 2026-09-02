import { PALETTES, type Palette } from "@/lib/editor/magic-brush";
import { paletteColors } from "@/lib/editor/palette-shuffle";
import { BUTTON_STYLE_PRESETS, CARD_STYLE_PRESETS, IMAGE_STYLE_PRESETS, type StylePreset } from "@/lib/editor/design-categories";

// The Templates panel's whole-theme presets: each one is a curated bundle of real
// config/settings_schema.json ids, applied together onto StoreConfiguration.themeSettings in
// one commitConfiguration/undo step (same mechanism Design's per-category style presets and the
// palette shuffle already use — lib/editor/design-categories.ts's BUTTON/IMAGE/CARD_STYLE_PRESETS,
// lib/editor/magic-brush.ts's PALETTES). Nothing here invents a new value: colors come from
// PALETTES, button/card/image geometry comes straight from the existing style-preset arrays, and
// the 12 "extra" corner-radius settings (badges, controls, popups, etc. — not covered by any of
// those three) are derived from each setting's own declared min/max so every template stays a
// coherent "sharp" vs "soft" personality instead of a grab-bag of independently-set values.
//
// Every template sets the exact same set of ids (colors + typography + buttons + images + cards
// + icon style + extra radius) so switching from one template to another always fully supersedes
// the previous template's contribution — no stale leftover values from a prior pick.

export interface DesignTemplatePreview {
  background: string;
  text: string;
  accent: string;
  accentText: string;
  /** CSS font-stack for the preview card only (generic fallback resembling the real font's
   *  character) — never sent to themeSettings, which uses the real Shopify font handle below. */
  headingFontStack: string;
  bodyFontStack: string;
}

export interface DesignTemplate {
  id: string;
  name: string;
  description: string;
  /** Real config/settings_schema.json ids -> values, patched onto themeSettings on Apply. */
  values: Record<string, unknown>;
  preview: DesignTemplatePreview;
}

function findPreset(presets: StylePreset[], key: string): Record<string, number> {
  const preset = presets.find((p) => p.key === key);
  if (!preset) throw new Error(`Unknown style preset "${key}"`);
  return preset.values;
}

function paletteByName(name: string): Palette {
  const palette = PALETTES.find((p) => p.name === name);
  if (!palette) throw new Error(`Unknown palette "${name}"`);
  return palette;
}

/** The 15 "*_radius"/"*_corner_radius" ids in config/settings_schema.json, minus the 3
 *  (buttons_radius, media_radius, card_corner_radius) already set by the Buttons/Images/Cards
 *  style preset each template picks — this is the remaining 12, with each id's own declared
 *  min/max/step (lib/editor/design-categories.ts's RADIUS_LABELS documents the full 15). */
const EXTRA_RADIUS_RANGES: Record<string, { min: number; max: number; step: number }> = {
  badge_corner_radius: { min: 0, max: 40, step: 2 },
  slider_arrow_border_radius: { min: 0, max: 100, step: 1 },
  pagination_dot_radius: { min: 0, max: 15, step: 1 },
  swatches_border_radius: { min: 0, max: 100, step: 4 },
  variant_pills_radius: { min: 0, max: 40, step: 2 },
  pickers_radius: { min: 0, max: 40, step: 2 },
  quantity_radius: { min: 0, max: 40, step: 2 },
  inputs_radius: { min: 0, max: 40, step: 2 },
  collection_card_corner_radius: { min: 0, max: 40, step: 2 },
  blog_card_corner_radius: { min: 0, max: 40, step: 2 },
  text_boxes_radius: { min: 0, max: 40, step: 2 },
  popup_corner_radius: { min: 0, max: 40, step: 2 },
};

/** `fraction` (0 = sharpest, 1 = roundest) mapped onto each extra radius id's own declared
 *  range, so one "roundness" knob per template stays within every setting's real min/max. */
function buildExtraRadii(fraction: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, { min, max, step }] of Object.entries(EXTRA_RADIUS_RANGES)) {
    const raw = min + fraction * (max - min);
    out[id] = Math.round(raw / step) * step;
  }
  return out;
}

interface TemplateSpec {
  id: string;
  name: string;
  description: string;
  paletteName: string;
  buttonKey: string;
  cardKey: string;
  imageKey: string;
  /** 0 (sharp corners everywhere) .. 1 (fully rounded) — applied to the 12 extra radius ids. */
  radiusFraction: number;
  /** One of accent_icons's real options (accent-1 / accent-2 / outline-button / text). */
  iconStyle: string;
  /** Real Shopify font handles, both already used by this theme (config/settings_data.json's
   *  `current`/`presets`) so the renderer is proven to resolve them correctly. */
  headerFont: string;
  bodyFont: string;
  headingFontStack: string;
  bodyFontStack: string;
}

const SPECS: TemplateSpec[] = [
  {
    id: "classic",
    name: "Classic",
    description: "Warm neutrals, a traditional serif-style heading, and softly rounded cards.",
    paletteName: "Paper",
    buttonKey: "classic",
    cardKey: "default",
    imageKey: "light",
    radiusFraction: 0.3,
    iconStyle: "text",
    headerFont: "poetsen_one_n4",
    bodyFont: "rubik_n4",
    headingFontStack: "Georgia, 'Times New Roman', serif",
    bodyFontStack: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  },
  {
    id: "modern",
    name: "Modern",
    description: "Cool slate tones, flat solid buttons, and crisp drop-shadow cards.",
    paletteName: "Slate",
    buttonKey: "solid",
    cardKey: "shadow",
    imageKey: "solid",
    radiusFraction: 0.15,
    iconStyle: "accent-1",
    headerFont: "harmonia_sans_n6",
    bodyFont: "harmonia_sans_n4",
    headingFontStack: "system-ui, -apple-system, 'Segoe UI', sans-serif",
    bodyFontStack: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  },
  {
    id: "minimal",
    name: "Minimal",
    description: "Sandy neutrals, no borders or shadows, and unadorned square images.",
    paletteName: "Sand",
    buttonKey: "solid",
    cardKey: "solid",
    imageKey: "none",
    radiusFraction: 0.1,
    iconStyle: "text",
    headerFont: "assistant_n4",
    bodyFont: "assistant_n4",
    headingFontStack: "system-ui, sans-serif",
    bodyFontStack: "system-ui, sans-serif",
  },
  {
    id: "luxury",
    name: "Luxury",
    description: "Deep midnight background, pill-shaped buttons, and polaroid-framed images.",
    paletteName: "Midnight",
    buttonKey: "bubble",
    cardKey: "shadow",
    imageKey: "polaroid",
    radiusFraction: 0.5,
    iconStyle: "accent-1",
    headerFont: "poetsen_one_n4",
    bodyFont: "harmonia_sans_n4",
    headingFontStack: "Georgia, 'Times New Roman', serif",
    bodyFontStack: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  },
  {
    id: "bold",
    name: "Bold",
    description: "Vivid citrus color, square corners, and thick high-contrast borders throughout.",
    paletteName: "Citrus",
    buttonKey: "brick",
    cardKey: "brick",
    imageKey: "brick",
    radiusFraction: 0,
    iconStyle: "accent-1",
    headerFont: "harmonia_sans_n6",
    bodyFont: "rubik_n4",
    headingFontStack: "'Arial Black', Impact, system-ui, sans-serif",
    bodyFontStack: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  },
  {
    id: "natural",
    name: "Natural",
    description: "Earthy forest green and gold, gently rounded buttons, and soft image shadows.",
    paletteName: "Forest",
    buttonKey: "soft",
    cardKey: "default",
    imageKey: "light",
    radiusFraction: 0.35,
    iconStyle: "text",
    headerFont: "rubik_n4",
    bodyFont: "assistant_n4",
    headingFontStack: "'Trebuchet MS', system-ui, sans-serif",
    bodyFontStack: "system-ui, sans-serif",
  },
];

export const DESIGN_TEMPLATES: DesignTemplate[] = SPECS.map((spec) => {
  const palette = paletteByName(spec.paletteName);
  const values: Record<string, unknown> = {
    ...paletteColors(palette),
    type_header_font: spec.headerFont,
    type_body_font: spec.bodyFont,
    ...findPreset(BUTTON_STYLE_PRESETS, spec.buttonKey),
    ...findPreset(IMAGE_STYLE_PRESETS, spec.imageKey),
    ...findPreset(CARD_STYLE_PRESETS, spec.cardKey),
    accent_icons: spec.iconStyle,
    ...buildExtraRadii(spec.radiusFraction),
  };
  return {
    id: spec.id,
    name: spec.name,
    description: spec.description,
    values,
    preview: {
      background: palette.background,
      text: palette.text,
      accent: palette.accent,
      accentText: palette.accentText,
      headingFontStack: spec.headingFontStack,
      bodyFontStack: spec.bodyFontStack,
    },
  };
});

/** The canonical set of ids every template sets — union across all of them, used by tests to
 *  catch drift and by nothing at runtime (Apply just spreads a template's own `values`). */
export const DESIGN_TEMPLATE_SETTING_IDS: string[] = [
  ...new Set(DESIGN_TEMPLATES.flatMap((t) => Object.keys(t.values))),
].sort();

function settingEqual(actual: unknown, expected: unknown): boolean {
  if (typeof expected === "number") return Number(actual) === expected;
  return String(actual ?? "").toLowerCase() === String(expected ?? "").toLowerCase();
}

/** Which template (if any) the current themeSettings already match — same idea as
 *  design-categories.ts's matchStylePreset, just checked across a template's full id set
 *  instead of one category's. undefined is an honest "custom combination", not a bug. */
export function matchDesignTemplate(values: Record<string, unknown>): string | undefined {
  return DESIGN_TEMPLATES.find((template) =>
    Object.entries(template.values).every(([id, expected]) => settingEqual(values[id], expected)),
  )?.id;
}
