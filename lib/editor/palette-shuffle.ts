import { PALETTES } from "@/lib/editor/magic-brush";
import { formatColor, fromHsl, parseColor, toHsl } from "@/lib/shopify-compat/color";

// Design → Colors → Color Palette's "Shuffle" button. Reuses the exact same curated palette
// set as the per-section Magic Brush (lib/editor/magic-brush.ts::PALETTES/rollPalette) instead
// of inventing a second one — PALETTES was already hand-picked for contrast/readability (see
// that file's own comment: "a random RGB triple is almost always ugly and often unreadable, so
// the brush rolls dice over hand-picked schemes instead"). No AI call, no Math.random() RGB.

export interface ColorPaletteShuffleResult {
  colors_accent_1: string;
  colors_accent_2: string;
  [id: string]: string;
}

/**
 * Secondary is a lighter, less-saturated tint of the same hue as Primary — one curated
 * palette's accent color, expressed as a coordinated pair — rather than two independently
 * rolled colors that might clash. Capped so it stays visually distinct from Primary.
 */
function deriveSecondary(hex: string): string {
  const rgb = parseColor(hex);
  if (!rgb) return hex;
  const { h, s, l } = toHsl(rgb);
  return formatColor(fromHsl(h, s * 0.85, Math.min(0.92, l + 0.22), 1));
}

/** The palette at `index` (from PALETTES, via lib/editor/magic-brush.ts's rollPalette),
 *  expressed as the two real settings Design → Colors → Color Palette actually has. */
export function shufflePaletteColors(index: number): ColorPaletteShuffleResult {
  const palette = PALETTES[index];
  return {
    colors_accent_1: palette.accent,
    colors_accent_2: deriveSecondary(palette.accent),
  };
}
