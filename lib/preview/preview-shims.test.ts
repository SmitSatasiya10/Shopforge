import { describe, expect, it } from "vitest";
import { applyPreviewShims } from "./preview-shims";

describe("preview shims", () => {
  it("swaps the theme's no-js class for js, as the theme's own boot script does", () => {
    const html = applyPreviewShims('<!doctype html><html class="no-js" lang="en"><head></head><body></body></html>');
    expect(html).toContain('<html class="js" lang="en">');
    expect(html).not.toContain("no-js");
  });

  it("adds a js class when the theme did not ship a no-js one", () => {
    const html = applyPreviewShims('<html class="gradient"><head></head><body></body></html>');
    expect(html).toContain('class="gradient js"');
  });

  it("injects the reveal stylesheet into head", () => {
    const html = applyPreviewShims("<html><head><title>x</title></head><body></body></html>");
    expect(html).toContain("data-shopforge-preview");
    expect(html.indexOf("data-shopforge-preview")).toBeLessThan(html.indexOf("</head>"));
    expect(html).toContain("opacity: 1 !important");
  });

  it("hides <noscript> fallbacks, which a sandboxed iframe would otherwise render", () => {
    const html = applyPreviewShims("<html><head></head><body></body></html>");
    // The browser treats the iframe as scripting-disabled, so the theme's no-JS slider nav
    // would render as stray "1 2" links beside the real controls.
    expect(html).toContain("noscript");
    expect(html).toMatch(/noscript\s*\{[^}]*display:\s*none/);
  });

  it("pins the first product media slide open", () => {
    const html = applyPreviewShims("<html><head></head><body></body></html>");
    // base.css hides every .product__media-item that lacks .is-active, and the theme's
    // media-gallery element assigns that class on load. With no JS the gallery renders as
    // slider arrows around an empty box while the images sit there fully loaded.
    expect(html).toContain("product__media-item");
    expect(html).toContain("display: block !important");
  });

  it("leaves the rest of the document untouched", () => {
    const html = applyPreviewShims('<html class="no-js"><head></head><body><p>hello</p></body></html>');
    expect(html).toContain("<p>hello</p>");
  });
});
