import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { signedSessionCookieHeader } from "@/lib/auth/test-helpers";

const OWNER_ID = "user-1";

const projectUpdate = vi.fn();
const projectFindUnique = vi.fn();
const productFindUnique = vi.fn();
const recordCheckpoint = vi.fn();

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    project: {
      update: (...args: unknown[]) => projectUpdate(...args),
      findUnique: (...args: unknown[]) => projectFindUnique(...args),
    },
    product: {
      findUnique: (...args: unknown[]) => productFindUnique(...args),
    },
  },
}));

vi.mock("@/lib/history/checkpoint", () => ({
  recordCheckpoint: (...args: unknown[]) => recordCheckpoint(...args),
}));

const { PATCH } = await import("./route");

async function request(body: unknown) {
  return new NextRequest("http://localhost/api/project/project-1/configuration", {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie: await signedSessionCookieHeader(OWNER_ID) },
    body: JSON.stringify(body),
  });
}

const params = Promise.resolve({ id: "project-1" });
const NOW = "2026-08-30T12:00:00.000Z";

describe("PATCH /api/project/:id/configuration", () => {
  beforeEach(() => {
    projectUpdate.mockReset();
    projectFindUnique.mockReset();
    productFindUnique.mockReset();
    recordCheckpoint.mockReset();
    // Default: the caller owns the project — the ownership pre-check's findUnique call shares
    // this mock with the route's own findUnique calls, so tests that don't care about ownership
    // still need it to resolve to an owned record.
    projectFindUnique.mockResolvedValue({ store: { ownerId: OWNER_ID } });
  });

  it("applies the write and records a checkpoint when expectedUpdatedAt matches", async () => {
    projectUpdate.mockResolvedValue({
      id: "project-1",
      store: { productId: "product-1" },
      configurationJson: { a: 1 },
    });
    productFindUnique.mockResolvedValue({ title: "Bag" });

    const res = await PATCH(await request({ configuration: { a: 1 }, expectedUpdatedAt: NOW }), { params });

    expect(res.status).toBe(200);
    expect(projectUpdate).toHaveBeenCalledWith({
      where: { id: "project-1", updatedAt: new Date(NOW) },
      data: { configurationJson: { a: 1 } },
      include: { store: { select: { productId: true } } },
    });
    expect(productFindUnique).toHaveBeenCalledWith({
      where: { id: "product-1" },
      select: { title: true },
    });
    expect(recordCheckpoint).toHaveBeenCalledWith("project-1", {
      configurationJson: { a: 1 },
      productTitle: "Bag",
    });
  });

  it("returns 409 and skips the checkpoint when expectedUpdatedAt is stale", async () => {
    projectUpdate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("no record", { code: "P2025", clientVersion: "7.9.1" }),
    );
    const fresherUpdatedAt = new Date("2026-08-30T12:05:00.000Z");
    projectFindUnique.mockResolvedValue({ store: { ownerId: OWNER_ID }, updatedAt: fresherUpdatedAt });

    const res = await PATCH(await request({ configuration: { a: 1 }, expectedUpdatedAt: NOW }), { params });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.currentUpdatedAt).toBe(fresherUpdatedAt.toISOString());
    expect(recordCheckpoint).not.toHaveBeenCalled();
  });

  it("returns 404 when the project no longer exists", async () => {
    projectUpdate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("no record", { code: "P2025", clientVersion: "7.9.1" }),
    );
    projectFindUnique.mockResolvedValue(null);

    const res = await PATCH(await request({ configuration: { a: 1 }, expectedUpdatedAt: NOW }), { params });

    expect(res.status).toBe(404);
    expect(recordCheckpoint).not.toHaveBeenCalled();
  });

  it("rejects a request missing expectedUpdatedAt", async () => {
    const res = await PATCH(await request({ configuration: { a: 1 } }), { params });

    expect(res.status).toBe(400);
    expect(projectUpdate).not.toHaveBeenCalled();
  });

  it("rejects a request with a malformed expectedUpdatedAt", async () => {
    const res = await PATCH(await request({ configuration: { a: 1 }, expectedUpdatedAt: "not-a-date" }), { params });

    expect(res.status).toBe(400);
    expect(projectUpdate).not.toHaveBeenCalled();
  });

  it("returns 404 when the caller doesn't own the project's store", async () => {
    projectFindUnique.mockResolvedValue({ store: { ownerId: "someone-else" } });

    const res = await PATCH(await request({ configuration: { a: 1 }, expectedUpdatedAt: NOW }), { params });

    expect(res.status).toBe(404);
    expect(projectUpdate).not.toHaveBeenCalled();
  });
});
