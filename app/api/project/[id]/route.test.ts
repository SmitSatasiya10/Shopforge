import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const projectFindUnique = vi.fn();
const projectUpdate = vi.fn();

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    project: {
      findUnique: (...args: unknown[]) => projectFindUnique(...args),
      update: (...args: unknown[]) => projectUpdate(...args),
    },
  },
}));

const { GET, PATCH } = await import("./route");

const params = Promise.resolve({ id: "theme-1" });

function getRequest() {
  return new NextRequest("http://localhost/api/project/theme-1");
}

function project(overrides: Record<string, unknown> = {}) {
  return {
    id: "theme-1",
    name: "Theme 1",
    storeId: "store-1",
    configurationJson: { version: 2 },
    selectedImagesJson: null,
    installedThemeShopifyId: null,
    publicPreviewEnabled: false,
    publicPreviewToken: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-02"),
    store: {
      productId: "product-1",
      name: "Store 1",
      activeThemeId: "theme-1",
      shopifyStore: null,
      product: {
        id: "product-1",
        title: "Aurora Merino Crew",
        description: "A midweight merino crew knit.",
        price: 128,
        compareAtPrice: null,
        currency: "USD",
        vendor: "Northwake",
        images: [{ url: "https://example.com/original.jpg", altText: "Original" }],
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

describe("GET /api/project/:id", () => {
  beforeEach(() => {
    projectFindUnique.mockReset();
  });

  it("returns the project and its product, unaffected by the toProductDTOWithOverrides refactor", async () => {
    projectFindUnique.mockResolvedValue(project());

    const res = await GET(getRequest(), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.project).toEqual({
      id: "theme-1",
      name: "Theme 1",
      productId: "product-1",
      storeId: "store-1",
      storeName: "Store 1",
      storeActiveThemeId: "theme-1",
      configurationJson: { version: 2 },
      shopifyShopDomain: null,
      installedThemeShopifyId: null,
      publicPreviewEnabled: false,
      publicPreviewToken: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    expect(body.product.images).toEqual([{ url: "https://example.com/original.jpg", altText: "Original" }]);
  });

  it("still applies the selectedImagesJson override onto the returned product", async () => {
    projectFindUnique.mockResolvedValue(
      project({
        selectedImagesJson: {
          images: [{ id: "1", url: "https://example.com/selected.jpg", altText: null, source: "web" }],
        },
      }),
    );

    const res = await GET(getRequest(), { params });
    const body = await res.json();

    expect(body.product.images).toEqual([{ url: "https://example.com/selected.jpg", altText: null }]);
  });

  it("returns 404 when the project doesn't exist", async () => {
    projectFindUnique.mockResolvedValue(null);

    const res = await GET(getRequest(), { params });

    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/project/:id", () => {
  beforeEach(() => {
    projectUpdate.mockReset();
  });

  it("renames the theme", async () => {
    projectUpdate.mockResolvedValue({ id: "theme-1", name: "New name" });
    const req = new NextRequest("http://localhost/api/project/theme-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "New name" }),
    });

    const res = await PATCH(req, { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.project.name).toBe("New name");
  });
});
