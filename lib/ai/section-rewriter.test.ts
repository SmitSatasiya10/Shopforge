import { describe, it, expect, vi } from "vitest";

const chatMock = vi.fn();
vi.mock("./openrouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./openrouter")>();
  return { ...actual, chat: (...args: unknown[]) => chatMock(...args) };
});

import {
  applyScopedRewrite,
  buildRewriteMessages,
  buildRewritePromptParts,
  buildScopedSettingMessages,
  buildScopedSettingPromptParts,
  buildScopedBlockMessages,
  buildScopedBlockPromptParts,
  buildScopedSectionSettingsMessages,
  buildScopedSectionSettingsPromptParts,
  clampAndRestoreImages,
  rewriteWholeSectionParallel,
  sanitizeRewrittenSection,
} from "./section-rewriter";
import { joinParts } from "./prompt-breakdown";
import type { SectionSchema, BlockSchema } from "./catalog";
import type { AiConfig } from "./config";
import type { ShopifySection } from "@/lib/preview/shopify-template";
import { NormalizedProductSchema } from "@/lib/product/types";

// The guard between the model and the template: whatever a rewrite returns, the section
// keeps its type, its images, and only catalog-allowed blocks — same contract as full
// generation's pruneToCatalog, scoped to one section.

const schema: SectionSchema = {
  id: "image-with-text",
  label: "Image with text",
  settings: { heading: "inline_richtext", text: "richtext", image: "image_picker" },
  allowed_blocks: ["heading", "paragraph"],
  max_blocks: 2,
};

const blocks: BlockSchema[] = [
  { id: "heading", settings: { text: "inline_richtext" } },
  { id: "paragraph", settings: { text: "richtext", background: "image_picker" } },
];

const product = NormalizedProductSchema.parse({
  title: "Round Catering Burner",
  description: null,
  price: 999,
  compareAtPrice: null,
  currency: "INR",
  images: [{ url: "https://img.example/1.jpg" }, { url: "https://img.example/2.jpg" }],
  variants: [],
  options: [],
  vendor: "Gurubhai Equipments",
  productUrl: "https://example.com/p",
  source: "generic_html",
});

const original: ShopifySection = {
  type: "image-with-text",
  settings: { heading: "Old heading", image: "https://img.example/original.jpg" },
  blocks: { b1: { type: "paragraph", settings: { text: "Old body", background: "https://img.example/bg.jpg" } } },
  block_order: ["b1"],
};

describe("sanitizeRewrittenSection", () => {
  it("forces the original section type back", () => {
    const { section } = sanitizeRewrittenSection(
      original,
      { type: "slideshow", settings: { heading: "New" } },
      schema,
      blocks,
      product,
    );
    expect(section.type).toBe("image-with-text");
  });

  it("keeps the original image settings even when the model changed them", () => {
    const { section } = sanitizeRewrittenSection(
      original,
      {
        type: "image-with-text",
        settings: { heading: "New heading", image: "https://evil.example/swapped.jpg" },
        blocks: { b1: { type: "paragraph", settings: { text: "New body", background: "" } } },
        block_order: ["b1"],
      },
      schema,
      blocks,
      product,
    );
    expect(section.settings.image).toBe("https://img.example/original.jpg");
    expect(section.blocks!.b1.settings.background).toBe("https://img.example/bg.jpg");
    expect(section.settings.heading).toBe("New heading");
  });

  it("drops blocks outside the allowlist and enforces max_blocks", () => {
    const { section, dropped } = sanitizeRewrittenSection(
      original,
      {
        type: "image-with-text",
        settings: {},
        blocks: {
          b1: { type: "paragraph", settings: { text: "1" } },
          b2: { type: "video", settings: {} },
          b3: { type: "heading", settings: { text: "2" } },
          b4: { type: "heading", settings: { text: "3" } },
        },
        block_order: ["b1", "b2", "b3", "b4"],
      },
      schema,
      blocks,
      product,
    );
    expect(section.block_order).toEqual(["b1", "b3"]);
    expect(Object.keys(section.blocks!)).toEqual(["b1", "b3"]);
    expect(dropped).toContain("image-with-text/video");
    expect(dropped.some((d) => d.includes("over max_blocks"))).toBe(true);
  });

  it("fills a brand-new block's empty image slot from the product's own photos", () => {
    const { section } = sanitizeRewrittenSection(
      { type: "image-with-text", settings: {}, blocks: {}, block_order: [] },
      {
        type: "image-with-text",
        settings: { image: "" },
        blocks: { fresh: { type: "paragraph", settings: { text: "hi", background: "" } } },
        block_order: ["fresh"],
      },
      schema,
      blocks,
      product,
    );
    expect(section.settings.image).toBe("https://img.example/1.jpg");
    expect(section.blocks!.fresh.settings.background).toBe("https://img.example/2.jpg");
  });
});

describe("settings outside the catalog vocabulary", () => {
  // The model sees the section's current JSON, which for theme-seeded sections carries
  // dozens of presentation settings the catalog never exposes. Echoing them back with
  // drift once flipped a heading's enable_custom_color during a "fix spelling" rewrite —
  // the clamp keeps every non-catalog setting at its original value.
  it("keeps original values for settings the catalog does not expose", () => {
    const schemaWithVocab: SectionSchema = {
      ...schema,
      settings: { heading: "inline_richtext" },
    };
    const blocksWithVocab: BlockSchema[] = [
      ...blocks.filter((b) => b.id !== "heading"),
      { id: "heading", settings: { title: "inline_richtext", heading_size: ["h0", "h1"] } },
    ];
    const originalDense: ShopifySection = {
      type: "image-with-text",
      settings: { heading: "Old", color_scheme: "background-1" },
      blocks: {
        h1: {
          type: "heading",
          settings: { title: "Hurry! Sale Ends Soon", heading_size: "h1", enable_custom_color: true, custom_color: "#415695", blur_type: "words" },
        },
      },
      block_order: ["h1"],
    };
    const { section } = sanitizeRewrittenSection(
      originalDense,
      {
        type: "image-with-text",
        settings: { heading: "New", color_scheme: "inverse" },
        blocks: {
          h1: {
            type: "heading",
            settings: { title: "Hurry! Sale ends soon", heading_size: "h0", enable_custom_color: false, custom_color: "#000000", blur_type: "chars" },
          },
        },
        block_order: ["h1"],
      },
      { ...schemaWithVocab, allowed_blocks: ["heading"] },
      blocksWithVocab,
      product,
    );
    // Catalog-exposed settings take the model's values…
    expect(section.settings.heading).toBe("New");
    expect(section.blocks!.h1.settings.title).toBe("Hurry! Sale ends soon");
    expect(section.blocks!.h1.settings.heading_size).toBe("h0");
    // …everything else keeps the original, no matter what the model echoed.
    expect(section.settings.color_scheme).toBe("background-1");
    expect(section.blocks!.h1.settings.enable_custom_color).toBe(true);
    expect(section.blocks!.h1.settings.custom_color).toBe("#415695");
    expect(section.blocks!.h1.settings.blur_type).toBe("words");
  });
});

describe("applyScopedRewrite", () => {
  it("takes ONLY the scoped setting from the rewrite, everything else stays original", () => {
    const rewritten: typeof original = {
      type: "image-with-text",
      settings: { heading: "Rewritten heading", image: "swapped.jpg" },
      blocks: { b1: { type: "paragraph", settings: { text: "Rewritten body", background: "x.jpg" } } },
      block_order: ["b1"],
    };
    const scoped = applyScopedRewrite(original, rewritten, { blockPath: ["b1"], settingId: "text" });
    expect(scoped.blocks!.b1.settings.text).toBe("Rewritten body");
    expect(scoped.settings.heading).toBe("Old heading");
    expect(scoped.settings.image).toBe("https://img.example/original.jpg");
    expect(scoped.blocks!.b1.settings.background).toBe("https://img.example/bg.jpg");
  });

  it("returns the original untouched when the model dropped the scoped setting", () => {
    const rewritten: typeof original = { type: "image-with-text", settings: {} };
    expect(applyScopedRewrite(original, rewritten, { blockPath: [], settingId: "heading" })).toBe(original);
  });

  it("block scope (no settingId): takes every setting on that block, nothing else", () => {
    const withTwoBlocks: ShopifySection = {
      type: "image-with-text",
      settings: { heading: "Old heading", image: "https://img.example/original.jpg" },
      blocks: {
        b1: { type: "paragraph", settings: { text: "Old body", background: "https://img.example/bg.jpg" } },
        b2: { type: "heading", settings: { text: "Old h2" } },
      },
      block_order: ["b1", "b2"],
    };
    const rewritten: ShopifySection = {
      type: "image-with-text",
      settings: { heading: "Rewritten section heading" }, // model touched section-level too — must be ignored
      blocks: {
        b1: { type: "paragraph", settings: { text: "Rewritten body", background: "swapped.jpg" } },
        b2: { type: "heading", settings: { text: "Rewritten h2" } },
      },
      block_order: ["b1", "b2"],
    };
    const scoped = applyScopedRewrite(withTwoBlocks, rewritten, { blockPath: ["b1"] });
    // The scoped block's settings all moved to the model's values.
    expect(scoped.blocks!.b1.settings.text).toBe("Rewritten body");
    expect(scoped.blocks!.b1.settings.background).toBe("swapped.jpg");
    // Everything else — the sibling block and section-level settings — stays original.
    expect(scoped.blocks!.b2.settings.text).toBe("Old h2");
    expect(scoped.settings.heading).toBe("Old heading");
    expect(scoped.settings.image).toBe("https://img.example/original.jpg");
  });

  it("block scope returns the original untouched when the model dropped the scoped block", () => {
    const rewritten: ShopifySection = { type: "image-with-text", settings: {}, blocks: {}, block_order: [] };
    expect(applyScopedRewrite(original, rewritten, { blockPath: ["b1"] })).toBe(original);
  });

  it("block scope with an empty path (no block identified) is a no-op, never the whole section", () => {
    const rewritten: ShopifySection = { type: "image-with-text", settings: { heading: "Rewritten everything" } };
    expect(applyScopedRewrite(original, rewritten, { blockPath: [] })).toBe(original);
  });
});

describe("buildRewriteMessages", () => {
  const baseOptions = {
    product,
    sectionId: "s1",
    section: original,
    instruction: "Make the heading punchier",
  };

  it("carries the project's customer language into the rewrite prompt", () => {
    const content = buildRewriteMessages({ ...baseOptions, language: "de" }, schema, blocks).find(
      (m) => m.role === "user",
    )!.content;
    expect(content).toContain("TARGET LANGUAGE:");
    expect(content).toContain("German (de)");
    expect(content).toContain("must be written in German");
  });

  it("defaults to English when the project has no language", () => {
    const content = buildRewriteMessages(baseOptions, schema, blocks).find((m) => m.role === "user")!.content;
    expect(content).toContain("English (en)");
  });

  it("carries the project's customer persona into the rewrite prompt", () => {
    const content = buildRewriteMessages(
      {
        ...baseOptions,
        customerPersona: {
          type: "generated",
          id: "frequent-traveler",
          name: "Frequent Traveler",
          description: "Values stylish organization for travel essentials",
        },
      },
      schema,
      blocks,
    ).find((m) => m.role === "user")!.content;
    expect(content).toContain("TARGET CUSTOMER PERSONA:");
    expect(content).toContain("Target customer persona: Frequent Traveler");
  });

  it("omits the persona block when the project has none", () => {
    const content = buildRewriteMessages(baseOptions, schema, blocks).find((m) => m.role === "user")!.content;
    expect(content).not.toContain("TARGET CUSTOMER PERSONA:");
  });

  it("carries the project's marketing angle into the rewrite prompt", () => {
    const content = buildRewriteMessages(
      {
        ...baseOptions,
        marketingAngle: {
          id: "polished-travel",
          title: "Polished Travel, Without the Hassle",
          description: "For professionals who want organized essentials.",
          selectionType: "ai",
        },
      },
      schema,
      blocks,
    ).find((m) => m.role === "user")!.content;
    expect(content).toContain("MARKETING ANGLE:");
    expect(content).toContain('Marketing angle: "Polished Travel, Without the Hassle"');
  });

  it("omits the angle block when the project has none", () => {
    const content = buildRewriteMessages(baseOptions, schema, blocks).find((m) => m.role === "user")!.content;
    expect(content).not.toContain("MARKETING ANGLE:");
  });

});

describe("buildRewritePromptParts", () => {
  const baseOptions = {
    product,
    sectionId: "s1",
    section: original,
    instruction: "Make the heading punchier",
  };

  it("joins back to exactly the same content buildRewriteMessages produces", () => {
    const messages = buildRewriteMessages(baseOptions, schema, blocks);
    const parts = buildRewritePromptParts(baseOptions, schema, blocks);
    expect(joinParts(parts)).toBe(messages.find((m) => m.role === "user")!.content);
  });

  it("categorizes the existing section JSON as existing_content and the instruction as user_instruction", () => {
    const parts = buildRewritePromptParts(baseOptions, schema, blocks);
    expect(parts.find((p) => p.key === "existing_content")?.text).toContain("CURRENT SECTION JSON");
    expect(parts.find((p) => p.key === "user_instruction")?.text).toContain("Make the heading punchier");
    expect(parts.find((p) => p.key === "schema_definitions")?.text).toContain("SECTION SCHEMA");
  });

  it("includes a persona part only when a persona was supplied", () => {
    const withPersona = buildRewritePromptParts(
      {
        ...baseOptions,
        customerPersona: {
          type: "generated",
          id: "frequent-traveler",
          name: "Frequent Traveler",
          description: "Values stylish organization for travel essentials",
        },
      },
      schema,
      blocks,
    );
    expect(withPersona.some((p) => p.key === "persona")).toBe(true);
    expect(buildRewritePromptParts(baseOptions, schema, blocks).some((p) => p.key === "persona")).toBe(false);
  });
});

describe("buildScopedSettingMessages", () => {
  const baseOptions = {
    product,
    sectionId: "s1",
    section: original,
    instruction: "Make it punchier",
  };

  it("names the setting and carries its current value, not the whole section", () => {
    const content = buildScopedSettingMessages(baseOptions, "heading", "inline_richtext", "Old heading").find(
      (m) => m.role === "user",
    )!.content;
    expect(content).toContain('SETTING (id "heading"): inline_richtext');
    expect(content).toContain('"Old heading"');
    expect(content).not.toContain("SECTION SCHEMA");
    expect(content).not.toContain("CURRENT SECTION JSON");
  });

  it("carries the project's customer language, same as the whole-section prompt", () => {
    const content = buildScopedSettingMessages({ ...baseOptions, language: "de" }, "heading", "inline_richtext", "Old").find(
      (m) => m.role === "user",
    )!.content;
    expect(content).toContain("German (de)");
  });

  it("never leaks a sibling setting's value into the prompt", () => {
    const content = buildScopedSettingMessages(baseOptions, "text", "richtext", "Old body").find(
      (m) => m.role === "user",
    )!.content;
    expect(content).not.toContain("Old heading");
  });
});

describe("buildScopedSettingPromptParts", () => {
  const baseOptions = {
    product,
    sectionId: "s1",
    section: original,
    instruction: "Make it punchier",
  };

  it("joins back to exactly the same content buildScopedSettingMessages produces", () => {
    const messages = buildScopedSettingMessages(baseOptions, "heading", "inline_richtext", "Old heading");
    const parts = buildScopedSettingPromptParts(baseOptions, "heading", "inline_richtext", "Old heading");
    expect(joinParts(parts)).toBe(messages.find((m) => m.role === "user")!.content);
  });

  it("categorizes the current value as existing_settings", () => {
    const parts = buildScopedSettingPromptParts(baseOptions, "heading", "inline_richtext", "Old heading");
    expect(parts.find((p) => p.key === "existing_settings")?.text).toContain("CURRENT VALUE");
    expect(parts.find((p) => p.key === "schema_definitions")?.text).toContain('SETTING (id "heading")');
  });
});

describe("buildScopedBlockMessages", () => {
  const baseOptions = {
    product,
    sectionId: "s1",
    section: original,
    instruction: "Make it punchier",
  };
  const paragraphBlock = blocks.find((b) => b.id === "paragraph")!;
  const currentBlock = original.blocks!.b1;

  it("describes only this block's own schema and settings, not the whole section", () => {
    const content = buildScopedBlockMessages(baseOptions, paragraphBlock, currentBlock).find(
      (m) => m.role === "user",
    )!.content;
    expect(content).toContain("BLOCK SCHEMA");
    expect(content).toContain("text: richtext");
    expect(content).toContain('"Old body"');
    expect(content).not.toContain("SECTION SCHEMA");
    expect(content).not.toContain("allowed blocks");
  });
});

describe("buildScopedBlockPromptParts", () => {
  const baseOptions = {
    product,
    sectionId: "s1",
    section: original,
    instruction: "Make it punchier",
  };
  const paragraphBlock = blocks.find((b) => b.id === "paragraph")!;
  const currentBlock = original.blocks!.b1;

  it("joins back to exactly the same content buildScopedBlockMessages produces", () => {
    const messages = buildScopedBlockMessages(baseOptions, paragraphBlock, currentBlock);
    const parts = buildScopedBlockPromptParts(baseOptions, paragraphBlock, currentBlock);
    expect(joinParts(parts)).toBe(messages.find((m) => m.role === "user")!.content);
  });

  it("categorizes the current block settings as existing_settings", () => {
    const parts = buildScopedBlockPromptParts(baseOptions, paragraphBlock, currentBlock);
    expect(parts.find((p) => p.key === "existing_settings")?.text).toContain("CURRENT BLOCK SETTINGS");
    expect(parts.find((p) => p.key === "schema_definitions")?.text).toContain("BLOCK SCHEMA");
  });
});

describe("buildScopedSectionSettingsMessages", () => {
  const baseOptions = {
    product,
    sectionId: "s1",
    section: original,
    instruction: "Make it punchier",
  };

  it("describes only the section's own settings schema and current values, not any block", () => {
    const content = buildScopedSectionSettingsMessages(baseOptions, schema).find((m) => m.role === "user")!
      .content;
    expect(content).toContain("SECTION SETTINGS SCHEMA");
    expect(content).toContain("heading: inline_richtext");
    expect(content).toContain('"Old heading"');
    expect(content).not.toContain("Old body"); // the block's own setting value
    expect(content).not.toContain("allowed blocks");
  });
});

describe("buildScopedSectionSettingsPromptParts", () => {
  const baseOptions = {
    product,
    sectionId: "s1",
    section: original,
    instruction: "Make it punchier",
  };

  it("joins back to exactly the same content buildScopedSectionSettingsMessages produces", () => {
    const messages = buildScopedSectionSettingsMessages(baseOptions, schema);
    const parts = buildScopedSectionSettingsPromptParts(baseOptions, schema);
    expect(joinParts(parts)).toBe(messages.find((m) => m.role === "user")!.content);
  });

  it("categorizes the current section settings as existing_settings", () => {
    const parts = buildScopedSectionSettingsPromptParts(baseOptions, schema);
    expect(parts.find((p) => p.key === "existing_settings")?.text).toContain("CURRENT SECTION SETTINGS");
    expect(parts.find((p) => p.key === "schema_definitions")?.text).toContain("SECTION SETTINGS SCHEMA");
  });
});

describe("clampAndRestoreImages", () => {
  it("takes catalog-described keys from the model, keeps a non-catalog existing key original", () => {
    const kept = clampAndRestoreImages(
      { text: "New body", enable_custom_color: false },
      { text: "Old body", enable_custom_color: true },
      { id: "paragraph", settings: { text: "richtext" } },
    );
    expect(kept.text).toBe("New body");
    // enable_custom_color isn't in this schema's settings — the model's value is discarded.
    expect(kept.enable_custom_color).toBe(true);
  });

  it("restores the original image/video setting even if the model tried to change it", () => {
    const kept = clampAndRestoreImages(
      { background: "https://evil.example/swapped.jpg" },
      { background: "https://img.example/bg.jpg" },
      { id: "paragraph", settings: { background: "image_picker" } },
    );
    expect(kept.background).toBe("https://img.example/bg.jpg");
  });
});

describe("rewriteWholeSectionParallel", () => {
  // A page-builder-style section: settings live on blocks nested inside other blocks (a
  // "column" wrapper holding "text"/"heading" blocks), not just at the top level — the shape
  // that exposed the bug where only immediate blocks were ever reached.
  const nestedSchema: SectionSchema = {
    id: "page-builder",
    label: "Page builder",
    settings: {},
    allowed_blocks: ["column"],
  };
  const nestedBlocks: BlockSchema[] = [
    { id: "column", settings: {}, allowed_blocks: ["text", "heading"] },
    { id: "text", settings: { text: "richtext" } },
    { id: "heading", settings: { title: "richtext" } },
  ];
  const nestedSection: ShopifySection = {
    type: "page-builder",
    settings: {},
    blocks: {
      column_1: {
        type: "column",
        settings: {},
        blocks: {
          text_1: { type: "text", settings: { text: "Old text" } },
          heading_1: { type: "heading", settings: { title: "Old heading" } },
        },
      },
    },
    block_order: ["column_1"],
  };
  const config: AiConfig = {
    apiKey: "test-key",
    model: "test-model",
    baseUrl: "https://example.invalid",
    generateImages: false,
    imageModel: "test-image-model",
  };

  it("reaches and rewrites blocks nested inside other blocks, not just top-level ones", async () => {
    chatMock.mockReset();
    chatMock.mockImplementation(async ({ messages }: { messages: { role: string; content: string }[] }) => {
      const content = messages.find((m) => m.role === "user")!.content;
      if (content.includes("Old text")) return '{"block":{"settings":{"text":"New text"}}}';
      if (content.includes("Old heading")) return '{"block":{"settings":{"title":"New heading"}}}';
      throw new Error(`Unexpected chat() call for a block with no settings of its own: ${content.slice(0, 100)}`);
    });

    const result = await rewriteWholeSectionParallel(
      { product, sectionId: "s1", section: nestedSection, instruction: "Punch it up" },
      nestedSchema,
      nestedBlocks,
      config,
    );

    // Exactly the two blocks that actually have their own settings — the "column" wrapper
    // (no settings) never generates a wasted call, but recursion still reaches through it.
    expect(chatMock).toHaveBeenCalledTimes(2);
    const column = result.section.blocks!.column_1;
    expect(column.type).toBe("column");
    expect(column.blocks!.text_1.settings.text).toBe("New text");
    expect(column.blocks!.heading_1.settings.title).toBe("New heading");
  });
});

