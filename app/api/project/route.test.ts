import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { signedSessionCookieHeader } from "@/lib/auth/test-helpers";

const OWNER_ID = "user-1";

const productFindUnique = vi.fn();
const storeFindUnique = vi.fn();
const storeCreate = vi.fn();
const storeUpdate = vi.fn();
const projectCreate = vi.fn();
const projectCount = vi.fn();

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    product: { findUnique: (...args: unknown[]) => productFindUnique(...args) },
    store: {
      findUnique: (...args: unknown[]) => storeFindUnique(...args),
      create: (...args: unknown[]) => storeCreate(...args),
      update: (...args: unknown[]) => storeUpdate(...args),
    },
    project: {
      create: (...args: unknown[]) => projectCreate(...args),
      count: (...args: unknown[]) => projectCount(...args),
    },
  },
}));

vi.mock("@/lib/store-config/seed-theme", () => ({
  seedThemeConfiguration: vi.fn(async () => ({ version: 2, templates: { index: {}, product: {} }, generatedAt: null })),
}));

const { POST } = await import("./route");

async function request(body: unknown, userId: string = OWNER_ID) {
  return new NextRequest("http://localhost/api/project", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: await signedSessionCookieHeader(userId) },
    body: JSON.stringify(body),
  });
}

const PRODUCT = { id: "product-1", title: "Bag", personaOptionsJson: null, marketingAnglesJson: null, imageCandidatesJson: null };

describe("POST /api/project", () => {
  beforeEach(() => {
    productFindUnique.mockReset();
    storeFindUnique.mockReset();
    storeCreate.mockReset();
    storeUpdate.mockReset();
    projectCreate.mockReset();
    projectCount.mockReset();
  });

  it("creates a new Store and its first theme when no storeId is given", async () => {
    productFindUnique.mockResolvedValue(PRODUCT);
    storeCreate.mockResolvedValue({ id: "store-1", productId: "product-1", name: "Bag", ownerId: OWNER_ID });
    projectCreate.mockResolvedValue({ id: "project-1", storeId: "store-1", name: "Theme 1" });
    storeUpdate.mockResolvedValue({ id: "store-1", activeThemeId: "project-1" });

    const res = await POST(await request({ productId: "product-1" }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(storeCreate).toHaveBeenCalledWith({ data: { name: "Bag", productId: "product-1", ownerId: OWNER_ID } });
    expect(projectCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ storeId: "store-1", name: "Theme 1" }) }),
    );
    expect(storeUpdate).toHaveBeenCalledWith({ where: { id: "store-1" }, data: { activeThemeId: "project-1" } });
    expect(body.storeId).toBe("store-1");
  });

  it("adds a sibling theme to an existing store without touching activeThemeId", async () => {
    productFindUnique.mockResolvedValue(PRODUCT);
    storeFindUnique.mockResolvedValue({ id: "store-1", productId: "product-1", ownerId: OWNER_ID });
    projectCount.mockResolvedValue(1);
    projectCreate.mockResolvedValue({ id: "project-2", storeId: "store-1", name: "Theme 2" });

    const res = await POST(await request({ productId: "product-1", storeId: "store-1" }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(storeCreate).not.toHaveBeenCalled();
    expect(storeUpdate).not.toHaveBeenCalled();
    expect(projectCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ storeId: "store-1", name: "Theme 2" }) }),
    );
    expect(body.project.id).toBe("project-2");
  });

  it("rejects a storeId whose product doesn't match the given productId", async () => {
    productFindUnique.mockResolvedValue(PRODUCT);
    storeFindUnique.mockResolvedValue({ id: "store-1", productId: "some-other-product", ownerId: OWNER_ID });

    const res = await POST(await request({ productId: "product-1", storeId: "store-1" }));

    expect(res.status).toBe(400);
    expect(projectCreate).not.toHaveBeenCalled();
  });

  it("returns 404 when storeId doesn't exist", async () => {
    productFindUnique.mockResolvedValue(PRODUCT);
    storeFindUnique.mockResolvedValue(null);

    const res = await POST(await request({ productId: "product-1", storeId: "missing-store" }));

    expect(res.status).toBe(404);
    expect(projectCreate).not.toHaveBeenCalled();
  });

  it("returns 404 when the caller doesn't own the given storeId", async () => {
    productFindUnique.mockResolvedValue(PRODUCT);
    storeFindUnique.mockResolvedValue({ id: "store-1", productId: "product-1", ownerId: "someone-else" });

    const res = await POST(await request({ productId: "product-1", storeId: "store-1" }));

    expect(res.status).toBe(404);
    expect(projectCreate).not.toHaveBeenCalled();
  });

  it("returns 401 when the caller has no session", async () => {
    const req = new NextRequest("http://localhost/api/project", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ productId: "product-1" }),
    });

    const res = await POST(req);

    expect(res.status).toBe(401);
  });
});
