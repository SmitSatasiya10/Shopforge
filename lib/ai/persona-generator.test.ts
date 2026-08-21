import { describe, it, expect } from "vitest";
import {
  buildPersonaMessages,
  parsePersonaOptions,
  PersonaGenerationError,
} from "./persona-generator";
import { NormalizedProductSchema } from "@/lib/product/types";

// Persona generation (product_based_customer_persona_implementation.md): the prompt must be
// built from the product data already in the wizard, in the customer's language, and the
// model's response is normalized to exactly four distinct, schema-valid options.

const product = NormalizedProductSchema.parse({
  title: "Canvas Travel Backpack",
  description: "A 35L water-resistant backpack with a padded laptop sleeve",
  price: 79,
  compareAtPrice: 99,
  currency: "USD",
  images: [{ url: "https://img.example/1.jpg" }],
  variants: [{ title: "Olive", price: 79, sku: "CTB-OL" }],
  options: [{ name: "Color", values: ["Olive", "Black"] }],
  vendor: "Northtrail",
  productUrl: "https://example.com/p/backpack",
  source: "shopify",
});

describe("buildPersonaMessages", () => {
  it("passes the product information into the persona prompt", () => {
    const user = buildPersonaMessages(product, "en").find((m) => m.role === "user")!.content;
    expect(user).toContain("Title: Canvas Travel Backpack");
    expect(user).toContain("Description: A 35L water-resistant backpack with a padded laptop sleeve");
    expect(user).toContain("Options: Color (Olive, Black)");
  });

  it("asks for exactly four distinct personas", () => {
    const user = buildPersonaMessages(product, "en").find((m) => m.role === "user")!.content;
    expect(user).toContain("exactly four distinct customer personas");
  });

  it("passes the customer language for names and descriptions, keeping ids language-neutral", () => {
    const user = buildPersonaMessages(product, "de").find((m) => m.role === "user")!.content;
    expect(user).toContain("German (de)");
    expect(user).toContain(`Keep every "id" in English kebab-case`);
  });

  it("defaults to English when no language was selected", () => {
    const user = buildPersonaMessages(product, undefined).find((m) => m.role === "user")!.content;
    expect(user).toContain("English (en)");
  });
});

const raw = (id: string, extra: Partial<Record<string, string>> = {}) => ({
  id,
  name: `Name ${id}`,
  description: `Description for ${id}`,
  category: "travel",
  ...extra,
});

describe("parsePersonaOptions", () => {
  it("returns exactly four options with icons derived from the category", () => {
    const options = parsePersonaOptions({
      personas: [raw("frequent-traveler"), raw("digital-nomad"), raw("weekend-explorer"), raw("business-traveler", { category: "work" })],
    });
    expect(options).toHaveLength(4);
    expect(options.map((o) => o.id)).toEqual([
      "frequent-traveler",
      "digital-nomad",
      "weekend-explorer",
      "business-traveler",
    ]);
    expect(options[0].icon).toBe("🧳");
    expect(options[3].icon).toBe("💼");
    // three travel personas + one work persona must still show four different icons
    expect(new Set(options.map((o) => o.icon)).size).toBe(4);
  });

  it("slugifies untidy ids into stable kebab-case", () => {
    const options = parsePersonaOptions({
      personas: [raw("Frequent Traveler!"), raw("digital_nomad"), raw("  weekend explorer  "), raw("gift-buyers")],
    });
    expect(options.map((o) => o.id)).toEqual([
      "frequent-traveler",
      "digital-nomad",
      "weekend-explorer",
      "gift-buyers",
    ]);
  });

  it("keeps only the first four when the model over-generates", () => {
    const options = parsePersonaOptions({
      personas: [raw("a"), raw("b"), raw("c"), raw("d"), raw("e"), raw("f")],
    });
    expect(options.map((o) => o.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("rejects duplicate personas rather than showing four of the same buyer", () => {
    expect(() =>
      parsePersonaOptions({
        personas: [raw("traveler"), raw("traveler"), raw("Traveler"), raw("traveler!")],
      }),
    ).toThrow(PersonaGenerationError);
  });

  it("rejects fewer than four personas", () => {
    expect(() => parsePersonaOptions({ personas: [raw("a"), raw("b"), raw("c")] })).toThrow(
      PersonaGenerationError,
    );
  });

  it("rejects a response with the wrong shape", () => {
    expect(() => parsePersonaOptions({ people: [] })).toThrow(PersonaGenerationError);
    expect(() => parsePersonaOptions("four personas: ...")).toThrow(PersonaGenerationError);
  });

  it("falls back to the general category for an unknown category value", () => {
    const options = parsePersonaOptions({
      personas: [raw("a", { category: "astronaut" }), raw("b"), raw("c"), raw("d")],
    });
    expect(options[0].category).toBe("general");
    expect(options[0].icon).toBe("🛍️");
  });
});
