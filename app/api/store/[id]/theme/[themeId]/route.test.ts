import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { signedSessionCookieHeader } from "@/lib/auth/test-helpers";

const OWNER_ID = "user-1";

const storeFindUnique = vi.fn();
const projectFindFirst = vi.fn();
const projectDelete = vi.fn();

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    store: { findUnique: (...args: unknown[]) => storeFindUnique(...args) },
    project: {
      findFirst: (...args: unknown[]) => projectFindFirst(...args),
      delete: (...args: unknown[]) => projectDelete(...args),
    },
  },
}));

const { DELETE } = await import("./route");

const params = Promise.resolve({ id: "store-1", themeId: "theme-2" });

async function request() {
  return new NextRequest("http://localhost/api/store/store-1/theme/theme-2", {
    method: "DELETE",
    headers: { cookie: await signedSessionCookieHeader(OWNER_ID) },
  });
}

describe("DELETE /api/store/:id/theme/:themeId", () => {
  beforeEach(() => {
    storeFindUnique.mockReset();
    projectFindFirst.mockReset();
    projectDelete.mockReset();
  });

  it("deletes a non-active draft theme", async () => {
    storeFindUnique.mockResolvedValue({ ownerId: OWNER_ID, activeThemeId: "theme-1" });
    projectFindFirst.mockResolvedValue({ id: "theme-2", storeId: "store-1" });

    const res = await DELETE(await request(), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.deleted).toBe(true);
    expect(projectDelete).toHaveBeenCalledWith({ where: { id: "theme-2" } });
  });

  it("refuses to delete the store's active theme", async () => {
    storeFindUnique.mockResolvedValue({ ownerId: OWNER_ID, activeThemeId: "theme-2" });
    projectFindFirst.mockResolvedValue({ id: "theme-2", storeId: "store-1" });

    const res = await DELETE(await request(), { params });

    expect(res.status).toBe(409);
    expect(projectDelete).not.toHaveBeenCalled();
  });

  it("returns 404 when the theme doesn't belong to this store", async () => {
    storeFindUnique.mockResolvedValue({ ownerId: OWNER_ID, activeThemeId: "theme-1" });
    projectFindFirst.mockResolvedValue(null);

    const res = await DELETE(await request(), { params });

    expect(res.status).toBe(404);
    expect(projectDelete).not.toHaveBeenCalled();
  });

  it("returns 404 when the caller doesn't own the store", async () => {
    storeFindUnique.mockResolvedValue({ ownerId: "someone-else", activeThemeId: "theme-1" });

    const res = await DELETE(await request(), { params });

    expect(res.status).toBe(404);
    expect(projectFindFirst).not.toHaveBeenCalled();
  });
});
