import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// chat() is instrumented via the debug logger, which appends every request to
// docs/ai-prompt-token-audit-logs.md (lib/ai/debug-logger.ts). Mock the filesystem so these
// tests never touch the real file — the audit-log write path itself is covered by
// debug-logger.test.ts.
vi.mock("node:fs", () => ({ existsSync: () => true }));
vi.mock("node:fs/promises", () => ({ appendFile: vi.fn(async () => {}), mkdir: vi.fn(async () => {}) }));

// Wraps the real logAIRequestInput (not a stub) so these tests can assert on the exact args
// chat() forwarded to it, without changing debug-logger's own behavior — that's covered by
// debug-logger.test.ts.
vi.mock("./debug-logger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./debug-logger")>();
  return { ...actual, logAIRequestInput: vi.fn(actual.logAIRequestInput) };
});

import { chat, parseJsonResponse, OpenRouterError } from "./openrouter";
import { logAIRequestInput } from "./debug-logger";
import { part } from "./prompt-breakdown";
import type { AiConfig } from "./config";

// Instrumenting chat() with the debug logger (ai-request-debug-logging.md) must not change
// what it returns or throws — these tests pin down the exact pre-existing behavior with
// fetch mocked, independent of whether AI_DEBUG_LOGS is on or off.

const config: AiConfig = {
  apiKey: "test-key",
  model: "test-model",
  baseUrl: "https://openrouter.example/api/v1",
  generateImages: false,
  imageModel: "test-image-model",
};

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe("chat()", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    (logAIRequestInput as unknown as ReturnType<typeof vi.fn>).mockClear();
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    vi.restoreAllMocks();
    delete process.env.AI_DEBUG_LOGS;
  });

  it("returns the model's content unchanged", async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({ choices: [{ message: { content: '{"hello":"world"}' } }] }),
    );
    const result = await chat({ config, messages: [{ role: "user", content: "hi" }] });
    expect(result).toBe('{"hello":"world"}');
    expect(parseJsonResponse(result)).toEqual({ hello: "world" });
  });

  it("throws OpenRouterError with the same message/status on a non-ok response", async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ error: "nope" }, { ok: false, status: 502 }));
    await expect(chat({ config, messages: [{ role: "user", content: "hi" }] })).rejects.toMatchObject({
      status: 502,
    });
  });

  it("throws OpenRouterError when the provider returns no content", async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ choices: [{ message: {} }] }));
    await expect(chat({ config, messages: [{ role: "user", content: "hi" }] })).rejects.toBeInstanceOf(
      OpenRouterError,
    );
  });

  it("returns the same content whether or not AI_DEBUG_LOGS is enabled", async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ choices: [{ message: { content: "same output" } }] }));
    process.env.AI_DEBUG_LOGS = "true";
    const withDebug = await chat({ config, messages: [{ role: "user", content: "hi" }] });
    process.env.AI_DEBUG_LOGS = "false";
    const withoutDebug = await chat({ config, messages: [{ role: "user", content: "hi" }] });
    expect(withDebug).toBe("same output");
    expect(withoutDebug).toBe("same output");
  });

  it("does not send usage in the request body (provider-side field, read from the response only)", async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({
        choices: [{ message: { content: "ok" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    );
    await chat({ config, messages: [{ role: "user", content: "hi" }] });
    const sentBody = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(sentBody).not.toHaveProperty("usage");
  });

  it("forwards promptBreakdown/generationMeta to logAIRequestInput for the audit log, but never sends them to the provider", async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ choices: [{ message: { content: "ok" } }] }));
    const promptBreakdown = [part("product_data", "Product data", "hi")];
    const generationMeta = {
      pageType: "product" as const,
      sectionCount: 1,
      sections: [{ id: "hero", type: "slideshow" }],
      fixedBlockCount: 0,
      allowedBlockTypeMenuSize: 2,
      schemaChars: 10,
      contentChars: 5,
    };

    await chat({
      config,
      messages: [{ role: "user", content: "hi" }],
      promptBreakdown,
      generationMeta,
    });

    const mockedLogAIRequestInput = logAIRequestInput as unknown as ReturnType<typeof vi.fn>;
    const [, , extra] = mockedLogAIRequestInput.mock.calls[0];
    expect(extra.promptBreakdown).toBe(promptBreakdown);
    expect(extra.generationMeta).toBe(generationMeta);

    const sentBody = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(sentBody).not.toHaveProperty("promptBreakdown");
    expect(sentBody).not.toHaveProperty("generationMeta");
  });

  it("omits promptBreakdown/generationMeta from what reaches logAIRequestInput when the caller doesn't supply them", async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ choices: [{ message: { content: "ok" } }] }));
    await chat({ config, messages: [{ role: "user", content: "hi" }] });

    const mockedLogAIRequestInput = logAIRequestInput as unknown as ReturnType<typeof vi.fn>;
    const [, , extra] = mockedLogAIRequestInput.mock.calls[0];
    expect(extra.promptBreakdown).toBeUndefined();
    expect(extra.generationMeta).toBeUndefined();
  });
});
