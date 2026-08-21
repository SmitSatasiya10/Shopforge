import { describe, it, expect } from "vitest";
import { classifyTitleTokens, coreSearchQuery, scoreTitleRelevance } from "./relevance";

describe("classifyTitleTokens", () => {
  it("separates identity tokens from color/material/size modifiers", () => {
    const { identity, modifiers } = classifyTitleTokens("Beige Bucket Bag Medium Size Leather");
    expect([...identity].sort()).toEqual(["bag", "bucket"]);
    expect([...modifiers].sort()).toEqual(["beige", "leather", "medium", "size"]);
  });

  it("drops stopwords and marketing filler", () => {
    const { identity, modifiers } = classifyTitleTokens("Handmade Ceramic Mug, Perfect Gift for Her");
    expect([...identity]).toEqual(["mug"]);
    expect([...modifiers]).toEqual(["ceramic"]);
  });

  it("folds plurals so 'mugs' matches 'mug'", () => {
    expect([...classifyTitleTokens("Ceramic Mugs").identity]).toEqual(["mug"]);
  });
});

describe("scoreTitleRelevance", () => {
  const REQUESTED = "Beige Bucket Bag Medium Size Leather Bucket Bag Crossbody Bag";

  it.each([
    ["Beige leather bucket bag"],
    ["Medium beige leather shoulder bucket bag"],
    ["Beige genuine leather bucket handbag"],
  ])("accepts the spec's good candidates: %s", (candidate) => {
    expect(scoreTitleRelevance(REQUESTED, candidate).relevant).toBe(true);
  });

  it.each([["Leather Wallet"], ["Leather Pouch"], ["Leather Phone Case"]])(
    "rejects candidates that only share a material: %s",
    (candidate) => {
      // Observed live: wallets returned as "related" to a bucket-bag request. A shared
      // modifier ("leather") without any shared identity token is a different product type.
      expect(scoreTitleRelevance(REQUESTED, candidate).relevant).toBe(false);
    },
  );

  it("rejects a candidate sharing only one incidental word with a specific request", () => {
    // "lamp" alone must not qualify against "cherry blossom tree lamp pink floral".
    const verdict = scoreTitleRelevance("cherry blossom tree lamp pink floral", "Navi Inspired Fairy Night Hanging Lamp");
    expect(verdict.relevant).toBe(false);
  });

  it("accepts same-type candidates that differ in attributes, ranked below closer matches", () => {
    const requested = "beige bucket bag medium size leather";
    const navy = scoreTitleRelevance(requested, "Handmade Navy Blue Leather Bucket Bag, Crossbody Shoulder Bag");
    const beige = scoreTitleRelevance(requested, "White & Cognac Leather Bucket Bag, Drawstring, Medium Bucket Bag");
    const makeup = scoreTitleRelevance(requested, "Leather Travel Makeup Bag – Stylish Cosmetic Pouch");
    expect(navy.relevant).toBe(true);
    expect(beige.relevant).toBe(true);
    expect(beige.score).toBeGreaterThan(navy.score);
    expect(navy.score).toBeGreaterThan(makeup.score); // a makeup pouch is barely related, never ahead
  });

  it("passes everything through when the requested title has no meaningful tokens", () => {
    expect(scoreTitleRelevance("the for and", "Anything At All").relevant).toBe(true);
  });

  it("relaxes the two-word requirement for short requested titles", () => {
    // "Handmade Ceramic Mug" only carries two meaningful tokens — one identity match must do.
    expect(scoreTitleRelevance("Handmade Ceramic Mug", "Stoneware Mug").relevant).toBe(true);
  });

  it("ignores 'one of a kind' / 'made to order' boilerplate instead of treating it as identity", () => {
    // Observed live: "denim knot pillow one of a kind recycled" scored real denim pillows
    // below the top-up threshold because "one" and "kind" diluted the denominator.
    const verdict = scoreTitleRelevance(
      "denim knot pillow one of a kind recycled",
      "Denim throw pillow, sham style. Patchwork front made using scraps from recycled denim jean.",
    );
    expect(verdict.relevant).toBe(true);
    expect(verdict.score).toBeGreaterThanOrEqual(0.5);
  });
});

describe("coreSearchQuery", () => {
  it("collapses a long marketing title to its deduped meaningful terms, in order", () => {
    expect(coreSearchQuery("Beige Bucket Bag Medium Size Leather Bucket Bag Crossbody Bag", 8)).toBe(
      "beige bucket bag medium size leather crossbody",
    );
  });

  it("caps the number of terms for the tighter second-attempt query", () => {
    expect(coreSearchQuery("Beige Bucket Bag Medium Size Leather Bucket Bag Crossbody Bag", 4)).toBe(
      "beige bucket bag medium",
    );
  });

  it("returns null when nothing meaningful remains", () => {
    expect(coreSearchQuery("the and for", 8)).toBeNull();
  });
});
