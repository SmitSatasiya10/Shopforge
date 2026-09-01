import { describe, expect, it } from "vitest";
import { findTextControls, sizeLabel, type SizeControl } from "./text-controls";
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

  it("keeps the lone match regardless of which field is selected when there's no ambiguity", () => {
    // Real-world case (results.liquid): the section has one size-ish setting, "heading_size",
    // and it's the only candidate — scoping only kicks in once a *second* candidate exists, so
    // this stays exactly what a plain `.find()` returned before `ownerId` existed.
    const defs: ShopifySettingDef[] = [
      { id: "title", type: "inline_richtext" },
      { id: "heading_size", type: "select", options: [{ value: "h3", label: "Small" }] },
      { id: "text", type: "richtext" },
    ];
    expect(findTextControls(defs, "title").size?.settingId).toBe("heading_size");
    expect(findTextControls(defs, "text").size?.settingId).toBe("heading_size");
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
