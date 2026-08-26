import { describe, it, expect } from "vitest";
import { buildTitleRewriteMessages, buildTitleRewritePromptParts } from "./title-rewriter";
import { joinParts } from "./prompt-breakdown";
import { NormalizedProductSchema } from "@/lib/product/types";
import type { CustomerPersona } from "@/lib/store-config/persona";
import type { MarketingAngle } from "@/lib/store-config/marketing-angle";

// AI rewrite of the product TITLE (docs/EDITOR-TOOLBARS.md): a standalone, single-string
// rewrite carrying the same language/persona/angle context as full generation and section
// rewrites.

const product = NormalizedProductSchema.parse({
  title: "Canvas Travel Backpack",
  description: "A 35L water-resistant backpack with a padded laptop sleeve",
  price: 79,
  compareAtPrice: null,
  currency: "USD",
  images: [{ url: "https://img.example/1.jpg" }],
  variants: [],
  options: [],
  vendor: "Northtrail",
  productUrl: "https://example.com/p/backpack",
  source: "shopify",
});

const baseOptions = { product, instruction: "Make it punchier" };

describe("buildTitleRewriteMessages", () => {
  it("carries the product's current title as the value to rewrite", () => {
    const content = buildTitleRewriteMessages(baseOptions).find((m) => m.role === "user")!.content;
    expect(content).toContain("CURRENT TITLE:");
    expect(content).toContain("Canvas Travel Backpack");
  });

  it("shows '(missing)' when the product has no title", () => {
    const content = buildTitleRewriteMessages({ ...baseOptions, product: { ...product, title: null } }).find(
      (m) => m.role === "user",
    )!.content;
    expect(content).toContain("CURRENT TITLE:\n(missing)");
  });

  it("carries the target language", () => {
    const content = buildTitleRewriteMessages({ ...baseOptions, language: "de" }).find(
      (m) => m.role === "user",
    )!.content;
    expect(content).toContain("German (de)");
  });

  it("includes a persona block only when supplied", () => {
    const persona: CustomerPersona = {
      type: "generated",
      id: "frequent-traveler",
      name: "Frequent Traveler",
      description: "Values organized travel essentials",
    };
    const withPersona = buildTitleRewriteMessages({ ...baseOptions, customerPersona: persona }).find(
      (m) => m.role === "user",
    )!.content;
    expect(withPersona).toContain("TARGET CUSTOMER PERSONA:");
    expect(buildTitleRewriteMessages(baseOptions).find((m) => m.role === "user")!.content).not.toContain(
      "TARGET CUSTOMER PERSONA:",
    );
  });

  it("includes a marketing angle block only when supplied", () => {
    const angle: MarketingAngle = {
      id: "polished-travel",
      title: "Polished Travel, Without the Hassle",
      description: "For professionals who want organized essentials.",
      selectionType: "ai",
    };
    const withAngle = buildTitleRewriteMessages({ ...baseOptions, marketingAngle: angle }).find(
      (m) => m.role === "user",
    )!.content;
    expect(withAngle).toContain("MARKETING ANGLE:");
    expect(buildTitleRewriteMessages(baseOptions).find((m) => m.role === "user")!.content).not.toContain(
      "MARKETING ANGLE:",
    );
  });

  it("carries the instruction", () => {
    const content = buildTitleRewriteMessages(baseOptions).find((m) => m.role === "user")!.content;
    expect(content).toContain("INSTRUCTION:\nMake it punchier");
  });
});

describe("buildTitleRewritePromptParts", () => {
  it("joins back to exactly the same content buildTitleRewriteMessages produces", () => {
    const messages = buildTitleRewriteMessages(baseOptions);
    const parts = buildTitleRewritePromptParts(baseOptions);
    expect(joinParts(parts)).toBe(messages.find((m) => m.role === "user")!.content);
  });

  it("categorizes the current title as existing_content and the instruction as user_instruction", () => {
    const parts = buildTitleRewritePromptParts(baseOptions);
    expect(parts.find((p) => p.key === "existing_content")?.text).toContain("CURRENT TITLE");
    expect(parts.find((p) => p.key === "user_instruction")?.text).toContain("Make it punchier");
    expect(parts.find((p) => p.key === "product_data")?.text).toContain("Canvas Travel Backpack");
  });
});
