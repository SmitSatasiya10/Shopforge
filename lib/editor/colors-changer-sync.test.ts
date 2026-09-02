import { describe, expect, it } from "vitest";
import { syncColorsChangerSections } from "./colors-changer-sync";
import type { StoreConfiguration } from "@/lib/store-config/store";

function baseConfig(productSections: StoreConfiguration["templates"]["product"]["sections"]): StoreConfiguration {
  return {
    version: 2,
    templates: {
      index: { sections: {} },
      product: { sections: productSections },
    },
    generatedAt: null,
    themeSettings: {},
  };
}

describe("syncColorsChangerSections", () => {
  it("mirrors a changed global color into a colors-changer instance's matching setting", () => {
    const config = baseConfig({
      colors_changer_1: {
        type: "colors-changer",
        settings: { colors_background_1: "#ffffff", colors_text: "#2E2A39" },
      },
    });
    const next = syncColorsChangerSections(config, { colors_background_1: "#38F113" });
    expect(next.templates.product.sections.colors_changer_1.settings.colors_background_1).toBe("#38F113");
    // Untouched keys are left alone.
    expect(next.templates.product.sections.colors_changer_1.settings.colors_text).toBe("#2E2A39");
  });

  it("never introduces a setting the colors-changer instance didn't already declare", () => {
    const config = baseConfig({
      colors_changer_1: { type: "colors-changer", settings: { colors_background_1: "#ffffff" } },
    });
    const next = syncColorsChangerSections(config, { colors_accent_1: "#dd1d1d" });
    expect(next.templates.product.sections.colors_changer_1.settings).not.toHaveProperty("colors_accent_1");
  });

  it("leaves non-colors-changer sections untouched even if they happen to share a setting id", () => {
    const config = baseConfig({
      main: { type: "main-product", settings: { colors_background_1: "#ffffff" } },
    });
    const next = syncColorsChangerSections(config, { colors_background_1: "#38F113" });
    expect(next.templates.product.sections.main.settings.colors_background_1).toBe("#ffffff");
  });

  it("returns the same configuration reference when nothing needs to change", () => {
    const config = baseConfig({
      colors_changer_1: { type: "colors-changer", settings: { colors_background_1: "#38F113" } },
    });
    const next = syncColorsChangerSections(config, { colors_background_1: "#38F113" });
    expect(next).toBe(config);
  });

  it("syncs colors-changer instances across every page template, not just the current one", () => {
    const config: StoreConfiguration = {
      version: 2,
      templates: {
        index: {
          sections: { colors_changer_home: { type: "colors-changer", settings: { colors_background_1: "#ffffff" } } },
        },
        product: {
          sections: { colors_changer_pdp: { type: "colors-changer", settings: { colors_background_1: "#ffffff" } } },
        },
      },
      generatedAt: null,
      themeSettings: {},
    };
    const next = syncColorsChangerSections(config, { colors_background_1: "#38F113" });
    expect(next.templates.index.sections.colors_changer_home.settings.colors_background_1).toBe("#38F113");
    expect(next.templates.product.sections.colors_changer_pdp.settings.colors_background_1).toBe("#38F113");
  });
});
