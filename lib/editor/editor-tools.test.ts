import { describe, it, expect } from "vitest";
import { applyMagicBrush, cycleColorScheme, PALETTES, rollPalette } from "./magic-brush";
import { locateBlockPathByType, locateTextSetting, normalizeText } from "./setting-locator";
import { applyAlign, findTextControls, stepSize, applyColor } from "./text-controls";
import type { ShopifySection } from "@/lib/preview/shopify-template";
import type { ShopifySectionSchema } from "@/lib/preview/section-schema";

// The three pure pieces behind the editor toolbars (docs/EDITOR-TOOLBARS.md).

describe("rollPalette", () => {
  it("never repeats the previous palette", () => {
    for (let previous = 0; previous < PALETTES.length; previous++) {
      for (let i = 0; i < 20; i++) expect(rollPalette(previous)).not.toBe(previous);
    }
  });
});

describe("applyMagicBrush", () => {
  const palette = PALETTES[0];

  it("writes the theme's custom color settings and flips color_scheme to custom", () => {
    const schema: ShopifySectionSchema = {
      settings: [
        { type: "select", id: "color_scheme", options: [{ value: "background-1", label: "" }, { value: "custom", label: "" }] },
        { type: "color", id: "custom_colors_background" },
        { type: "color", id: "custom_colors_text" },
      ],
    };
    const section: ShopifySection = { type: "rich-text", settings: { color_scheme: "background-1" } };
    const next = applyMagicBrush(section, schema, palette);
    expect(next.settings.color_scheme).toBe("custom");
    expect(next.settings.custom_colors_background).toBe(palette.background);
    expect(next.settings.custom_colors_text).toBe(palette.text);
  });

  it("brushes blocks that hold the colors (slideshow slides) and no-ops otherwise", () => {
    const schema: ShopifySectionSchema = {
      settings: [],
      blocks: [
        {
          type: "slide",
          settings: [
            { type: "select", id: "color_scheme", options: [{ value: "custom", label: "" }] },
            { type: "color", id: "custom_colors_background" },
          ],
        },
      ],
    };
    const section: ShopifySection = {
      type: "slideshow",
      settings: {},
      blocks: { s1: { type: "slide", settings: {} }, s2: { type: "slide", settings: {} } },
      block_order: ["s1", "s2"],
    };
    const next = applyMagicBrush(section, schema, palette);
    expect(next.blocks!.s1.settings.custom_colors_background).toBe(palette.background);
    expect(next.blocks!.s2.settings.color_scheme).toBe("custom");

    const plain: ShopifySection = { type: "divider", settings: {} };
    expect(applyMagicBrush(plain, { settings: [] }, palette)).toBe(plain);
  });
});

describe("cycleColorScheme", () => {
  // Sections like main-product declare only a theme-scheme select, no custom colors.
  const schema: ShopifySectionSchema = {
    settings: [
      {
        type: "select",
        id: "color_scheme",
        default: "background-1",
        options: [
          { value: "accent-1", label: "Accent 1" },
          { value: "background-1", label: "Background 1" },
          { value: "custom", label: "Custom" },
        ],
      },
    ],
  };

  it("steps to the next scheme, skipping custom and wrapping around", () => {
    const section: ShopifySection = { type: "main-product", settings: { color_scheme: "accent-1" } };
    const first = cycleColorScheme(section, schema)!;
    expect(first.section.settings.color_scheme).toBe("background-1");
    expect(first.label).toBe("Background 1");
    const second = cycleColorScheme(first.section, schema)!;
    expect(second.section.settings.color_scheme).toBe("accent-1");
  });

  it("falls back to the schema default when the setting is unset", () => {
    const section: ShopifySection = { type: "main-product", settings: {} };
    expect(cycleColorScheme(section, schema)!.section.settings.color_scheme).toBe("accent-1");
  });

  it("returns null without a usable scheme select", () => {
    const plain: ShopifySection = { type: "divider", settings: {} };
    expect(cycleColorScheme(plain, { settings: [] })).toBeNull();
    expect(cycleColorScheme(plain, null)).toBeNull();
    const onlyCustom: ShopifySectionSchema = {
      settings: [{ type: "select", id: "color_scheme", options: [{ value: "custom", label: "Custom" }] }],
    };
    expect(cycleColorScheme(plain, onlyCustom)).toBeNull();
  });
});

describe("locateTextSetting", () => {
  const section: ShopifySection = {
    type: "rich-text",
    settings: { heading: "<p>Travel in <strong>Style</strong></p>" },
    blocks: {
      b1: { type: "text", settings: { text: "Is this bag carry-on friendly?" } },
      b2: { type: "text", settings: { text: "Duplicate" } },
      b3: { type: "text", settings: { text: "Duplicate" } },
    },
  };

  it("binds rendered text to its setting, through tags and whitespace", () => {
    expect(locateTextSetting(section, "Travel in  Style")).toEqual({ blockPath: [], settingId: "heading" });
    expect(locateTextSetting(section, "Is this bag carry-on friendly?")).toEqual({
      blockPath: ["b1"],
      settingId: "text",
    });
  });

  it("refuses ambiguous and unknown text", () => {
    expect(locateTextSetting(section, "Duplicate")).toBeNull();
    expect(locateTextSetting(section, "Add to cart")).toBeNull();
    expect(locateTextSetting(section, "")).toBeNull();
  });

  it("normalises entities the way richtext renders them", () => {
    expect(normalizeText("Home &amp; Kitchen")).toBe("Home & Kitchen");
  });
});

describe("locateBlockPathByType", () => {
  it("finds the unique product_title block, even nested, and refuses duplicates", () => {
    const section: ShopifySection = {
      type: "main-product",
      settings: {},
      blocks: {
        c1: {
          type: "container",
          settings: {},
          blocks: { t1: { type: "product_title", settings: {} } },
        },
        b2: { type: "product_description", settings: {} },
      },
    };
    expect(locateBlockPathByType(section, "product_title")).toEqual(["c1", "t1"]);
    expect(locateBlockPathByType(section, "heading")).toBeNull();

    const doubled: ShopifySection = {
      type: "main-product",
      settings: {},
      blocks: {
        a: { type: "product_title", settings: {} },
        b: { type: "product_title", settings: {} },
      },
    };
    expect(locateBlockPathByType(doubled, "product_title")).toBeNull();
  });
});

describe("findTextControls / stepSize / applyColor", () => {
  it("finds the heading block's select size and gated color", () => {
    const controls = findTextControls([
      { type: "select", id: "heading_size", options: ["h3", "h2", "h1", "h0", "custom"].map((v) => ({ value: v, label: v })) },
      { type: "number", id: "custom_desktop_size" },
      { type: "checkbox", id: "enable_custom_color" },
      { type: "color", id: "custom_color" },
    ]);
    expect(controls.size).toMatchObject({ kind: "select", settingId: "heading_size", options: ["h3", "h2", "h1", "h0"] });
    expect(controls.color).toEqual({ settingId: "custom_color", enableId: "enable_custom_color", companionIds: [] });
    expect(controls.weight).toBeUndefined();

    expect(stepSize(controls.size!, "h2", 1)).toEqual({ heading_size: "h1" });
    expect(stepSize(controls.size!, "h0", 1)).toBeNull();
    expect(applyColor(controls.color!, "#ff0000")).toEqual({ custom_color: "#ff0000", enable_custom_color: true });
  });

  it("moves the strong/em highlight colors with the picked color", () => {
    // The theme styles <strong> inside a heading with the highlight color, and that rule
    // beats the inherited custom color — a title wrapped entirely in <strong> ("<strong>Hurry!
    // Sale Ends Soon</strong>") would ignore the picked color if the highlight stayed behind.
    const controls = findTextControls([
      { type: "checkbox", id: "enable_custom_color" },
      { type: "color", id: "custom_color" },
      { type: "color", id: "title_highlight_1_color" },
      // Gradient mode paints the text via background-clip with a transparent fill, so the
      // gradient variable must carry the picked color too (a flat hex is a valid background).
      { type: "color_background", id: "title_highlight_1_gradient" },
      { type: "color", id: "title_highlight_2_color" },
      { type: "color", id: "highlighted-1_border_color" },
    ]);
    expect(controls.color!.companionIds).toEqual([
      "title_highlight_1_color",
      "title_highlight_1_gradient",
      "title_highlight_2_color",
    ]);
    expect(applyColor(controls.color!, "#213778")).toEqual({
      custom_color: "#213778",
      enable_custom_color: true,
      title_highlight_1_color: "#213778",
      title_highlight_1_gradient: "#213778",
      title_highlight_2_color: "#213778",
    });
  });

  it("finds the alignment selects and moves mobile in step by option index", () => {
    const controls = findTextControls([
      {
        type: "select",
        id: "alignment",
        options: ["left", "center", "right"].map((v) => ({ value: v, label: v })),
      },
      {
        type: "select",
        id: "mobile_alignment",
        options: ["mobile-left", "mobile-center", "mobile-right"].map((v) => ({ value: v, label: v })),
      },
    ]);
    expect(controls.align).toEqual({
      settingId: "alignment",
      options: ["left", "center", "right"],
      mobileId: "mobile_alignment",
      mobileOptions: ["mobile-left", "mobile-center", "mobile-right"],
    });
    expect(applyAlign(controls.align!, "center")).toEqual({
      alignment: "center",
      mobile_alignment: "mobile-center",
    });

    const desktopOnly = findTextControls([
      { type: "select", id: "alignment", options: [{ value: "left", label: "" }, { value: "right", label: "" }] },
    ]);
    expect(applyAlign(desktopOnly.align!, "right")).toEqual({ alignment: "right" });
  });

  it("finds the text block's range size, skipping mobile variants", () => {
    const controls = findTextControls([
      { type: "range", id: "text_size", min: 8, max: 40, step: 1, default: 14 },
      { type: "range", id: "text_size_mobile" },
    ]);
    expect(controls.size).toMatchObject({ kind: "range", settingId: "text_size" });
    expect(stepSize(controls.size!, 14, 1)).toEqual({ text_size: 15 });
    expect(stepSize(controls.size!, 40, 1)).toBeNull();
  });
});
