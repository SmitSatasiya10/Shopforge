import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { signedSessionCookieHeader } from "@/lib/auth/test-helpers";

const OWNER_ID = "user-1";
const OTHER_USER_ID = "user-2";

const storeFindUnique = vi.fn();
const projectFindFirst = vi.fn();
const projectUpdate = vi.fn();

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    store: {
      findUnique: (...args: unknown[]) => storeFindUnique(...args),
    },
    project: {
      findFirst: (...args: unknown[]) => projectFindFirst(...args),
      update: (...args: unknown[]) => projectUpdate(...args),
    },
  },
}));

const { PATCH } = await import("./route");

const params = Promise.resolve({ id: "store-1", themeId: "theme-2" });

async function request(body: unknown, userId: string = OWNER_ID) {
  return new NextRequest("http://localhost/api/store/store-1/theme/theme-2/public-link", {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie: await signedSessionCookieHeader(userId) },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/store/:id/theme/:themeId/public-link", () => {
  beforeEach(() => {
    storeFindUnique.mockReset();
    storeFindUnique.mockResolvedValue({ ownerId: OWNER_ID });
    projectFindFirst.mockReset();
    projectUpdate.mockReset();
  });

  it("generates and persists a token+expiry when enabling a theme that has none yet", async () => {
    projectFindFirst.mockResolvedValue({ publicPreviewToken: null, publicPreviewExpiresAt: null });
    projectUpdate.mockResolvedValue({
      publicPreviewEnabled: true,
      publicPreviewToken: "generated-token",
      publicPreviewExpiresAt: new Date(),
    });

    const res = await PATCH(await request({ enabled: true }), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.publicPreviewEnabled).toBe(true);
    expect(body.publicPreviewToken).toBeTruthy();
    const data = projectUpdate.mock.calls[0][0].data;
    expect(data.publicPreviewEnabled).toBe(true);
    expect(typeof data.publicPreviewToken).toBe("string");
    expect(data.publicPreviewToken.length).toBeGreaterThan(0);
    expect(data.publicPreviewExpiresAt).toBeInstanceOf(Date);
  });

  it("reuses the existing token when re-enabling a theme whose link hasn't expired", async () => {
    const notExpired = new Date(Date.now() + 24 * 60 * 60 * 1000);
    projectFindFirst.mockResolvedValue({ publicPreviewToken: "existing-token", publicPreviewExpiresAt: notExpired });
    projectUpdate.mockResolvedValue({
      publicPreviewEnabled: true,
      publicPreviewToken: "existing-token",
      publicPreviewExpiresAt: notExpired,
    });

    await PATCH(await request({ enabled: true }), { params });

    const data = projectUpdate.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("publicPreviewToken");
    expect(data).not.toHaveProperty("publicPreviewExpiresAt");
  });

  it("mints a fresh token+expiry when re-enabling a theme whose link already expired", async () => {
    const expired = new Date(Date.now() - 1000);
    projectFindFirst.mockResolvedValue({ publicPreviewToken: "old-token", publicPreviewExpiresAt: expired });
    projectUpdate.mockResolvedValue({
      publicPreviewEnabled: true,
      publicPreviewToken: "new-token",
      publicPreviewExpiresAt: new Date(),
    });

    await PATCH(await request({ enabled: true }), { params });

    const data = projectUpdate.mock.calls[0][0].data;
    expect(typeof data.publicPreviewToken).toBe("string");
    expect(data.publicPreviewExpiresAt).toBeInstanceOf(Date);
  });

  it("mints a fresh token+expiry when rotate is requested even if the link hasn't expired", async () => {
    const notExpired = new Date(Date.now() + 24 * 60 * 60 * 1000);
    projectFindFirst.mockResolvedValue({ publicPreviewToken: "old-token", publicPreviewExpiresAt: notExpired });
    projectUpdate.mockResolvedValue({
      publicPreviewEnabled: true,
      publicPreviewToken: "new-token",
      publicPreviewExpiresAt: new Date(),
    });

    await PATCH(await request({ enabled: true, rotate: true }), { params });

    const data = projectUpdate.mock.calls[0][0].data;
    expect(typeof data.publicPreviewToken).toBe("string");
    expect(data.publicPreviewExpiresAt).toBeInstanceOf(Date);
  });

  it("disabling flips the flag but never clears or rotates the token", async () => {
    projectFindFirst.mockResolvedValue({ publicPreviewToken: "existing-token", publicPreviewExpiresAt: null });
    projectUpdate.mockResolvedValue({
      publicPreviewEnabled: false,
      publicPreviewToken: "existing-token",
      publicPreviewExpiresAt: null,
    });

    const res = await PATCH(await request({ enabled: false }), { params });
    const body = await res.json();

    expect(body.publicPreviewEnabled).toBe(false);
    expect(body.publicPreviewToken).toBe("existing-token");
    const data = projectUpdate.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("publicPreviewToken");
    expect(data).not.toHaveProperty("publicPreviewExpiresAt");
  });

  it("returns 404 when the theme doesn't belong to this store", async () => {
    projectFindFirst.mockResolvedValue(null);

    const res = await PATCH(await request({ enabled: true }), { params });

    expect(res.status).toBe(404);
    expect(projectUpdate).not.toHaveBeenCalled();
  });

  it("returns 400 when enabled is missing/not a boolean", async () => {
    const res = await PATCH(await request({}), { params });
    expect(res.status).toBe(400);
    expect(projectFindFirst).not.toHaveBeenCalled();
  });

  it("returns 404 when the caller doesn't own the store", async () => {
    const res = await PATCH(await request({ enabled: true }, OTHER_USER_ID), { params });

    expect(res.status).toBe(404);
    expect(projectFindFirst).not.toHaveBeenCalled();
  });

  it("returns 401 when the caller has no session", async () => {
    const req = new NextRequest("http://localhost/api/store/store-1/theme/theme-2/public-link", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });

    const res = await PATCH(req, { params });

    expect(res.status).toBe(401);
  });
});
