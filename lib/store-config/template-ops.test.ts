import { describe, it, expect } from "vitest";
import {
  getBlockAt,
  insertSection,
  moveSection,
  removeBlockAt,
  removeSection,
  setSettingAtPath,
} from "./template-ops";
import type { ShopifySection, ShopifyTemplate } from "@/lib/preview/shopify-template";

const template: ShopifyTemplate = {
  sections: {
    a: { type: "rich-text", settings: {} },
    b: { type: "image-with-text", settings: {} },
    c: { type: "newsletter", settings: {} },
  },
  order: ["a", "b", "c"],
};

const section: ShopifySection = {
  type: "rich-text",
  settings: { heading: "Hello" },
  blocks: {
    outer: {
      type: "container",
      settings: {},
      blocks: { inner: { type: "text", settings: { text: "Deep" } } },
      block_order: ["inner"],
    },
  },
  block_order: ["outer"],
};

describe("moveSection", () => {
  it("moves within order and is a no-op at the edges", () => {
    expect(moveSection(template, "b", 1).order).toEqual(["a", "c", "b"]);
    expect(moveSection(template, "a", -1)).toBe(template);
    expect(moveSection(template, "c", 1)).toBe(template);
    expect(moveSection(template, "missing", 1)).toBe(template);
  });
});

describe("removeSection", () => {
  it("removes the section and its order entry, immutably", () => {
    const next = removeSection(template, "b");
    expect(next.order).toEqual(["a", "c"]);
    expect(next.sections.b).toBeUndefined();
    expect(template.sections.b).toBeDefined();
  });
});

describe("insertSection", () => {
  it("appends a new section and its order entry, immutably, with no afterSectionId", () => {
    const newSection: ShopifySection = { type: "faq", settings: {} };
    const next = insertSection(template, "d", newSection);
    expect(next.order).toEqual(["a", "b", "c", "d"]);
    expect(next.sections.d).toBe(newSection);
    expect(template.sections.d).toBeUndefined();
    expect(template.order).toEqual(["a", "b", "c"]);
  });

  it("falls back to the sections' key order when order is missing", () => {
    const noOrder: ShopifyTemplate = { sections: { a: template.sections.a } };
    const next = insertSection(noOrder, "b", template.sections.b);
    expect(next.order).toEqual(["a", "b"]);
  });

  it("inserts right after afterSectionId", () => {
    const newSection: ShopifySection = { type: "faq", settings: {} };
    const next = insertSection(template, "d", newSection, "a");
    expect(next.order).toEqual(["a", "d", "b", "c"]);
  });

  it("falls back to append-to-end when afterSectionId is not in order", () => {
    const newSection: ShopifySection = { type: "faq", settings: {} };
    const next = insertSection(template, "d", newSection, "missing");
    expect(next.order).toEqual(["a", "b", "c", "d"]);
  });
});

describe("setSettingAtPath / getBlockAt", () => {
  it("writes at section level and nested block level without touching the original", () => {
    const top = setSettingAtPath(section, [], "heading", "New");
    expect(top.settings.heading).toBe("New");
    expect(section.settings.heading).toBe("Hello");

    const deep = setSettingAtPath(section, ["outer", "inner"], "text", "Changed");
    expect(getBlockAt(deep, ["outer", "inner"])?.settings.text).toBe("Changed");
    expect(getBlockAt(section, ["outer", "inner"])?.settings.text).toBe("Deep");
  });

  it("is a no-op for a path that does not exist", () => {
    expect(setSettingAtPath(section, ["nope"], "x", 1)).toBe(section);
    expect(getBlockAt(section, ["nope"])).toBeUndefined();
  });
});

describe("removeBlockAt", () => {
  it("removes a nested block and its order entry", () => {
    const next = removeBlockAt(section, ["outer", "inner"]);
    expect(getBlockAt(next, ["outer", "inner"])).toBeUndefined();
    expect((getBlockAt(next, ["outer"]) as ShopifySection).block_order).toEqual([]);
    expect(getBlockAt(section, ["outer", "inner"])).toBeDefined();
  });
});
