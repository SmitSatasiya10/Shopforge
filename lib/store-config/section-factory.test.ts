import { describe, it, expect } from "vitest";
import { createSectionInstance, generateInstanceId } from "./section-factory";
import type { ShopifySectionSchema } from "@/lib/preview/section-schema";

const richTextSchema: ShopifySectionSchema = {
  name: "Rich text",
  settings: [
    { id: "heading_note", type: "header", label: "Layout" },
    { id: "visibility", type: "select", default: "always-display" },
    { id: "full_width", type: "checkbox", default: true },
    { id: "no_default", type: "text" },
  ],
  presets: [{ name: "Rich text", blocks: [{ type: "heading" }, { type: "text" }] }],
};

const headingBlockSchema: ShopifySectionSchema = {
  name: "Heading",
  settings: [{ id: "heading", type: "text", default: "Talk about your brand" }],
};

describe("createSectionInstance", () => {
  it("copies default settings and skips presentational/undefaulted ones", () => {
    const section = createSectionInstance("rich-text", richTextSchema, new Map());
    expect(section.type).toBe("rich-text");
    expect(section.settings).toEqual({ visibility: "always-display", full_width: true });
  });

  it("creates preset blocks with unique ids and their own default settings", () => {
    const blockSchemas = new Map([
      ["heading", headingBlockSchema],
      ["text", null],
    ]);
    const section = createSectionInstance("rich-text", richTextSchema, blockSchemas);
    expect(section.block_order).toHaveLength(2);
    const [headingId, textId] = section.block_order!;
    expect(headingId).not.toBe(textId);
    expect(section.blocks![headingId]).toEqual({
      type: "heading",
      settings: { heading: "Talk about your brand" },
    });
    expect(section.blocks![textId]).toEqual({ type: "text", settings: {} });
  });

  it("produces a blockless section when the schema has no presets", () => {
    const noPresets: ShopifySectionSchema = { name: "Main product", settings: [] };
    const section = createSectionInstance("main-product", noPresets, new Map());
    expect(section.blocks).toBeUndefined();
    expect(section.block_order).toBeUndefined();
  });

  it("never mutates the input schema", () => {
    const before = JSON.stringify(richTextSchema);
    createSectionInstance("rich-text", richTextSchema, new Map([["heading", headingBlockSchema]]));
    expect(JSON.stringify(richTextSchema)).toBe(before);
  });
});

describe("generateInstanceId", () => {
  it("prefixes the type and generates distinct ids", () => {
    const a = generateInstanceId("hero");
    const b = generateInstanceId("hero");
    expect(a).toMatch(/^hero-/);
    expect(a).not.toBe(b);
  });
});
