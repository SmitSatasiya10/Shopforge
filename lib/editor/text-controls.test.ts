import { describe, expect, it } from "vitest";
import { findTextControls, sizeLabel, sizeSettingFor, stepSize, type SizeControl } from "./text-controls";
import type { ShopifySettingDef } from "@/lib/preview/section-schema";

describe("sizeLabel", () => {
  it("maps a select control's 4 ascending options onto XS/S/M/L", () => {
    // This theme's actual heading_size options once "custom" is filtered out (Extra small,
    // Small, Medium, Large -> h3, h2, h1, h0).
    const control: SizeControl = { kind: "select", settingId: "heading_size", options: ["h3", "h2", "h1", "h0"] };
    expect(sizeLabel(control, "h3")).toBe("XS");
    expect(sizeLabel(control, "h2")).toBe("S");
    expect(sizeLabel(control, "h1")).toBe("M");
    expect(sizeLabel(control, "h0")).toBe("L");
  });

  it("falls back to the raw value for a select option outside the scale", () => {
    const control: SizeControl = { kind: "select", settingId: "size", options: ["a"] };
    expect(sizeLabel(control, "unknown")).toBe("unknown");
    expect(sizeLabel(control, undefined)).toBe("–");
  });

  it("buckets a range control's continuous domain into the same scale", () => {
    const control: SizeControl = { kind: "range", settingId: "desktop_size", min: 24, max: 60 };
    expect(sizeLabel(control, 24)).toBe("XS");
    expect(sizeLabel(control, 60)).toBe("XXXL");
    expect(sizeLabel(control, 33)).toBe("M"); // a quarter of the way up a 7-item scale
  });

  it("falls back to the raw value for a degenerate range", () => {
    const control: SizeControl = { kind: "range", settingId: "size", min: 10, max: 10 };
    expect(sizeLabel(control, 10)).toBe("10");
  });
});

describe("per-viewport sizing", () => {
  // blocks/product_title.liquid: the <h1> is sized from desktop_size, then re-sized from
  // mobile_size inside `@media (max-width: 749px)`. Both are unconditional ranges.
  const productTitleDefs: ShopifySettingDef[] = [
    { id: "uppercase_title", type: "checkbox" },
    { id: "desktop_size", type: "range", min: 24, max: 60, step: 3, default: 39 },
    { id: "alignment", type: "select", options: [{ value: "left", label: "Left" }, { value: "center", label: "Center" }] },
    { id: "mobile_size", type: "range", min: 20, max: 50, step: 2, default: 28 },
    { id: "mobile_alignment", type: "select", options: [{ value: "mobile-left", label: "Left" }, { value: "mobile-center", label: "Center" }] },
  ];

  it("pairs a block's desktop and mobile size settings", () => {
    const controls = findTextControls(productTitleDefs);
    expect(controls.size?.settingId).toBe("desktop_size");
    expect(controls.size?.mobile?.settingId).toBe("mobile_size");
    // Each half keeps its own domain — the mobile slider stops at 50, not the desktop 60.
    expect(controls.size?.mobile?.max).toBe(50);
    expect(controls.size?.mobile?.step).toBe(2);
  });

  it("steps the setting the previewed viewport actually renders", () => {
    // The bug: with the mobile preview on, the toolbar wrote desktop_size, whose declaration
    // the theme's max-width media query overrides — so the product title never moved.
    const size = findTextControls(productTitleDefs)!.size!;
    expect(stepSize(sizeSettingFor(size, "desktop"), 39, 1)).toEqual({ desktop_size: 42 });
    expect(stepSize(sizeSettingFor(size, "mobile"), 28, 1)).toEqual({ mobile_size: 30 });
    expect(stepSize(sizeSettingFor(size, "mobile"), 28, -1)).toEqual({ mobile_size: 26 });
    // Each half stops at its own bounds.
    expect(stepSize(sizeSettingFor(size, "mobile"), 50, 1)).toBeNull();
  });

  it("falls back to the single size setting when a block declares no mobile one", () => {
    const defs: ShopifySettingDef[] = [
      { id: "title", type: "inline_richtext" },
      { id: "heading_size", type: "range", min: 24, max: 60 },
    ];
    const size = findTextControls(defs, "title")!.size!;
    expect(size.mobile).toBeUndefined();
    expect(sizeSettingFor(size, "mobile").settingId).toBe("heading_size");
  });

  it("does not pair a conditional custom-size number with the block's size select", () => {
    // blocks/heading.liquid: custom_mobile_size applies only while heading_size == "custom".
    // In every other mode the h0→h3 classes are responsive and the select governs mobile too,
    // so stepping size on a phone must keep moving the select, not that gated number.
    const headingDefs: ShopifySettingDef[] = [
      { id: "title", type: "inline_richtext" },
      { id: "heading_size", type: "select", options: [{ value: "h2", label: "Small" }, { value: "h1", label: "Medium" }, { value: "custom", label: "Custom" }] },
      { id: "custom_desktop_size", type: "number", default: 39, visible_if: "{{ block.settings.heading_size == 'custom' }}" },
      { id: "custom_mobile_size", type: "number", default: 28, visible_if: "{{ block.settings.heading_size == 'custom' }}" },
    ];
    const size = findTextControls(headingDefs, "title")!.size!;
    expect(size.settingId).toBe("heading_size");
    expect(size.mobile).toBeUndefined();
  });

  it("does not lend one field's mobile size to another field that has none", () => {
    // product_tabs declares tab_text_size/tab_text_size_mobile for the BUTTON labels and only
    // content_size for a tab's body copy — the body must not adopt the buttons' mobile setting.
    const defs: ShopifySettingDef[] = [
      { id: "tab_text_size", type: "range", min: 10, max: 30 },
      { id: "tab_text_size_mobile", type: "range", min: 10, max: 30 },
      { id: "content_size", type: "range", min: 10, max: 30 },
      { id: "tab_1_title", type: "text" },
      { id: "tab_1_content", type: "richtext" },
    ];
    const content = findTextControls(defs, "tab_1_content")!.size!;
    expect(content.settingId).toBe("content_size");
    expect(content.mobile).toBeUndefined();
    // The button label, which really does own the pair, still gets it.
    const label = findTextControls(defs, "tab_1_title")!.size!;
    expect(label.settingId).toBe("tab_text_size");
    expect(label.mobile?.settingId).toBe("tab_text_size_mobile");
  });
});

describe("findTextControls", () => {
  // A section with two independently-bound heading fields, each with its own alignment/size
  // — e.g. an eyebrow/kicker plus a main heading, both section-level settings.
  const twoHeadingDefs: ShopifySettingDef[] = [
    { id: "eyebrow", type: "inline_richtext" },
    { id: "eyebrow_alignment", type: "select", options: [{ value: "left", label: "Left" }, { value: "center", label: "Center" }] },
    { id: "eyebrow_size", type: "range", min: 10, max: 20 },
    { id: "heading", type: "inline_richtext" },
    { id: "heading_alignment", type: "select", options: [{ value: "left", label: "Left" }, { value: "right", label: "Right" }] },
    { id: "heading_size", type: "range", min: 24, max: 60 },
  ];

  it("scopes an ambiguous control to the field that was actually clicked", () => {
    const eyebrowControls = findTextControls(twoHeadingDefs, "eyebrow");
    expect(eyebrowControls.align?.settingId).toBe("eyebrow_alignment");
    expect(eyebrowControls.size?.settingId).toBe("eyebrow_size");

    const headingControls = findTextControls(twoHeadingDefs, "heading");
    expect(headingControls.align?.settingId).toBe("heading_alignment");
    expect(headingControls.size?.settingId).toBe("heading_size");
  });

  it("falls back to the first match when no owner is given (unchanged behavior)", () => {
    const controls = findTextControls(twoHeadingDefs);
    expect(controls.align?.settingId).toBe("eyebrow_alignment");
    expect(controls.size?.settingId).toBe("eyebrow_size");
  });

  it("keeps a lone match for the field it is declared under, but not for an unrelated one", () => {
    // Real-world case (results.liquid): "heading_size" styles the section's `title` — it is
    // read by the section-title snippet — while `text` renders into a bare `.rte` div with no
    // size setting of its own. Being the schema's only size-ish candidate used to be enough to
    // hand it to whichever field was selected, so stepping the description's size silently
    // resized the title. `title` still gets it (the setting sits in its zone); `text` now gets
    // no size control instead of the wrong one.
    const defs: ShopifySettingDef[] = [
      { id: "title", type: "inline_richtext" },
      { id: "heading_size", type: "select", options: [{ value: "h3", label: "Small" }] },
      { id: "text", type: "richtext" },
    ];
    expect(findTextControls(defs, "title").size?.settingId).toBe("heading_size");
    expect(findTextControls(defs, "text").size).toBeUndefined();
  });

  // Shape of blocks/product_tabs.liquid ("Content tabs"), trimmed to the settings that matter.
  // Its per-tab body copy (tab_1_content) is styled by `content_size` and `content_text_color`,
  // both declared ABOVE the field — while `tab_text_size`/`tab_text_color` style the tab
  // buttons and `button_alignment` positions the button row.
  const tabsDefs: ShopifySettingDef[] = [
    { id: "tab_text_size", type: "range", min: 10, max: 30 },
    { id: "tab_text_size_mobile", type: "range", min: 10, max: 30 },
    { id: "button_alignment", type: "select", options: [{ value: "left", label: "Left" }, { value: "center", label: "Center" }] },
    { id: "content_size", type: "range", min: 10, max: 30 },
    { id: "tab_text_color", type: "color" },
    { id: "active_tab_color", type: "color" },
    { id: "divider_color", type: "color" },
    { id: "active_indicator_color", type: "color" },
    { id: "content_text_color", type: "color" },
    { id: "tab_1_title", type: "text" },
    { id: "tab_1_content", type: "richtext" },
    { id: "tab_2_title", type: "text" },
    { id: "tab_2_content", type: "richtext" },
  ];

  it("binds a tab's body copy to the content_* settings declared above it", () => {
    // Fix 1 (the color id is `content_text_color`, not one of the four canonical ids) and
    // fix 2 (both settings sit *before* the field, so a forward-only zone never sees them).
    const controls = findTextControls(tabsDefs, "tab_1_content");
    expect(controls.color?.settingId).toBe("content_text_color");
    expect(controls.size?.settingId).toBe("content_size");
    expect(controls.size?.kind).toBe("range");
  });

  it("binds a tab's button label to the tab_* settings rather than the content ones", () => {
    // Same schema, different field: the owner's own words decide which of the two competing
    // `*_text_color` / `*_size` pairs wins, so the tab button resolves to its own settings.
    const controls = findTextControls(tabsDefs, "tab_1_title");
    expect(controls.color?.settingId).toBe("tab_text_color");
    expect(controls.size?.settingId).toBe("tab_text_size");
  });

  it("refuses the tab button row's alignment as the alignment of a tab's body copy", () => {
    // Fix 3: `button_alignment` is the schema's ONLY align-ish match, so the old single-match
    // shortcut handed it to whatever text was selected — clicking align on a tab's paragraph
    // moved the tab buttons instead. "button" is a qualifier tab_1_content doesn't share, and
    // it sits outside the field's zone, so no alignment control is offered at all.
    expect(findTextControls(tabsDefs, "tab_1_content").align).toBeUndefined();
    // Refused for the tab label too, and deliberately: it aligns the button ROW container,
    // which is neither text field, so no inline selection should claim it. It stays reachable
    // where it belongs — the block's own settings panel.
    expect(findTextControls(tabsDefs, "tab_1_title").align).toBeUndefined();
  });

  it("never offers a decoration color as the text color", () => {
    // The text block's <strong>/<em> treatments end in `_text_color` too, but they paint a
    // span inside the copy, not the copy itself — only custom_text_color may win.
    const textBlockDefs: ShopifySettingDef[] = [
      { id: "text", type: "richtext" },
      { id: "enable_custom_color", type: "checkbox" },
      { id: "custom_text_color", type: "color" },
      { id: "bold_bg_text_color", type: "color" },
      { id: "italic_bg_text_color", type: "color" },
      { id: "highlight_color", type: "color" },
      { id: "highlighter_underline_color", type: "color" },
    ];
    const controls = findTextControls(textBlockDefs, "text");
    expect(controls.color?.settingId).toBe("custom_text_color");
    expect(controls.color?.enableId).toBe("enable_custom_color");
  });

  it("regression: a content field whose size setting is declared before it gets no size control, instead of stealing another field's setting", () => {
    // Shape of slideshow-hero.liquid's slide block: heading_size sits between heading and
    // heading_suffix, and heading_prefix_size sits between heading_suffix and text — so text's
    // forward-only zone [text, button_label_1) contains neither. Previously `pick()` fell back
    // to the first size match anywhere in the schema (heading_size), so stepping the
    // description's font size silently resized the heading instead. It should now resolve to
    // no size control at all rather than guessing wrong.
    const slideDefs: ShopifySettingDef[] = [
      { id: "heading_prefix", type: "text" },
      { id: "heading", type: "text" },
      { id: "title_highlight_color", type: "color" },
      { id: "heading_size", type: "select", options: [{ value: "h2", label: "Medium" }, { value: "h1", label: "Large" }] },
      { id: "heading_suffix", type: "text" },
      { id: "heading_prefix_size", type: "select", options: [{ value: "h4", label: "Small" }, { value: "h3", label: "Medium" }] },
      { id: "text", type: "richtext" },
      { id: "button_label_1", type: "text" },
    ];
    expect(findTextControls(slideDefs, "text").size).toBeUndefined();
    // The heading itself still correctly resolves to its own size setting.
    expect(findTextControls(slideDefs, "heading").size?.settingId).toBe("heading_size");
    expect(findTextControls(slideDefs, "heading_suffix").size?.settingId).toBe("heading_prefix_size");
  });

  it("regression: a genuinely in-scope range setting isn't shadowed by an out-of-scope select that happens to be the schema's only select", () => {
    // Shape of parallax-hero.liquid's content block: heading_prefix_size (select) belongs to
    // heading_prefix/heading_suffix, while heading has its own heading_size (range) declared
    // right after it. Because heading_prefix_size is the ONLY select-type size match in the
    // whole schema, `pick()`'s single-match shortcut used to return it unconditionally — and
    // findTextControls checked the select result before ever considering the range — so
    // selecting the heading always resolved to the prefix's select control instead of its own,
    // correctly-scoped range.
    const parallaxDefs: ShopifySettingDef[] = [
      { id: "heading_prefix", type: "text" },
      { id: "heading", type: "text" },
      { id: "heading_size", type: "range", min: 24, max: 60 },
      { id: "heading_suffix", type: "text" },
      { id: "heading_prefix_size", type: "select", options: [{ value: "h4", label: "Small" }, { value: "h3", label: "Medium" }] },
      { id: "text", type: "richtext" },
    ];
    expect(findTextControls(parallaxDefs, "heading").size?.settingId).toBe("heading_size");
    expect(findTextControls(parallaxDefs, "heading").size?.kind).toBe("range");
    // heading_prefix_size sits between heading_suffix and text, so it's in heading_suffix's
    // zone (not heading_prefix's, which has no companion setting of its own at all).
    expect(findTextControls(parallaxDefs, "heading_suffix").size?.settingId).toBe("heading_prefix_size");
  });
});
