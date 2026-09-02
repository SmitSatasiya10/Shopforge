import { describe, expect, it } from "vitest";
import { DESIGN_TEMPLATE_SETTING_IDS, DESIGN_TEMPLATES, matchDesignTemplate } from "./design-templates";
import settingsSchema from "@/public/base-theme/config/settings_schema.json";
import type { ShopifySettingDef } from "@/lib/preview/section-schema";

interface SchemaGroup {
  name?: string;
  settings?: ShopifySettingDef[];
}

const ALL_SETTINGS = new Map<string, ShopifySettingDef>();
for (const group of settingsSchema as SchemaGroup[]) {
  for (const setting of group.settings ?? []) {
    if (setting.id) ALL_SETTINGS.set(setting.id, setting);
  }
}

describe("DESIGN_TEMPLATES", () => {
  it("has unique ids and names", () => {
    expect(new Set(DESIGN_TEMPLATES.map((t) => t.id)).size).toBe(DESIGN_TEMPLATES.length);
    expect(new Set(DESIGN_TEMPLATES.map((t) => t.name)).size).toBe(DESIGN_TEMPLATES.length);
  });

  it("every template sets exactly the canonical set of ids", () => {
    for (const template of DESIGN_TEMPLATES) {
      expect(Object.keys(template.values).sort()).toEqual(DESIGN_TEMPLATE_SETTING_IDS);
    }
  });

  it("every id used exists in the base theme's settings_schema.json", () => {
    for (const id of DESIGN_TEMPLATE_SETTING_IDS) {
      expect(ALL_SETTINGS.has(id), `unknown settings_schema.json id: ${id}`).toBe(true);
    }
  });

  it("accent_icons is always one of the setting's declared options", () => {
    const options = (ALL_SETTINGS.get("accent_icons")?.options ?? []).map((o) => o.value);
    expect(options.length).toBeGreaterThan(0);
    for (const template of DESIGN_TEMPLATES) {
      expect(options).toContain(template.values.accent_icons);
    }
  });

  it("numeric values stay within each setting's declared min/max", () => {
    for (const template of DESIGN_TEMPLATES) {
      for (const [id, value] of Object.entries(template.values)) {
        const setting = ALL_SETTINGS.get(id);
        if (typeof value !== "number" || !setting) continue;
        if (typeof setting.min === "number") expect(value).toBeGreaterThanOrEqual(setting.min);
        if (typeof setting.max === "number") expect(value).toBeLessThanOrEqual(setting.max);
      }
    }
  });

  it("color values are hex strings", () => {
    const colorIds = [
      "colors_accent_1",
      "colors_accent_2",
      "colors_background_1",
      "colors_background_2",
      "colors_text",
      "colors_solid_button_labels",
      "colors_outline_button_labels",
    ];
    for (const template of DESIGN_TEMPLATES) {
      for (const id of colorIds) {
        expect(String(template.values[id])).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    }
  });

  it("applying a template merges onto existing themeSettings without dropping unrelated keys", () => {
    const existing: Record<string, unknown> = { some_custom_id: "keep-me", colors_accent_1: "#000000" };
    const template = DESIGN_TEMPLATES[0];
    const next = { ...existing, ...template.values };

    expect(next.some_custom_id).toBe("keep-me");
    expect(next.colors_accent_1).toBe(template.values.colors_accent_1);
  });

  it("matchDesignTemplate recognizes an applied template and honestly reports custom combos", () => {
    for (const template of DESIGN_TEMPLATES) {
      expect(matchDesignTemplate(template.values)).toBe(template.id);
    }
    expect(matchDesignTemplate({})).toBeUndefined();
    // A themeSettings that matches every id but one shouldn't count as a match.
    const almost = { ...DESIGN_TEMPLATES[0].values, colors_accent_1: "#000000" };
    expect(matchDesignTemplate(almost)).not.toBe(DESIGN_TEMPLATES[0].id);
  });

  it("switching between two templates fully supersedes the first template's ids", () => {
    const [first, second] = DESIGN_TEMPLATES;
    const afterFirst = { ...first.values };
    const afterSecond = { ...afterFirst, ...second.values };

    for (const id of DESIGN_TEMPLATE_SETTING_IDS) {
      expect(afterSecond[id]).toBe(second.values[id]);
    }
  });
});
