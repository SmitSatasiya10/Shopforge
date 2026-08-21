import { describe, expect, it } from "vitest";
import { normalizeRenderTagArgs } from "./render-args";

describe("normalizeRenderTagArgs", () => {
  it("rewrites a bare trailing argument to the explicit form", () => {
    expect(
      normalizeRenderTagArgs(`{% render 'product-media-gallery', variant_images: variant_images, section %}`),
    ).toBe(`{% render 'product-media-gallery', variant_images: variant_images, section: section %}`);
  });

  it("rewrites a bare argument in a multiline render tag", () => {
    const source = `{%\n  render 'product-thumbnail',\n  media: media,\n  lazy_load: false,\n  section\n%}`;
    expect(normalizeRenderTagArgs(source)).toBe(
      `{%\n  render 'product-thumbnail',\n  media: media,\n  lazy_load: false,\n  section: section\n%}`,
    );
  });

  it("leaves key: value arguments, quoted commas, and with/as clauses untouched", () => {
    const untouched = [
      `{% render 'x' %}`,
      `{% render 'x', key: value %}`,
      `{% render 'x', widths: '54, 74, 104' %}`,
      `{% render 'x' with collection.products as product %}`,
      `{%- render 'icon-close' -%}`,
    ];
    for (const source of untouched) {
      expect(normalizeRenderTagArgs(source)).toBe(source);
    }
  });

  it("handles multiple bare arguments and preserves surrounding whitespace", () => {
    expect(normalizeRenderTagArgs(`{% render 'x', section, product %}`)).toBe(
      `{% render 'x', section: section, product: product %}`,
    );
  });

  it("does not touch render tags outside of, or text between, tags", () => {
    const source = `before {% render 'a', section %} middle {% render 'b', k: v %} after`;
    expect(normalizeRenderTagArgs(source)).toBe(
      `before {% render 'a', section: section %} middle {% render 'b', k: v %} after`,
    );
  });
});
