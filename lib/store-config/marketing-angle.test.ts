import { describe, it, expect } from "vitest";
import {
  MarketingAngleCacheSchema,
  marketingAngleInstruction,
  parseMarketingAngle,
  personaCacheKey,
} from "./marketing-angle";

// The marketing angle: chosen on the persona step's second internal state, persisted on
// the project, and required by every content-generation prompt
// (persona_step_marketing_angle_implementation.md).

const option = (id: string) => ({
  id,
  title: `Title ${id}`,
  description: `Description ${id}`,
  icon: "✨",
});

describe("MarketingAngleCacheSchema", () => {
  it("accepts exactly four options with a persona key and recommended id", () => {
    expect(
      MarketingAngleCacheSchema.safeParse({
        language: "en",
        personaKey: "generated:business-traveler",
        options: [option("a"), option("b"), option("c"), option("d")],
        recommendedId: "a",
      }).success,
    ).toBe(true);
  });

  it("rejects any other count", () => {
    expect(
      MarketingAngleCacheSchema.safeParse({
        language: "en",
        personaKey: "generated:x",
        options: [option("a"), option("b"), option("c")],
        recommendedId: "a",
      }).success,
    ).toBe(false);
  });
});

describe("personaCacheKey", () => {
  it("keys a generated persona by its stable id", () => {
    expect(personaCacheKey({ type: "generated", id: "business-traveler" })).toBe(
      "generated:business-traveler",
    );
  });

  it("keys a custom persona by its text", () => {
    expect(personaCacheKey({ type: "custom", text: "  Young professionals " })).toBe(
      "custom:Young professionals",
    );
  });
});

describe("parseMarketingAngle", () => {
  it("reads back a persisted angle", () => {
    expect(
      parseMarketingAngle({
        id: "polished-travel",
        title: "Polished Travel, Without the Hassle",
        description: "For professionals who want organized essentials.",
        selectionType: "ai",
      }),
    ).toEqual({
      id: "polished-travel",
      title: "Polished Travel, Without the Hassle",
      description: "For professionals who want organized essentials.",
      selectionType: "ai",
    });
  });

  it("returns null for missing or malformed data", () => {
    expect(parseMarketingAngle(null)).toBeNull();
    expect(parseMarketingAngle({ id: "x", title: "y" })).toBeNull();
    expect(parseMarketingAngle({ id: "x", title: "y", description: "z", selectionType: "index" })).toBeNull();
  });
});

describe("marketingAngleInstruction", () => {
  it("carries the chosen angle as an explicit positioning constraint", () => {
    const text = marketingAngleInstruction({
      id: "polished-travel",
      title: "Polished Travel, Without the Hassle",
      description: "For professionals who want organized essentials.",
      selectionType: "generated",
    })!;
    expect(text).toContain('Marketing angle: "Polished Travel, Without the Hassle"');
    expect(text).toContain("Angle description: For professionals who want organized essentials.");
    expect(text).toContain("consistently communicate this positioning");
  });

  it("notes when the angle was AI-selected", () => {
    const text = marketingAngleInstruction({
      id: "x",
      title: "T",
      description: "D",
      selectionType: "ai",
    })!;
    expect(text).toContain("selected automatically");
  });

  it("returns null when no angle was chosen", () => {
    expect(marketingAngleInstruction(null)).toBeNull();
    expect(marketingAngleInstruction(undefined)).toBeNull();
  });
});
