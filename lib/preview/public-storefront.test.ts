import { describe, expect, it, vi, beforeEach } from "vitest";

const projectFindUnique = vi.fn();
const renderTemplate = vi.fn();

vi.mock("@/lib/db/prisma", () => ({
  prisma: { project: { findUnique: (...args: unknown[]) => projectFindUnique(...args) } },
}));

vi.mock("./template-renderer", () => ({
  renderTemplate: (...args: unknown[]) => renderTemplate(...args),
}));

const { renderPublicStorefront } = await import("./public-storefront");

const configuration = {
  version: 2,
  templates: {
    index: { sections: {}, order: [] },
    product: { sections: {}, order: [] },
  },
  generatedAt: null,
};

function project(overrides: Record<string, unknown> = {}) {
  return {
    id: "theme-1",
    publicPreviewEnabled: true,
    configurationJson: configuration,
    selectedImagesJson: null,
    store: {
      product: {
        id: "product-1",
        title: "Aurora Merino Crew",
        description: "A midweight merino crew knit.",
        price: 128,
        compareAtPrice: null,
        currency: "USD",
        vendor: "Northwake",
        images: [],
        variants: [],
        options: [],
        sourceUrl: "https://example.com/p",
        sourcePlatform: "shopify",
        importStatus: "succeeded",
        importError: null,
        importedFieldsMissing: [],
        importSource: "shopify",
        supplierPlatform: null,
      },
    },
    ...overrides,
  };
}

describe("renderPublicStorefront", () => {
  beforeEach(() => {
    projectFindUnique.mockReset();
    renderTemplate.mockReset();
    renderTemplate.mockResolvedValue("<!doctype html><html></html>");
  });

  it("returns null for an empty token without querying the database", async () => {
    const result = await renderPublicStorefront("", "index");
    expect(result).toBeNull();
    expect(projectFindUnique).not.toHaveBeenCalled();
  });

  it("returns null when no project matches the token", async () => {
    projectFindUnique.mockResolvedValue(null);
    const result = await renderPublicStorefront("missing-token", "index");
    expect(result).toBeNull();
  });

  it("returns null when the link is disabled, even for a matching token", async () => {
    projectFindUnique.mockResolvedValue(project({ publicPreviewEnabled: false }));
    const result = await renderPublicStorefront("token-1", "index");
    expect(result).toBeNull();
    expect(renderTemplate).not.toHaveBeenCalled();
  });

  it("returns null instead of throwing when configurationJson is corrupt", async () => {
    projectFindUnique.mockResolvedValue(project({ configurationJson: { garbage: true } }));
    const result = await renderPublicStorefront("token-1", "index");
    expect(result).toBeNull();
  });

  it("never queries the shopifyStore relation", async () => {
    projectFindUnique.mockResolvedValue(project());
    await renderPublicStorefront("token-1", "index");
    const call = projectFindUnique.mock.calls[0][0];
    expect(JSON.stringify(call.include)).not.toContain("shopifyStore");
  });

  it("renders the requested page's template", async () => {
    projectFindUnique.mockResolvedValue(project());
    await renderPublicStorefront("token-1", "product");
    expect(renderTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ templateName: "product", template: configuration.templates.product }),
    );
  });

  it("applies the selectedImagesJson override onto the rendered product", async () => {
    projectFindUnique.mockResolvedValue(
      project({
        selectedImagesJson: {
          images: [{ id: "1", url: "https://example.com/selected.jpg", altText: null, source: "web" }],
        },
      }),
    );
    await renderPublicStorefront("token-1", "index");
    const call = renderTemplate.mock.calls[0][0];
    expect(call.product.images).toEqual([{ url: "https://example.com/selected.jpg", altText: null }]);
  });

  it("returns the rendered html on success", async () => {
    projectFindUnique.mockResolvedValue(project());
    const result = await renderPublicStorefront("token-1", "index");
    expect(result).toEqual({ html: "<!doctype html><html></html>" });
  });
});
