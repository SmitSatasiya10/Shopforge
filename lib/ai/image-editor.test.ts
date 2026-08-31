import { describe, it, expect, vi, beforeEach } from "vitest";

// editProductImage() reaches requestImage() (lib/ai/images.ts), which is instrumented via the
// debug logger — mock the filesystem the same way lib/ai/images.test.ts and
// lib/ai/openrouter.test.ts do, so these tests never touch the real audit-log files.
vi.mock("node:fs", () => ({ existsSync: () => true }));
vi.mock("node:fs/promises", () => ({ appendFile: vi.fn(async () => {}), mkdir: vi.fn(async () => {}) }));

const requestImage = vi.fn();
vi.mock("./images", () => ({ requestImage: (...args: unknown[]) => requestImage(...args) }));

const { editProductImage, buildEditPrompt } = await import("./image-editor");

beforeEach(() => {
  requestImage.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("buildEditPrompt", () => {
  it("folds in aspect, style, and an exact claim without inventing extra text", () => {
    const prompt = buildEditPrompt({
      instruction: "Show it on a marble counter",
      mode: "edit",
      sourceImageUrl: "https://cdn.example.com/a.jpg",
      aspect: "square",
      stylePreset: "Minimal studio",
      claim: "30-day money-back guarantee",
    });

    expect(prompt).toContain("Show it on a marble counter");
    expect(prompt).toContain("Square composition");
    expect(prompt).toContain("Style: Minimal studio.");
    expect(prompt).toContain('Render this exact text prominently and legibly in the image: "30-day money-back guarantee"');
    expect(prompt).toContain("Do not add any other claims, prices, or text.");
  });

  it("omits the claim instruction entirely when no claim is given", () => {
    const prompt = buildEditPrompt({ instruction: "New shot", mode: "generate" });
    expect(prompt).not.toContain("exact text");
  });
});

describe("editProductImage", () => {
  it("off: never calls requestImage, returns a typed disabled result", async () => {
    const result = await editProductImage({
      instruction: "anything",
      mode: "generate",
      config: { generateImages: false, apiKey: "unusable" },
    });

    expect(requestImage).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, reason: "disabled", message: expect.any(String) });
  });

  it("edit mode with no reference image fails before calling requestImage", async () => {
    const result = await editProductImage({
      instruction: "edit it",
      mode: "edit",
      sourceImageUrl: null,
      config: { generateImages: true, apiKey: "key" },
    });

    expect(requestImage).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, reason: "no-reference", message: expect.any(String) });
  });

  it("on: calls requestImage with the built prompt and the reference image, returns the url", async () => {
    requestImage.mockResolvedValueOnce({ url: "https://cdn.example.com/result.jpg" });

    const result = await editProductImage({
      instruction: "put it on a beach",
      mode: "edit",
      sourceImageUrl: "https://cdn.example.com/source.jpg",
      config: { generateImages: true, apiKey: "key" },
    });

    expect(result).toEqual({ ok: true, url: "https://cdn.example.com/result.jpg" });
    expect(requestImage).toHaveBeenCalledTimes(1);
    const [prompt, , , referenceImageUrl] = requestImage.mock.calls[0];
    expect(prompt).toContain("put it on a beach");
    expect(referenceImageUrl).toBe("https://cdn.example.com/source.jpg");
  });

  it("returns a typed no-image result when the provider returns nothing, without throwing", async () => {
    requestImage.mockResolvedValueOnce(null);
    const result = await editProductImage({
      instruction: "x",
      mode: "generate",
      config: { generateImages: true, apiKey: "key" },
    });
    expect(result).toEqual({ ok: false, reason: "no-image", message: expect.any(String) });
  });

  it("returns a typed provider-error result when requestImage throws, without letting it propagate", async () => {
    requestImage.mockRejectedValueOnce(new Error("network down"));
    const result = await editProductImage({
      instruction: "x",
      mode: "generate",
      config: { generateImages: true, apiKey: "key" },
    });
    expect(result).toEqual({ ok: false, reason: "provider-error", message: "network down" });
  });

  it("fails with no-api-key when generation is on but no key is configured", async () => {
    const result = await editProductImage({
      instruction: "x",
      mode: "generate",
      config: { generateImages: true, apiKey: "" },
    });
    expect(requestImage).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, reason: "no-api-key", message: expect.any(String) });
  });
});
