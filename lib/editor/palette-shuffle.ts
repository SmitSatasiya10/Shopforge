import { PALETTES, type Palette } from "@/lib/editor/magic-brush";
import { formatColor, fromHsl, parseColor, toHsl } from "@/lib/shopify-compat/color";

// Design → Colors → "Shuffle palette" button. Reuses the exact same curated palette set as the
// per-section Magic Brush (lib/editor/magic-brush.ts::PALETTES/rollPalette) instead of
// inventing a second one — PALETTES was already hand-picked for contrast/readability (see that
// file's own comment: "a random RGB triple is almost always ugly and often unreadable, so the
// brush rolls dice over hand-picked schemes instead"). No AI call, no Math.random() RGB.
//
// A shuffle applies the whole curated palette (background + text + accent + button-label
// colors), not just Primary/Secondary — swapping only the accent while leaving Background/Text
// alone risks a palette whose text becomes unreadable against its own background (e.g. a dark
// palette's light text over the Colors panel's still-light Background 1). All 7 real color
// settings Design → Colors exposes move together, the same coordinated-pair idea
// deriveSecondary already applies to Primary/Secondary.

export type ColorPaletteShuffleResult = Record<string, string>;

/**
 * Secondary is a lighter, less-saturated tint of the same hue as Primary — one curated
 * palette's accent color, expressed as a coordinated pair — rather than two independently
 * rolled colors that might clash. Capped so it stays visually distinct from Primary.
 */
export function deriveSecondary(hex: string): string {
  const rgb = parseColor(hex);
  if (!rgb) return hex;
  const { h, s, l } = toHsl(rgb);
  return formatColor(fromHsl(h, s * 0.85, Math.min(0.92, l + 0.22), 1));
}

/** Background 2 is a subtly shifted tint of Background 1 (schema default: #FFFFFF / #F3F3F3) —
 *  darkened a touch on a light background, lightened a touch on a dark one, same HSL approach
 *  deriveSecondary uses for Primary/Secondary. */
export function deriveBackgroundTwo(hex: string): string {
  const rgb = parseColor(hex);
  if (!rgb) return hex;
  const { h, s, l } = toHsl(rgb);
  const nextL = l > 0.5 ? Math.max(0, l - 0.04) : Math.min(1, l + 0.06);
  return formatColor(fromHsl(h, s, nextL, 1));
}

/** One curated Palette (magic-brush.ts), expressed as the 7 real settings Design → Colors
 *  exposes: Primary/Secondary, Background 1/2, and Text/Solid button label/Outline button
 *  labels. Shared by the Colors panel's shuffle button and lib/editor/design-templates.ts's
 *  whole-theme presets, so both stay coordinated the same way. */
export function paletteColors(palette: Palette): ColorPaletteShuffleResult {
  return {
    colors_accent_1: palette.accent,
    colors_accent_2: deriveSecondary(palette.accent),
    colors_background_1: palette.background,
    colors_background_2: deriveBackgroundTwo(palette.background),
    colors_text: palette.text,
    colors_solid_button_labels: palette.accentText,
    colors_outline_button_labels: palette.accent,
  };
}

/** The palette at `index` (from PALETTES, via lib/editor/magic-brush.ts's rollPalette),
 *  expressed as all 7 real settings Design → Colors has. */
export function shufflePaletteColors(index: number): ColorPaletteShuffleResult {
  return paletteColors(PALETTES[index]);
}
