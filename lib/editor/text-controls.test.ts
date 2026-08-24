import { describe, expect, it } from "vitest";
import { sizeLabel, type SizeControl } from "./text-controls";

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
