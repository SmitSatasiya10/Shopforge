import { describe, it, expect } from "vitest";
import { buildTemplateFiles } from "./publish";
import type { StoreConfiguration } from "@/lib/store-config/store";

const config: StoreConfiguration = {
  version: 2,
  templates: {
    index: {
      sections: { hero: { type: "hero-banner", settings: { heading: "Welcome" } } },
      order: ["hero"],
    },
    product: {
      sections: { main: { type: "main-product", settings: {} } },
      order: ["main"],
    },
  },
  generatedAt: null,
};

describe("buildTemplateFiles", () => {
  it("serializes each page template to its Shopify theme file path", () => {
    const files = buildTemplateFiles(config);
    expect(files).toEqual([
      { filename: "templates/index.json", body: { type: "TEXT", value: JSON.stringify(config.templates.index) } },
      { filename: "templates/product.json", body: { type: "TEXT", value: JSON.stringify(config.templates.product) } },
    ]);
  });

  it("round-trips through JSON back to the same template shape", () => {
    const files = buildTemplateFiles(config);
    const roundTripped = JSON.parse(files[0].body.value);
    expect(roundTripped).toEqual(config.templates.index);
  });
});
