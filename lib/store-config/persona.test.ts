import { describe, it, expect } from "vitest";
import {
  PERSONA_CATEGORIES,
  PERSONA_CATEGORY_ICONS,
  PersonaOptionsCacheSchema,
  assignPersonaIcons,
  parseCustomerPersona,
  personaInstruction,
} from "./persona";

// The customer persona: what the wizard persists and what every content-generation prompt
// receives (product_based_customer_persona_implementation.md).

describe("persona categories", () => {
  it("gives every category a pool of at least four distinct icons", () => {
    for (const category of PERSONA_CATEGORIES) {
      const pool = PERSONA_CATEGORY_ICONS[category];
      expect(pool.length).toBeGreaterThanOrEqual(4);
      expect(new Set(pool).size).toBe(pool.length);
    }
  });
});

describe("assignPersonaIcons", () => {
  it("assigns the category's primary icon when categories differ", () => {
    const icons = assignPersonaIcons([
      { category: "travel" as const },
      { category: "work" as const },
    ]).map((o) => o.icon);
    expect(icons).toEqual(["🧳", "💼"]);
  });

  it("never repeats an icon when personas share a category", () => {
    const icons = assignPersonaIcons([
      { category: "travel" as const },
      { category: "travel" as const },
      { category: "travel" as const },
      { category: "travel" as const },
    ]).map((o) => o.icon);
    expect(new Set(icons).size).toBe(4);
    expect(icons[0]).toBe("🧳");
  });

  it("is deterministic for the same input", () => {
    const input = [
      { category: "pets" as const },
      { category: "pets" as const },
      { category: "gift" as const },
      { category: "home" as const },
    ];
    expect(assignPersonaIcons(input)).toEqual(assignPersonaIcons(input));
  });
});

describe("PersonaOptionsCacheSchema", () => {
  const option = (id: string) => ({
    id,
    name: "Frequent Traveler",
    description: "Values stylish organization for travel essentials",
    category: "travel",
    icon: "🧳",
  });

  it("accepts exactly four options", () => {
    expect(
      PersonaOptionsCacheSchema.safeParse({
        language: "de",
        options: [option("a"), option("b"), option("c"), option("d")],
      }).success,
    ).toBe(true);
  });

  it("rejects any other count", () => {
    expect(
      PersonaOptionsCacheSchema.safeParse({ language: "de", options: [option("a")] }).success,
    ).toBe(false);
    expect(
      PersonaOptionsCacheSchema.safeParse({
        language: "de",
        options: [option("a"), option("b"), option("c"), option("d"), option("e")],
      }).success,
    ).toBe(false);
  });
});

describe("parseCustomerPersona", () => {
  it("reads back a generated persona", () => {
    expect(
      parseCustomerPersona({
        type: "generated",
        id: "frequent-traveler",
        name: "Vielreisende",
        description: "Menschen, die stilvolle Taschen für Reisen suchen",
      }),
    ).toEqual({
      type: "generated",
      id: "frequent-traveler",
      name: "Vielreisende",
      description: "Menschen, die stilvolle Taschen für Reisen suchen",
    });
  });

  it("reads back a custom persona", () => {
    expect(parseCustomerPersona({ type: "custom", text: "Young professionals" })).toEqual({
      type: "custom",
      text: "Young professionals",
    });
  });

  it("returns null for missing or malformed data instead of throwing", () => {
    expect(parseCustomerPersona(null)).toBeNull();
    expect(parseCustomerPersona(undefined)).toBeNull();
    expect(parseCustomerPersona({ type: "generated", id: "" })).toBeNull();
    expect(parseCustomerPersona({ type: "custom", text: "" })).toBeNull();
    expect(parseCustomerPersona("frequent-traveler")).toBeNull();
  });
});

describe("personaInstruction", () => {
  it("carries a generated persona's name and description as an explicit constraint", () => {
    const text = personaInstruction({
      type: "generated",
      id: "frequent-traveler",
      name: "Vielreisende",
      description: "Menschen, die stilvolle Taschen für Reisen suchen",
    })!;
    expect(text).toContain("Target customer persona: Vielreisende");
    expect(text).toContain("Persona description: Menschen, die stilvolle Taschen für Reisen suchen");
    expect(text).toContain("Do not write generic copy that ignores the persona.");
  });

  it("carries a custom persona's text", () => {
    const text = personaInstruction({ type: "custom", text: "Young professionals who commute" })!;
    expect(text).toContain("described by the merchant");
    expect(text).toContain("Young professionals who commute");
  });

  it("returns null when no persona was chosen", () => {
    expect(personaInstruction(null)).toBeNull();
    expect(personaInstruction(undefined)).toBeNull();
  });
});
