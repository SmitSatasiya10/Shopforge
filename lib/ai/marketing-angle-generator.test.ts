import { describe, it, expect } from "vitest";
import { buildAngleMessages, parseAngleOptions, AngleGenerationError } from "./marketing-angle-generator";
import { NormalizedProductSchema } from "@/lib/product/types";
import type { CustomerPersona } from "@/lib/store-config/persona";

// Marketing-angle generation (persona_step_marketing_angle_implementation.md): the prompt
// must carry the product, the selected persona (a hard constraint) and the customer
// language, and the response is normalized to exactly four distinct validated angles plus
// the model's recommended one for "Let AI decide".

const product = NormalizedProductSchema.parse({
  title: "Premium Leather Travel Bag",
  description: "A garment travel bag with organized compartments",
  price: 125,
  compareAtPrice: null,
  currency: "USD",
  images: [{ url: "https://img.example/1.jpg" }],
  variants: [],
  options: [],
  vendor: "JenniBag",
  productUrl: "https://example.com/p/bag",
  source: "shopify",
});

const persona: CustomerPersona = {
  type: "generated",
  id: "business-traveler",
  name: "Frequent Business Traveler",
  description: "Needs polished, wrinkle-free attire on every trip",
};

describe("buildAngleMessages", () => {
  it("passes the product information into the angle prompt", () => {
    const user = buildAngleMessages(product, persona, "en").find((m) => m.role === "user")!.content;
    expect(user).toContain("Title: Premium Leather Travel Bag");
    expect(user).toContain("Description: A garment travel bag with organized compartments");
  });

  it("passes the persona as a hard constraint", () => {
    const user = buildAngleMessages(product, persona, "en").find((m) => m.role === "user")!.content;
    expect(user).toContain("hard constraint");
    expect(user).toContain("Frequent Business Traveler — Needs polished, wrinkle-free attire on every trip");
  });

  it("passes a custom persona's text", () => {
    const user = buildAngleMessages(product, { type: "custom", text: "Young commuters" }, "en").find(
      (m) => m.role === "user",
    )!.content;
    expect(user).toContain("described by the merchant");
    expect(user).toContain("Young commuters");
  });

  it("passes the customer language, defaulting to English", () => {
    expect(buildAngleMessages(product, persona, "de").find((m) => m.role === "user")!.content).toContain(
      "German (de)",
    );
    expect(buildAngleMessages(product, persona, undefined).find((m) => m.role === "user")!.content).toContain(
      "English (en)",
    );
  });

  it("asks for exactly four distinct angles and a recommendation", () => {
    const user = buildAngleMessages(product, persona, "en").find((m) => m.role === "user")!.content;
    expect(user).toContain("exactly four distinct marketing angles");
    expect(user).toContain("recommendedId");
  });
});

const raw = (id: string, extra: Partial<Record<string, string>> = {}) => ({
  id,
  title: `Title ${id}`,
  description: `Description ${id}`,
  icon: "🎯",
  ...extra,
});

describe("parseAngleOptions", () => {
  it("returns exactly four angles and the model's recommendation", () => {
    const { options, recommendedId } = parseAngleOptions({
      angles: [raw("a", { icon: "🧳" }), raw("b", { icon: "💼" }), raw("c", { icon: "✨" }), raw("d", { icon: "🌟" })],
      recommendedId: "c",
    });
    expect(options.map((o) => o.id)).toEqual(["a", "b", "c", "d"]);
    expect(options.map((o) => o.icon)).toEqual(["🧳", "💼", "✨", "🌟"]);
    expect(recommendedId).toBe("c");
  });

  it("falls back to the first angle when the recommendation is unknown", () => {
    const { recommendedId } = parseAngleOptions({
      angles: [raw("a"), raw("b", { icon: "💼" }), raw("c", { icon: "✨" }), raw("d", { icon: "🌟" })],
      recommendedId: "nope",
    });
    expect(recommendedId).toBe("a");
  });

  it("slugifies ids and de-duplicates repeated or missing icons", () => {
    const { options } = parseAngleOptions({
      angles: [
        raw("Polished Travel!", { icon: "🎯" }),
        raw("everyday_companion", { icon: "🎯" }),
        { id: "third", title: "T3", description: "D3" },
        raw("fourth", { icon: "🎯" }),
      ],
      recommendedId: "polished-travel",
    });
    expect(options.map((o) => o.id)).toEqual(["polished-travel", "everyday-companion", "third", "fourth"]);
    expect(new Set(options.map((o) => o.icon)).size).toBe(4);
  });

  it("rejects duplicate angles rather than showing the same positioning twice", () => {
    expect(() =>
      parseAngleOptions({ angles: [raw("same"), raw("same"), raw("Same!"), raw("same")], recommendedId: "same" }),
    ).toThrow(AngleGenerationError);
  });

  it("rejects fewer than four angles", () => {
    expect(() => parseAngleOptions({ angles: [raw("a"), raw("b")], recommendedId: "a" })).toThrow(
      AngleGenerationError,
    );
  });

  it("keeps only the first four when the model over-generates", () => {
    const { options } = parseAngleOptions({
      angles: [raw("a"), raw("b"), raw("c"), raw("d"), raw("e")],
      recommendedId: "e",
    });
    expect(options.map((o) => o.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("rejects a response with the wrong shape", () => {
    expect(() => parseAngleOptions({ marketing: [] })).toThrow(AngleGenerationError);
  });
});
