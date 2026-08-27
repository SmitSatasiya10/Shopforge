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
});
