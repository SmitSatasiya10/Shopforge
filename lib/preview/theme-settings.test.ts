import { describe, expect, it } from "vitest";
import { currentSettings, mergeThemeSettings, schemaDefaults, loadThemeSettings } from "./theme-settings";
import { createFsTemplateReader } from "./fs-template-reader";

describe("theme settings resolution", () => {
  it("falls back to schema defaults for settings the merchant never changed", () => {
    const merged = mergeThemeSettings(
      { current: { page_width: 1200 } },
      [{ name: "Typography", settings: [{ id: "body_scale", default: 100 }, { id: "page_width", default: 1400 }] }],
    );
    expect(merged.body_scale).toBe(100); // from the schema
    expect(merged.page_width).toBe(1200); // merchant value wins
  });

  it("resolves `current` when it names a preset instead of holding settings", () => {
    const settings = currentSettings({
      current: "Default",
      presets: { Default: { page_width: 1600 }, Wide: { page_width: 1800 } },
    });
    expect(settings).toEqual({ page_width: 1600 });
  });

  it("ignores schema entries that declare no default", () => {
    expect(schemaDefaults([{ settings: [{ id: "a" }, { id: "b", default: 2 }] }])).toEqual({ b: 2 });
  });

  it("resolves the real theme's body_scale to a usable positive number", async () => {
    const settings = await loadThemeSettings(createFsTemplateReader());
    // The blank-preview bug: if this ever resolved to undefined/0, the layout's
    // `| divided_by: 100.0` would yield 0 and the root font-size would compute to 0px —
    // collapsing every rem-based dimension in the theme to zero. Whether the real theme's own
    // settings_data.json sets body_scale explicitly or omits it (falling back to the schema
    // default) is an implementation detail this test doesn't pin down — either way the
    // resolved value must be a real, positive number.
    expect(typeof settings.body_scale).toBe("number");
    expect(settings.body_scale).toBeGreaterThan(0);
    expect(settings.page_width).toBeDefined();
  });
});
