import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { signedSessionCookieHeader } from "@/lib/auth/test-helpers";

const OWNER_ID = "user-1";

const storeFindUnique = vi.fn();
const projectFindFirst = vi.fn();
const projectCreate = vi.fn();
const projectCount = vi.fn();

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    store: { findUnique: (...args: unknown[]) => storeFindUnique(...args) },
    project: {
      findFirst: (...args: unknown[]) => projectFindFirst(...args),
      create: (...args: unknown[]) => projectCreate(...args),
      count: (...args: unknown[]) => projectCount(...args),
    },
  },
}));

vi.mock("@/lib/store-config/seed-theme", () => ({
  seedThemeConfiguration: vi.fn(async () => ({ version: 2, templates: { index: {}, product: {} }, generatedAt: null })),
}));

const { POST } = await import("./route");

async function request(body: unknown) {
  return new NextRequest("http://localhost/api/store/store-1/theme", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: await signedSessionCookieHeader(OWNER_ID) },
    body: JSON.stringify(body),
  });
}

const params = Promise.resolve({ id: "store-1" });
const STORE = { id: "store-1", ownerId: OWNER_ID, product: { id: "product-1", title: "Bag" } };

describe("POST /api/store/:id/theme", () => {
  beforeEach(() => {
    storeFindUnique.mockReset();
    projectFindFirst.mockReset();
    projectCreate.mockReset();
    projectCount.mockReset();
  });

  it("creates a blank theme seeded from the Base Theme defaults", async () => {
    storeFindUnique.mockResolvedValue(STORE);
    projectCount.mockResolvedValue(2);
    projectCreate.mockResolvedValue({ id: "theme-3", name: "Theme 3" });

    const res = await POST(await request({}), { params });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(projectCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ storeId: "store-1", name: "Theme 3" }) }),
    );
    expect(body.project.id).toBe("theme-3");
  });

  it("duplicates an existing theme, copying content but resetting Shopify install state", async () => {
    storeFindUnique.mockResolvedValue(STORE);
    const source = {
      id: "theme-1",
      storeId: "store-1",
      name: "Default",
      configurationJson: { version: 2, templates: {} },
      language: "en",
      personaJson: { type: "custom", text: "eco-conscious shoppers" },
      marketingAngleJson: null,
      selectedImagesJson: null,
    };
    projectFindFirst.mockResolvedValue(source);
    projectCreate.mockResolvedValue({ id: "theme-2", name: "Copy of Default" });

    const res = await POST(await request({ duplicateFrom: "theme-1" }), { params });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(projectFindFirst).toHaveBeenCalledWith({ where: { id: "theme-1", storeId: "store-1" } });
    const createArgs = projectCreate.mock.calls[0][0];
    expect(createArgs.data.name).toBe("Copy of Default");
    expect(createArgs.data.configurationJson).toEqual(source.configurationJson);
    expect(createArgs.data.personaJson).toEqual(source.personaJson);
    // installedThemeShopifyId is never part of the create payload — a duplicate always starts uninstalled.
    expect(createArgs.data.installedThemeShopifyId).toBeUndefined();
    expect(body.project.id).toBe("theme-2");
  });

  it("rejects duplicating a theme that doesn't belong to this store", async () => {
    storeFindUnique.mockResolvedValue(STORE);
    projectFindFirst.mockResolvedValue(null);

    const res = await POST(await request({ duplicateFrom: "theme-from-another-store" }), { params });

    expect(res.status).toBe(400);
    expect(projectCreate).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown store", async () => {
    storeFindUnique.mockResolvedValue(null);

    const res = await POST(await request({}), { params });

    expect(res.status).toBe(404);
  });
});
