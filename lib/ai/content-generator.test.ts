import { describe, it, expect } from "vitest";
import {
  buildGenerationMessages,
  applyToFixedStructure,
  assertFixedTemplateStructure,
  type GeneratedSection,
} from "./content-generator";
import type { BlockSchema } from "./catalog";
import type { FixedSection, FixedTemplate } from "./fixed-sections";
import type { ShopifyTemplate } from "@/lib/preview/shopify-template";
import { NormalizedProductSchema } from "@/lib/product/types";
import type { CustomerPersona } from "@/lib/store-config/persona";
import type { MarketingAngle } from "@/lib/store-config/marketing-angle";

// Verifies the customer store-content language selected during onboarding reaches the
// actual generation prompt (store-content-language-selection-implementation.md §5/§7):
// the language is a hard prompt constraint, not just persisted UI state.

const fixed: FixedSection[] = [
  {
    id: "promo-highlight",
    type: "image-with-text",
    schema: {
      id: "image-with-text",
      label: "Image with text",
      settings: { heading: "inline_richtext", text: "richtext", image: "image_picker" },
      allowed_blocks: ["heading"],
    },
    seed: { type: "image-with-text", settings: {}, blocks: {}, block_order: [] },
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
    fixed,
    blocks,
  );
  expect(messages[0].role).toBe("system");
  return messages.find((m) => m.role === "user")!.content;
}

describe("buildGenerationMessages", () => {
  it("lists the fixed section ids the model must fill, not a free-form catalog to choose from", () => {
    const content = userMessage("en");
    expect(content).toContain("PAGE STRUCTURE (fixed");
    expect(content).toContain('id "promo-highlight"');
    expect(messagesSystemPrompt()).not.toContain("ids you invent");
    expect(messagesSystemPrompt()).toContain("EXACTLY the section ids");
  });

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

function messagesSystemPrompt(): string {
  const messages = buildGenerationMessages({ product, templateName: "index" }, fixed, blocks);
  return messages.find((m) => m.role === "system")!.content;
}

// applyToFixedStructure is the guard between the model's response and the final template: it
// replaces the old pruneToCatalog (which only ever removed sections/blocks the model
// shouldn't have invented) with an additive-safe merge onto the base theme's own seed, so a
// section the model omits can never end up missing from the page.

function fixedTemplate(): FixedTemplate {
  const seedTemplate: ShopifyTemplate = {
    order: ["hero", "usp"],
    sections: {
      hero: {
        type: "slideshow",
        settings: { auto_rotate: "true" },
        blocks: { "seed-slide": { type: "slide", settings: { heading: "Seed heading" } } },
        block_order: ["seed-slide"],
      },
      usp: {
        type: "custom-columns-new",
        settings: { title: "Seed USP title" },
        blocks: {},
        block_order: [],
      },
    },
  };
  const fixed: FixedSection[] = [
    {
      id: "hero",
      type: "slideshow",
      schema: {
        id: "slideshow",
        label: "Slideshow",
        settings: { auto_rotate: "boolean" },
        allowed_blocks: ["slide"],
      },
      seed: seedTemplate.sections.hero,
    },
    {
      id: "usp",
      type: "custom-columns-new",
      schema: {
        id: "custom-columns-new",
        label: "USP columns",
        settings: { title: "text" },
        allowed_blocks: ["column"],
        max_blocks: 2,
      },
      seed: seedTemplate.sections.usp,
    },
  ];
  return { seedTemplate, order: ["hero", "usp"], fixed };
}

describe("applyToFixedStructure", () => {
  it("fills every fixed id the model provides settings/blocks for", () => {
    const model: Record<string, GeneratedSection> = {
      hero: { settings: { auto_rotate: "false" }, blocks: { s1: { type: "slide", settings: { heading: "New" } } }, block_order: ["s1"] },
      usp: { settings: { title: "New USP title" } },
    };
    const { template, fallbackSections, dropped } = applyToFixedStructure(fixedTemplate(), model);
    expect(template.order).toEqual(["hero", "usp"]);
    expect(Object.keys(template.sections)).toEqual(["hero", "usp"]);
    expect(template.sections.hero.settings.auto_rotate).toBe("false");
    expect(template.sections.hero.blocks).toEqual({ s1: { type: "slide", settings: { heading: "New" } } });
    expect(template.sections.usp.settings.title).toBe("New USP title");
    expect(fallbackSections).toEqual([]);
    expect(dropped).toEqual([]);
  });

  it("falls back to the base theme's own seeded content when the model omits a fixed id", () => {
    const model: Record<string, GeneratedSection> = {
      hero: { settings: { auto_rotate: "false" } },
      // "usp" omitted entirely — must not disappear from the page.
    };
    const { template, fallbackSections } = applyToFixedStructure(fixedTemplate(), model);
    expect(Object.keys(template.sections)).toEqual(["hero", "usp"]);
    expect(template.order).toEqual(["hero", "usp"]);
    expect(template.sections.usp.settings.title).toBe("Seed USP title");
    expect(fallbackSections).toEqual(["usp"]);
  });

  it("drops a disallowed block type and reports it, keeping the section's other blocks", () => {
    const model: Record<string, GeneratedSection> = {
      hero: {
        blocks: {
          s1: { type: "slide", settings: { heading: "Kept" } },
          s2: { type: "not-a-real-block", settings: {} },
        },
        block_order: ["s1", "s2"],
      },
    };
    const { template, dropped } = applyToFixedStructure(fixedTemplate(), model);
    expect(template.sections.hero.blocks).toEqual({ s1: { type: "slide", settings: { heading: "Kept" } } });
    expect(dropped).toEqual(["slideshow/not-a-real-block"]);
  });

  it("ignores an unknown setting key while preserving the seed's other settings", () => {
    const model: Record<string, GeneratedSection> = {
      usp: { settings: { title: "New title", made_up_key: "x" } },
    };
    const { template } = applyToFixedStructure(fixedTemplate(), model);
    expect(template.sections.usp.settings).toEqual({ title: "New title" });
    expect(template.sections.usp.settings).not.toHaveProperty("made_up_key");
  });

  it("ignores section ids from the model that aren't part of the fixed structure", () => {
    const model: Record<string, GeneratedSection> = {
      hero: { settings: { auto_rotate: "false" } },
      "invented-section": { settings: { title: "Should never appear" } },
    };
    const { template } = applyToFixedStructure(fixedTemplate(), model);
    expect(Object.keys(template.sections)).toEqual(["hero", "usp"]);
  });

  it("respects max_blocks, dropping blocks past the limit", () => {
    const model: Record<string, GeneratedSection> = {
      usp: {
        blocks: {
          c1: { type: "column", settings: { title: "One" } },
          c2: { type: "column", settings: { title: "Two" } },
          c3: { type: "column", settings: { title: "Three" } },
        },
        block_order: ["c1", "c2", "c3"],
      },
    };
    const { template } = applyToFixedStructure(fixedTemplate(), model);
    expect(template.sections.usp.block_order).toEqual(["c1", "c2"]);
    expect(Object.keys(template.sections.usp.blocks!)).toEqual(["c1", "c2"]);
  });
});

// assertFixedTemplateStructure is the regression tripwire called at the end of
// generateTemplate(): it should never actually fire against applyToFixedStructure()'s real
// output today, but must fail loudly if a future change to that function ever lets a section
// go missing, reordered, or retyped reach the database again.

describe("assertFixedTemplateStructure", () => {
  it("passes for well-formed output matching the fixed structure", () => {
    const { template, fallbackSections } = applyToFixedStructure(fixedTemplate(), {
      hero: { settings: { auto_rotate: "false" } },
      usp: { settings: { title: "New title" } },
    });
    expect(fallbackSections).toEqual([]);
    expect(() => assertFixedTemplateStructure(template, fixedTemplate())).not.toThrow();
  });

  it("throws when a fixed section id is missing from the template", () => {
    const { seedTemplate, order, fixed } = fixedTemplate();
    const broken: ShopifyTemplate = { ...seedTemplate, order, sections: { hero: seedTemplate.sections.hero } };
    expect(() => assertFixedTemplateStructure(broken, { seedTemplate, order, fixed })).toThrow(/missing fixed section "usp"/);
  });

  it("throws when the order doesn't match the fixed order", () => {
    const { seedTemplate, order, fixed } = fixedTemplate();
    const broken: ShopifyTemplate = { ...seedTemplate, order: ["usp", "hero"] };
    expect(() => assertFixedTemplateStructure(broken, { seedTemplate, order, fixed })).toThrow(/does not match the fixed base-theme order/);
  });

  it("throws when a section's type has drifted from the fixed type", () => {
    const { seedTemplate, order, fixed } = fixedTemplate();
    const broken: ShopifyTemplate = {
      ...seedTemplate,
      order,
      sections: { ...seedTemplate.sections, hero: { ...seedTemplate.sections.hero, type: "not-slideshow" } },
    };
    expect(() => assertFixedTemplateStructure(broken, { seedTemplate, order, fixed })).toThrow(/expected fixed type "slideshow"/);
  });
});
