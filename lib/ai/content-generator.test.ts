import { describe, it, expect } from "vitest";
import { buildGenerationMessages } from "./content-generator";
import type { SectionSchema, BlockSchema } from "./catalog";
import { NormalizedProductSchema } from "@/lib/product/types";
import type { CustomerPersona } from "@/lib/store-config/persona";
import type { MarketingAngle } from "@/lib/store-config/marketing-angle";

// Verifies the customer store-content language selected during onboarding reaches the
// actual generation prompt (store-content-language-selection-implementation.md §5/§7):
// the language is a hard prompt constraint, not just persisted UI state.

const allowed: SectionSchema[] = [
  {
    id: "image-with-text",
    label: "Image with text",
    settings: { heading: "inline_richtext", text: "richtext", image: "image_picker" },
    allowed_blocks: ["heading"],
  },
];

const blocks: BlockSchema[] = [{ id: "heading", settings: { text: "inline_richtext" } }];

const product = NormalizedProductSchema.parse({
  title: "Leather Bucket Bag",
  description: "Hand-stitched leather bag",
  price: 89,
  compareAtPrice: null,
  currency: "EUR",
  images: [{ url: "https://img.example/1.jpg" }],
  variants: [],
  options: [],
  vendor: "Atelier",
  productUrl: "https://example.com/p",
  source: "generic_html",
});

function userMessage(
  language?: string,
  customerPersona?: CustomerPersona,
  marketingAngle?: MarketingAngle,
): string {
  const messages = buildGenerationMessages(
    { product, templateName: "index", language, customerPersona, marketingAngle },
    allowed,
    blocks,
  );
  expect(messages[0].role).toBe("system");
  return messages.find((m) => m.role === "user")!.content;
}

describe("buildGenerationMessages", () => {
  it("passes the selected language to the generation prompt as an explicit constraint", () => {
    const content = userMessage("de");
    expect(content).toContain("TARGET LANGUAGE:");
    expect(content).toContain("German (de)");
    expect(content).toContain("must be written in German");
  });

  it("supports other selections such as French", () => {
    expect(userMessage("fr")).toContain("French (fr)");
  });

  it("passes an 'other' language's actual identifier, e.g. Japanese", () => {
    expect(userMessage("ja")).toContain("Japanese (ja)");
  });

  it("defaults to English when no language was selected", () => {
    expect(userMessage(undefined)).toContain("English (en)");
  });

  it("keeps the original product data as untranslated source input", () => {
    const content = userMessage("de");
    expect(content).toContain("Title: Leather Bucket Bag");
    expect(content).toContain("Description: Hand-stitched leather bag");
  });

  it("passes a generated customer persona alongside product and language", () => {
    const content = userMessage("de", {
      type: "generated",
      id: "fashion-conscious-professional",
      name: "Modebewusste Berufstätige",
      description: "Sucht eine elegante Tasche für Arbeit und Alltag",
    });
    expect(content).toContain("TARGET CUSTOMER PERSONA:");
    expect(content).toContain("Target customer persona: Modebewusste Berufstätige");
    expect(content).toContain("Sucht eine elegante Tasche für Arbeit und Alltag");
    // language and product remain present next to the persona
    expect(content).toContain("German (de)");
    expect(content).toContain("Title: Leather Bucket Bag");
  });

  it("passes a custom persona's text", () => {
    const content = userMessage("en", {
      type: "custom",
      text: "Young professionals who want stylish products for everyday use.",
    });
    expect(content).toContain("TARGET CUSTOMER PERSONA:");
    expect(content).toContain("Young professionals who want stylish products for everyday use.");
  });

  it("omits the persona block when no persona was chosen", () => {
    expect(userMessage("en")).not.toContain("TARGET CUSTOMER PERSONA:");
  });

  it("passes the marketing angle alongside product, language and persona", () => {
    const content = userMessage(
      "en",
      { type: "generated", id: "business-traveler", name: "Business Traveler", description: "Travels for work" },
      {
        id: "polished-travel",
        title: "Polished Travel, Without the Hassle",
        description: "For professionals who want organized essentials.",
        selectionType: "generated",
      },
    );
    expect(content).toContain("MARKETING ANGLE:");
    expect(content).toContain('Marketing angle: "Polished Travel, Without the Hassle"');
    // the full targeting context travels together
    expect(content).toContain("TARGET CUSTOMER PERSONA:");
    expect(content).toContain("English (en)");
    expect(content).toContain("Title: Leather Bucket Bag");
  });

  it("omits the angle block when no angle was chosen", () => {
    expect(userMessage("en")).not.toContain("MARKETING ANGLE:");
  });
});
