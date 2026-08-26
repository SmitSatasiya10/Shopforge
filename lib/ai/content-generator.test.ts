import { describe, it, expect } from "vitest";
import {
  buildGenerationMessages,
  buildGenerationPromptParts,
  buildGenerationMeta,
  applyToFixedStructure,
  assertFixedTemplateStructure,
  type GeneratedSection,
} from "./content-generator";
import { joinParts } from "./prompt-breakdown";
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

  it("never lists a locked section — the model is not asked to write content for it", () => {
    const lockedFixed: FixedSection[] = [
      ...fixed,
      {
        id: "trust-ticker",
        type: "horizontal-ticker",
        schema: { id: "horizontal-ticker", label: "Horizontal Ticker", locked: true },
        seed: { type: "horizontal-ticker", settings: {}, blocks: {}, block_order: [] },
      },
    ];
    const messages = buildGenerationMessages({ product, templateName: "index" }, lockedFixed, blocks);
    const content = messages.find((m) => m.role === "user")!.content;
    expect(content).toContain('id "promo-highlight"');
    expect(content).not.toContain('id "trust-ticker"');
  });
});

describe("buildGenerationPromptParts", () => {
  const options = { product, templateName: "index" as const, language: "de" };

  it("joins back to exactly the same content buildGenerationMessages produces", () => {
    const messages = buildGenerationMessages(options, fixed, blocks);
    const parts = buildGenerationPromptParts(options, fixed, blocks);
    expect(joinParts(parts)).toBe(messages.find((m) => m.role === "user")!.content);
  });

  it("categorizes the page structure as schema_definitions and the task brief as user_instruction, with no existing_content/existing_settings parts", () => {
    const parts = buildGenerationPromptParts(options, fixed, blocks);
    expect(parts.find((p) => p.key === "schema_definitions")?.text).toContain("PAGE STRUCTURE");
    expect(parts.find((p) => p.key === "user_instruction")?.text).toContain("TASK:");
    expect(parts.some((p) => p.key === "existing_content")).toBe(false);
    expect(parts.some((p) => p.key === "existing_settings")).toBe(false);
  });
});

describe("buildGenerationMeta", () => {
  it("counts only non-locked sections, matching what buildGenerationPromptParts actually describes", () => {
    const lockedFixed: FixedSection[] = [
      ...fixed,
      {
        id: "trust-ticker",
        type: "horizontal-ticker",
        schema: { id: "horizontal-ticker", label: "Horizontal Ticker", locked: true },
        seed: { type: "horizontal-ticker", settings: {}, blocks: {}, block_order: [] },
      },
    ];
    const options = { product, templateName: "product" as const };
    const parts = buildGenerationPromptParts(options, lockedFixed, blocks);
    const meta = buildGenerationMeta(options, lockedFixed, parts);
    expect(meta.pageType).toBe("product");
    expect(meta.sectionCount).toBe(1);
    expect(meta.sections).toEqual([{ id: "promo-highlight", type: "image-with-text" }]);
  });

  it("separately counts deterministic fixed_blocks and menu-only allowed_blocks, never conflating the two", () => {
    const fixedBlocksSection: FixedSection = {
      id: "main",
      type: "main-product",
      schema: { id: "main-product", label: "Main Product", fixed_blocks: true, settings: {} },
      seed: {
        type: "main-product",
        settings: {},
        blocks: {
          title: { type: "product_title", settings: {} },
          bundle: { type: "product_bundle-offer", settings: {} },
        },
        block_order: ["title", "bundle"],
      },
    };
    const options = { product, templateName: "product" as const };
    const allFixed = [...fixed, fixedBlocksSection]; // `fixed`'s one section allows 1 block type ("heading")
    const parts = buildGenerationPromptParts(options, allFixed, blocks);
    const meta = buildGenerationMeta(options, allFixed, parts);
    expect(meta.fixedBlockCount).toBe(2); // main-product's 2 seeded blocks
    expect(meta.allowedBlockTypeMenuSize).toBe(1); // promo-highlight's allowed_blocks: ["heading"]
  });

  it("derives schemaChars/contentChars from the same parts array, so they sum to the full user content length", () => {
    const options = { product, templateName: "index" as const };
    const parts = buildGenerationPromptParts(options, fixed, blocks);
    const meta = buildGenerationMeta(options, fixed, parts);
    expect(meta.schemaChars).toBe(parts.find((p) => p.key === "schema_definitions")!.text.length);
    expect(meta.schemaChars + meta.contentChars).toBe(joinParts(parts).length);
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

function fixedTemplateWithLocked(): FixedTemplate {
  const base = fixedTemplate();
  const lockedSeed = {
    type: "horizontal-ticker",
    settings: { speed: 3 },
    blocks: { seed_msg: { type: "text", settings: { text: "Seed ticker message" } } },
    block_order: ["seed_msg"],
  };
  return {
    seedTemplate: { ...base.seedTemplate, sections: { ...base.seedTemplate.sections, ticker: lockedSeed } },
    order: [...base.order, "ticker"],
    fixed: [
      ...base.fixed,
      {
        id: "ticker",
        type: "horizontal-ticker",
        schema: {
          id: "horizontal-ticker",
          label: "Horizontal Ticker",
          locked: true,
          settings: { speed: "range" },
          allowed_blocks: ["text"],
        },
        seed: lockedSeed,
      },
    ],
  };
}

describe("applyToFixedStructure", () => {
  it("fills every fixed id the model provides settings/blocks for", () => {
    const model: Record<string, GeneratedSection> = {
      hero: { settings: { auto_rotate: "false" }, blocks: { s1: { type: "slide", settings: { heading: "New" } } }, block_order: ["s1"] },
      usp: { settings: { title: "New USP title" } },
    };
    const { template, fallbackSections, dropped } = applyToFixedStructure(fixedTemplate(), model, blocks);
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
    const { template, fallbackSections } = applyToFixedStructure(fixedTemplate(), model, blocks);
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
    const { template, dropped } = applyToFixedStructure(fixedTemplate(), model, blocks);
    expect(template.sections.hero.blocks).toEqual({ s1: { type: "slide", settings: { heading: "Kept" } } });
    expect(dropped).toEqual(["slideshow/not-a-real-block"]);
  });

  it("ignores an unknown setting key while preserving the seed's other settings", () => {
    const model: Record<string, GeneratedSection> = {
      usp: { settings: { title: "New title", made_up_key: "x" } },
    };
    const { template } = applyToFixedStructure(fixedTemplate(), model, blocks);
    expect(template.sections.usp.settings).toEqual({ title: "New title" });
    expect(template.sections.usp.settings).not.toHaveProperty("made_up_key");
  });

  it("ignores section ids from the model that aren't part of the fixed structure", () => {
    const model: Record<string, GeneratedSection> = {
      hero: { settings: { auto_rotate: "false" } },
      "invented-section": { settings: { title: "Should never appear" } },
    };
    const { template } = applyToFixedStructure(fixedTemplate(), model, blocks);
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
    const { template } = applyToFixedStructure(fixedTemplate(), model, blocks);
    expect(template.sections.usp.block_order).toEqual(["c1", "c2"]);
    expect(Object.keys(template.sections.usp.blocks!)).toEqual(["c1", "c2"]);
  });

  it("keeps a locked section's seed content untouched even if the model returns something for it", () => {
    const model: Record<string, GeneratedSection> = {
      hero: { settings: { auto_rotate: "false" } },
      ticker: {
        settings: { speed: 5 },
        blocks: { hallucinated: { type: "text", settings: { text: "Model tried to rewrite this" } } },
        block_order: ["hallucinated"],
      },
    };
    const { template, fallbackSections } = applyToFixedStructure(fixedTemplateWithLocked(), model, blocks);
    expect(template.sections.ticker.settings).toEqual({ speed: 3 });
    expect(template.sections.ticker.blocks).toEqual({
      seed_msg: { type: "text", settings: { text: "Seed ticker message" } },
    });
    expect(template.sections.ticker.block_order).toEqual(["seed_msg"]);
    expect(fallbackSections).toContain("ticker");
  });
});

// main-product's blocks (bundle offer, sticky ATC, tabs, ...) are structural, not repeatable
// content items — `fixed_blocks` gives them the same additive-safe treatment as the section
// list itself: always the seed's own block ids/types/order, only settings are AI content.

function fixedTemplateWithFixedBlocks(): FixedTemplate {
  const mainSeed = {
    type: "main-product",
    settings: {},
    blocks: {
      title: { type: "product_title", settings: { text: "Seed title" } },
      bundle: { type: "product_bundle-offer", settings: { title_text: "Seed bundle" } },
    },
    block_order: ["title", "bundle"],
  };
  return {
    seedTemplate: { order: ["main"], sections: { main: mainSeed } },
    order: ["main"],
    fixed: [
      {
        id: "main",
        type: "main-product",
        schema: { id: "main-product", label: "Main Product", fixed_blocks: true, settings: {} },
        seed: mainSeed,
      },
    ],
  };
}

describe("applyToFixedStructure — fixed_blocks sections", () => {
  const blockCatalog: BlockSchema[] = [
    { id: "product_title", settings: { text: "text" } },
    { id: "product_bundle-offer", settings: { title_text: "text" } },
  ];

  it("fills settings for the seed's own block ids without letting the model add or remove blocks", () => {
    const model: Record<string, GeneratedSection> = {
      main: {
        blocks: {
          title: { type: "product_title", settings: { text: "New title" } },
          bundle: { type: "product_bundle-offer", settings: { title_text: "New bundle copy" } },
          hallucinated: { type: "product_urgency", settings: { urgency: "Model tried to add this" } },
        },
        block_order: ["hallucinated", "bundle", "title"],
      },
    };
    const { template } = applyToFixedStructure(fixedTemplateWithFixedBlocks(), model, blockCatalog);
    expect(template.sections.main.block_order).toEqual(["title", "bundle"]);
    expect(Object.keys(template.sections.main.blocks!)).toEqual(["title", "bundle"]);
    expect(template.sections.main.blocks!.title.settings.text).toBe("New title");
    expect(template.sections.main.blocks!.bundle.settings.title_text).toBe("New bundle copy");
  });

  it("keeps a fixed block's seed settings when the model omits it", () => {
    const model: Record<string, GeneratedSection> = {
      main: { blocks: { title: { type: "product_title", settings: { text: "New title" } } } },
    };
    const { template } = applyToFixedStructure(fixedTemplateWithFixedBlocks(), model, blockCatalog);
    expect(template.sections.main.blocks!.bundle.settings.title_text).toBe("Seed bundle");
  });

  it("never drops a fixed block even when the model returns no blocks at all", () => {
    const model: Record<string, GeneratedSection> = { main: { settings: {} } };
    const { template } = applyToFixedStructure(fixedTemplateWithFixedBlocks(), model, blockCatalog);
    expect(template.sections.main.block_order).toEqual(["title", "bundle"]);
    expect(template.sections.main.blocks!.title.settings.text).toBe("Seed title");
    expect(template.sections.main.blocks!.bundle.settings.title_text).toBe("Seed bundle");
  });
});

// assertFixedTemplateStructure is the regression tripwire called at the end of
// generateTemplate(): it should never actually fire against applyToFixedStructure()'s real
// output today, but must fail loudly if a future change to that function ever lets a section
// go missing, reordered, or retyped reach the database again.

describe("assertFixedTemplateStructure", () => {
  it("passes for well-formed output matching the fixed structure", () => {
    const { template, fallbackSections } = applyToFixedStructure(
      fixedTemplate(),
      {
        hero: { settings: { auto_rotate: "false" } },
        usp: { settings: { title: "New title" } },
      },
      blocks,
    );
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
