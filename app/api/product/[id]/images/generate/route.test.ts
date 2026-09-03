import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { signedSessionCookieHeader } from "@/lib/auth/test-helpers";

const OWNER_ID = "user-1";

const productFindUnique = vi.fn();
const productUpdate = vi.fn();

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    product: {
      findUnique: (...args: unknown[]) => productFindUnique(...args),
      update: (...args: unknown[]) => productUpdate(...args),
    },
  },
}));

const editProductImage = vi.fn();
vi.mock("@/lib/ai/image-editor", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/image-editor")>();
  return { ...actual, editProductImage: (...args: unknown[]) => editProductImage(...args) };
});

const { POST } = await import("./route");

const params = Promise.resolve({ id: "product-1" });

async function postRequest(body: unknown) {
  return new NextRequest("http://localhost/api/product/product-1/images/generate", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: await signedSessionCookieHeader(OWNER_ID) },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  productFindUnique.mockReset();
  productUpdate.mockReset();
  editProductImage.mockReset();
  productFindUnique.mockResolvedValue({ id: "product-1", generatedImagesJson: [] });
});

describe("POST /api/product/:id/images/generate", () => {
  it("returns 400 without calling editProductImage when instruction is missing", async () => {
    const res = await POST(await postRequest({ mode: "generate" }), { params });
    expect(res.status).toBe(400);
    expect(editProductImage).not.toHaveBeenCalled();
  });

  it("returns 400 for an unknown mode", async () => {
    const res = await POST(await postRequest({ instruction: "x", mode: "not-a-mode" }), { params });
    expect(res.status).toBe(400);
    expect(editProductImage).not.toHaveBeenCalled();
  });

  it("returns 400 when mode is \"edit\" with no sourceImageUrl, without calling editProductImage", async () => {
    const res = await POST(await postRequest({ instruction: "edit it", mode: "edit" }), { params });
    expect(res.status).toBe(400);
    expect(editProductImage).not.toHaveBeenCalled();
  });

  it("returns 404 when the product doesn't exist", async () => {
    productFindUnique.mockResolvedValue(null);
    const res = await POST(await postRequest({ instruction: "x", mode: "generate" }), { params });
    expect(res.status).toBe(404);
    expect(editProductImage).not.toHaveBeenCalled();
  });

  it("501s and persists nothing when generation is disabled — the flag, not this route, is the enforcement point", async () => {
    editProductImage.mockResolvedValue({ ok: false, reason: "disabled", message: "AI image generation is turned off for this project." });

    const res = await POST(await postRequest({ instruction: "x", mode: "generate" }), { params });

    expect(res.status).toBe(501);
    expect(productUpdate).not.toHaveBeenCalled();
  });

  it("502s on a provider failure and persists nothing", async () => {
    editProductImage.mockResolvedValue({ ok: false, reason: "provider-error", message: "boom" });

    const res = await POST(await postRequest({ instruction: "x", mode: "generate" }), { params });

    expect(res.status).toBe(502);
    expect(productUpdate).not.toHaveBeenCalled();
  });

  it("on success: calls editProductImage with the reference image, appends to generatedImagesJson, returns the image", async () => {
    editProductImage.mockResolvedValue({ ok: true, url: "https://cdn.example.com/result.jpg" });
    productUpdate.mockResolvedValue({});

    const res = await POST(
      await postRequest({
        instruction: "put it on a beach",
        mode: "edit",
        sourceImageUrl: "https://cdn.example.com/source.jpg",
        aspect: "square",
      }),
      { params },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.image).toMatchObject({
      url: "https://cdn.example.com/result.jpg",
      prompt: "put it on a beach",
      sourceImageUrl: "https://cdn.example.com/source.jpg",
      mode: "edit",
    });
    expect(editProductImage).toHaveBeenCalledWith(
      expect.objectContaining({
        instruction: "put it on a beach",
        mode: "edit",
        sourceImageUrl: "https://cdn.example.com/source.jpg",
        aspect: "square",
      }),
    );
    expect(productUpdate).toHaveBeenCalledWith({
      where: { id: "product-1" },
      data: { generatedImagesJson: [expect.objectContaining({ url: "https://cdn.example.com/result.jpg" })] },
    });
  });

  it("appends onto an existing generatedImagesJson log rather than replacing it", async () => {
    productFindUnique.mockResolvedValue({
      id: "product-1",
      generatedImagesJson: [{ id: "prev", url: "https://cdn.example.com/prev.jpg", prompt: "p", sourceImageUrl: null, mode: "generate", createdAt: "2026-01-01T00:00:00.000Z" }],
    });
    editProductImage.mockResolvedValue({ ok: true, url: "https://cdn.example.com/new.jpg" });
    productUpdate.mockResolvedValue({});

    await POST(await postRequest({ instruction: "new one", mode: "generate" }), { params });

    const [[{ data }]] = productUpdate.mock.calls;
    expect(data.generatedImagesJson).toHaveLength(2);
    expect(data.generatedImagesJson[0].id).toBe("prev");
  });
});
