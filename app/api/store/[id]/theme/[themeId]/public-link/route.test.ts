import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const projectFindFirst = vi.fn();
const projectUpdate = vi.fn();

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    project: {
      findFirst: (...args: unknown[]) => projectFindFirst(...args),
      update: (...args: unknown[]) => projectUpdate(...args),
    },
  },
}));

const { PATCH } = await import("./route");

const params = Promise.resolve({ id: "store-1", themeId: "theme-2" });

function request(body: unknown) {
  return new NextRequest("http://localhost/api/store/store-1/theme/theme-2/public-link", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/store/:id/theme/:themeId/public-link", () => {
  beforeEach(() => {
    projectFindFirst.mockReset();
    projectUpdate.mockReset();
  });

  it("generates and persists a token when enabling a theme that has none yet", async () => {
    projectFindFirst.mockResolvedValue({ publicPreviewToken: null });
    projectUpdate.mockResolvedValue({ publicPreviewEnabled: true, publicPreviewToken: "generated-token" });

    const res = await PATCH(request({ enabled: true }), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.publicPreviewEnabled).toBe(true);
    expect(body.publicPreviewToken).toBeTruthy();
    const data = projectUpdate.mock.calls[0][0].data;
    expect(data.publicPreviewEnabled).toBe(true);
    expect(typeof data.publicPreviewToken).toBe("string");
    expect(data.publicPreviewToken.length).toBeGreaterThan(0);
  });

  it("reuses the existing token when re-enabling a theme that already has one", async () => {
    projectFindFirst.mockResolvedValue({ publicPreviewToken: "existing-token" });
    projectUpdate.mockResolvedValue({ publicPreviewEnabled: true, publicPreviewToken: "existing-token" });

    await PATCH(request({ enabled: true }), { params });

    const data = projectUpdate.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("publicPreviewToken");
  });

  it("disabling flips the flag but never clears the token", async () => {
    projectFindFirst.mockResolvedValue({ publicPreviewToken: "existing-token" });
    projectUpdate.mockResolvedValue({ publicPreviewEnabled: false, publicPreviewToken: "existing-token" });

    const res = await PATCH(request({ enabled: false }), { params });
    const body = await res.json();

    expect(body.publicPreviewEnabled).toBe(false);
    expect(body.publicPreviewToken).toBe("existing-token");
    const data = projectUpdate.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("publicPreviewToken");
  });

  it("returns 404 when the theme doesn't belong to this store", async () => {
    projectFindFirst.mockResolvedValue(null);

    const res = await PATCH(request({ enabled: true }), { params });

    expect(res.status).toBe(404);
    expect(projectUpdate).not.toHaveBeenCalled();
  });

  it("returns 400 when enabled is missing/not a boolean", async () => {
    const res = await PATCH(request({}), { params });
    expect(res.status).toBe(400);
    expect(projectFindFirst).not.toHaveBeenCalled();
  });
});
