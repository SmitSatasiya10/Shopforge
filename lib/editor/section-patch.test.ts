// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { trySwapSections } from "@/lib/editor/section-patch";

const section = (id: string, inner = "") =>
  `<div class="shopify-section" data-sf-section-id="${id}" data-sf-section-type="t-${id}">${inner}</div>`;

const page = (...sections: string[]) =>
  `<!doctype html><html><head><title>t</title></head><body><header>h</header>\n<main>\n${sections.join("\n")}\n</main>\n<footer>f</footer></body></html>`;

/** A live preview document, as the iframe would hold it. */
function liveDoc(html: string): Document {
  const doc = new DOMParser().parseFromString(html, "text/html");
  // The editor injects this into the live document only; it must not defeat the head compare.
  const style = doc.createElement("style");
  style.id = "sf-editor-styles";
  doc.head.appendChild(style);
  return doc;
}

const ids = (doc: Document) =>
  Array.from(doc.querySelectorAll("[data-sf-section-id]")).map((el) => el.getAttribute("data-sf-section-id"));

describe("trySwapSections", () => {
  it("reorders sections by moving the live nodes instead of rebuilding them", () => {
    const doc = liveDoc(page(section("a", "<img src='a.png'>"), section("b"), section("c")));
    const movedImg = doc.querySelector("img");

    expect(trySwapSections(doc, page(section("c"), section("a", "<img src='a.png'>"), section("b")))).toBe(true);
    expect(ids(doc)).toEqual(["c", "a", "b"]);
    // Same element object: a moved section keeps its decoded media and its selection state.
    expect(doc.querySelector("img")).toBe(movedImg);
  });

  it("keeps the live element identity of a section moved to the end", () => {
    const doc = liveDoc(page(section("a"), section("b"), section("c")));
    const a = doc.querySelector('[data-sf-section-id="a"]');

    expect(trySwapSections(doc, page(section("b"), section("c"), section("a")))).toBe(true);
    expect(ids(doc)).toEqual(["b", "c", "a"]);
    expect(doc.querySelector('[data-sf-section-id="a"]')).toBe(a);
  });

  it("inserts an added section without touching its neighbours", () => {
    const doc = liveDoc(page(section("a"), section("b")));
    const b = doc.querySelector('[data-sf-section-id="b"]');

    expect(trySwapSections(doc, page(section("a"), section("new"), section("b")))).toBe(true);
    expect(ids(doc)).toEqual(["a", "new", "b"]);
    expect(doc.querySelector('[data-sf-section-id="b"]')).toBe(b);
  });

  it("appends a section added at the end of the page", () => {
    const doc = liveDoc(page(section("a"), section("b")));

    expect(trySwapSections(doc, page(section("a"), section("b"), section("c")))).toBe(true);
    expect(ids(doc)).toEqual(["a", "b", "c"]);
    expect(doc.querySelector("main")?.contains(doc.querySelector('[data-sf-section-id="c"]')!)).toBe(true);
  });

  it("removes a deleted section", () => {
    const doc = liveDoc(page(section("a"), section("b"), section("c")));

    expect(trySwapSections(doc, page(section("a"), section("c")))).toBe(true);
    expect(ids(doc)).toEqual(["a", "c"]);
  });

  it("moves and edits in the same patch", () => {
    const doc = liveDoc(page(section("a", "<p>one</p>"), section("b", "<p>two</p>")));
    const a = doc.querySelector('[data-sf-section-id="a"]');

    expect(trySwapSections(doc, page(section("b", "<p>two</p>"), section("a", "<p>edited</p>")))).toBe(true);
    expect(ids(doc)).toEqual(["b", "a"]);
    expect(doc.querySelector('[data-sf-section-id="a"]')).toBe(a);
    expect(a?.textContent).toBe("edited");
  });

  it("patches a setting edit without moving anything", () => {
    const doc = liveDoc(page(section("a", "<p>one</p>"), section("b", "<p>two</p>")));

    expect(trySwapSections(doc, page(section("a", "<p>ONE</p>"), section("b", "<p>two</p>")))).toBe(true);
    expect(doc.querySelector('[data-sf-section-id="a"]')?.textContent).toBe("ONE");
  });

  it("reorders inside one run while leaving sections in other runs alone", () => {
    const grouped = (...body: string[]) =>
      `<!doctype html><html><head><title>t</title></head><body>${section("head-1")}\n<main>\n${body.join("\n")}\n</main>\n${section("foot-1")}</body></html>`;
    const doc = liveDoc(grouped(section("a"), section("b")));
    const header = doc.querySelector('[data-sf-section-id="head-1"]');

    expect(trySwapSections(doc, grouped(section("b"), section("a")))).toBe(true);
    expect(ids(doc)).toEqual(["head-1", "b", "a", "foot-1"]);
    expect(doc.querySelector('[data-sf-section-id="head-1"]')).toBe(header);
  });

  it("falls back to a reload when the head changed", () => {
    const doc = liveDoc(page(section("a")));
    const next = page(section("a")).replace("<title>t</title>", "<title>t</title><link rel='stylesheet' href='x.css'>");

    expect(trySwapSections(doc, next)).toBe(false);
  });

  it("falls back to a reload when the page around the sections changed", () => {
    const doc = liveDoc(page(section("a"), section("b")));

    expect(trySwapSections(doc, page(section("a"), section("b")).replace("<header>h</header>", "<header>changed</header>"))).toBe(false);
  });

  it("falls back to a reload rather than guess when a section id is duplicated", () => {
    const doc = liveDoc(page(section("a"), section("a")));

    expect(trySwapSections(doc, page(section("a"), section("a")))).toBe(false);
  });
});
