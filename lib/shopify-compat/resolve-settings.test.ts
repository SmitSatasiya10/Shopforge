import { describe, expect, it } from "vitest";
import { defaultResolveContext, resolveSettings } from "./resolve-settings";
import { ColorDrop, ImageDrop, FontDrop } from "./setting-drops";

const ctx = defaultResolveContext();
const resolve = async (type: string, value: unknown, extra: Record<string, unknown> = {}) =>
  (await resolveSettings({ v: value, ...extra }, [{ id: "v", type }], ctx)).v;

describe("typed setting resolution", () => {
  it("turns a color setting into a Color object with rgb components", async () => {
    const color = (await resolve("color", "#e85d04")) as ColorDrop;
    expect(color).toBeInstanceOf(ColorDrop);
    // The theme writes `--color-background: {{ x.red }}, {{ x.green }}, {{ x.blue }}`;
    // an unresolved string yields `, , ` and every colour in the page breaks.
    expect(color.red).toBe(232);
    expect(color.green).toBe(93);
    expect(color.blue).toBe(4);
    expect(color.valueOf()).toBe("#e85d04");
  });

  it("parses rgba and shorthand hex colors", async () => {
    expect(((await resolve("color", "rgba(255, 0, 0, 0.5)")) as ColorDrop).red).toBe(255);
    expect(((await resolve("color", "#fff")) as ColorDrop).blue).toBe(255);
  });

  it("turns an image_picker into an Image object and rewrites shopify:// uploads", async () => {
    const image = (await resolve("image_picker", "shopify://shop_images/Jane_Doe.png")) as ImageDrop;
    expect(image).toBeInstanceOf(ImageDrop);
    expect(image.src).toBe("/base-theme/images/Jane_Doe.png");
    // No readBinary in this context (and no such file on disk) — the theme divides by
    // aspect_ratio to compute logo height; undefined would give 0, so it must still default to 1.
    expect(image.aspect_ratio).toBe(1);
  });

  it("resolves a link_list handle to a menu with links", async () => {
    const menu = (await resolve("link_list", "main-menu")) as { links: { title: string }[] };
    expect(menu.links.map((l) => l.title)).toEqual(["Home", "Catalog", "Contact"]);
  });

  it("returns an empty menu for a handle the store does not have", async () => {
    expect(((await resolve("link_list", "nope")) as { links: unknown[] }).links).toEqual([]);
  });

  it("turns a font_picker handle into a font object", async () => {
    const font = (await resolve("font_picker", "assistant_n4")) as FontDrop;
    expect(font.family).toBe("assistant");
    expect(font.weight).toBe(400);
    expect(font.style).toBe("normal");
  });

  it("resolves objects with no store behind them to null so `if` guards take the empty branch", async () => {
    expect(await resolve("product", "some-handle")).toBeNull();
    expect(await resolve("collection", "some-handle")).toBeNull();
  });

  it("keeps an unset setting falsy so `!= blank` guards work", async () => {
    expect(await resolve("image_picker", "")).toBe("");
    expect(await resolve("color", "")).toBe("");
    expect(await resolve("checkbox", undefined)).toBe(false);
  });

  it("falls back to the schema default when the template omits a setting", async () => {
    const resolved = await resolveSettings({}, [{ id: "heading", type: "text", default: "Hello" }], ctx);
    expect(resolved.heading).toBe("Hello");
  });

  it("passes through types that need no resolution", async () => {
    expect(await resolve("text", "Just text")).toBe("Just text");
    expect(await resolve("range", 40)).toBe(40);
    expect(await resolve("color_background", "linear-gradient(90deg, #fff, #000)")).toContain("linear-gradient");
  });

  it("keeps settings the schema does not declare", async () => {
    const resolved = await resolveSettings({ custom: "kept" }, [{ id: "v", type: "text" }], ctx);
    expect(resolved.custom).toBe("kept");
  });
});
