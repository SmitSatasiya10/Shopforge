import { formatColor, fromHsl, parseColor, toHsl } from "@/lib/shopify-compat/color";

// Feeds the inline toolbar's color picker (components/ColorPickerPopover.tsx) a "Theme" tab
// built from the store's own brand colors, plus a "Common Colors" row from the theme's
// predefined-swatches setting — rather than a bare native <input type="color">.

export interface ThemeColorRow {
  label: string;
  swatches: string[];
}

export interface NamedColor {
  name: string;
  hex: string;
}

/** A lightness ramp at fixed hue/saturation, light to dark — the reference's per-hue rows. */
const TINT_STEPS = [0.96, 0.88, 0.76, 0.62, 0.5, 0.4, 0.3, 0.2, 0.12];

export function tintRow(hex: string, steps: number[] = TINT_STEPS): string[] {
  const rgb = parseColor(hex);
  if (!rgb) return [];
  const { h, s } = toHsl(rgb);
  return steps.map((l) => formatColor(fromHsl(h, s, l, 1)));
}

/** Grayscale ramp (zero saturation) for the reference's neutral row. */
export function grayRow(steps: number[] = TINT_STEPS): string[] {
  return steps.map((l) => formatColor(fromHsl(0, 0, l, 1)));
}

const BRAND_KEYS = ["colors_accent_1", "colors_accent_2", "colors_solid_button_labels", "colors_text"];

/**
 * The "Theme" tab's rows: one lightness ramp per distinct brand hue the theme currently uses
 * (accent colors first, matching how prominently the reference orders its own rows), plus a
 * trailing grayscale row. Deliberately skips `colors_background_*`/`gradient_*` — those are
 * often near-white or a CSS gradient string, not a hue worth ramping.
 */
export function buildThemePalette(themeSettings: Record<string, unknown>): ThemeColorRow[] {
  const seen = new Set<string>();
  const rows: ThemeColorRow[] = [];
  for (const key of BRAND_KEYS) {
    const raw = themeSettings[key];
    const rgb = typeof raw === "string" ? parseColor(raw) : null;
    if (!rgb) continue;
    const hsl = toHsl(rgb);
    // Near-grayscale brand colors (low saturation) would just duplicate the grayscale row.
    if (hsl.s < 0.08) continue;
    const dedupeKey = `${Math.round(hsl.h / 10)}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    rows.push({ label: key, swatches: tintRow(raw as string) });
  }
  rows.push({ label: "Grayscale", swatches: grayRow() });
  return rows;
}

/**
 * Parses the theme's predefined-swatches setting, which ships in two shapes depending on
 * whether a merchant has customized it: plain `"Name = #hex,\nName = #hex"` (settings_data's
 * `swatches_predefined_colors`) or rich text `"<p>Name = #hex</p>..."`
 * (`swatches_predefined_colors_list`'s schema default). Matching name/hex pairs directly
 * (ignoring commas, newlines, and tags) handles both without caring which one is present.
 */
export function parsePredefinedSwatches(raw: unknown): NamedColor[] {
  const text = String(raw ?? "").replace(/<[^>]+>/g, "\n");
  const colors: NamedColor[] = [];
  for (const match of text.matchAll(/([A-Za-z][A-Za-z0-9 ]*?)\s*=\s*(#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?)/g)) {
    colors.push({ name: match[1].trim(), hex: match[2] });
  }
  return colors;
}

/** Used only if the theme's own settings never resolve — keeps the picker non-empty. */
export const FALLBACK_COMMON_COLORS: NamedColor[] = [
  { name: "Red", hex: "#FF0000" },
  { name: "Orange", hex: "#FFA500" },
  { name: "Yellow", hex: "#FFFF00" },
  { name: "Green", hex: "#008000" },
  { name: "Cyan", hex: "#00FFFF" },
  { name: "Blue", hex: "#0000FF" },
  { name: "Pink", hex: "#FFC0CB" },
  { name: "Black", hex: "#000000" },
  { name: "White", hex: "#FFFFFF" },
];
