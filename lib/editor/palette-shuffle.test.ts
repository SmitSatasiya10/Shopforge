import { describe, expect, it } from "vitest";
import { PALETTES } from "@/lib/editor/magic-brush";
import { deriveBackgroundTwo, deriveSecondary, paletteColors, shufflePaletteColors } from "./palette-shuffle";

describe("shufflePaletteColors", () => {
  it("sets all 7 real Design → Colors settings, not just Primary/Secondary", () => {
    const result = shufflePaletteColors(0);
    expect(Object.keys(result).sort()).toEqual(
      [
        "colors_accent_1",
        "colors_accent_2",
        "colors_background_1",
        "colors_background_2",
        "colors_text",
        "colors_solid_button_labels",
        "colors_outline_button_labels",
      ].sort(),
    );
  });

  it("Background 1 comes straight from the curated palette, so it actually shuffles", () => {
    const palette = PALETTES[3];
    const result = shufflePaletteColors(3);
    expect(result.colors_background_1).toBe(palette.background);
  });

  it("every color is a valid hex string", () => {
    for (let i = 0; i < PALETTES.length; i++) {
      for (const value of Object.values(shufflePaletteColors(i))) {
        expect(value).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    }
  });
});

describe("deriveSecondary / deriveBackgroundTwo", () => {
  it("stay coordinated with their source hue instead of an unrelated color", () => {
    expect(deriveSecondary("#000000")).not.toBe("#000000");
    expect(deriveBackgroundTwo("#ffffff")).not.toBe("#ffffff");
  });
});

describe("paletteColors", () => {
  it("is the single source both the shuffle button and design-templates.ts build on", () => {
    const palette = PALETTES[0];
    const result = paletteColors(palette);
    expect(result.colors_accent_1).toBe(palette.accent);
    expect(result.colors_text).toBe(palette.text);
    expect(result.colors_solid_button_labels).toBe(palette.accentText);
  });
});
