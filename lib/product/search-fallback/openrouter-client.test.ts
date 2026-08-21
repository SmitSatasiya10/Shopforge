import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { callOpenRouterChat, resolveSearchModel } from "./openrouter-client";

describe("resolveSearchModel", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to the search-native perplexity/sonar model", () => {
    vi.stubEnv("OPENROUTER_MODEL", "");
    expect(resolveSearchModel()).toEqual({ model: "perplexity/sonar", nativeSearch: true });
  });

  it("treats a non-perplexity override as a tool-driven model", () => {
    vi.stubEnv("OPENROUTER_MODEL", "openai/gpt-4.1-mini");
    expect(resolveSearchModel()).toEqual({ model: "openai/gpt-4.1-mini", nativeSearch: false });
  });
});

describe("callOpenRouterChat", () => {
  const fetchSpy = vi.spyOn(global, "fetch");

  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    fetchSpy.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const REQUEST = { systemPrompt: "system", userPrompt: "user", tools: [{ type: "openrouter:web_search" }] };

  it("fails without calling the network when OPENROUTER_API_KEY is unset", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const result = await callOpenRouterChat(REQUEST);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/OPENROUTER_API_KEY/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns the message content on success", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [{ message: { content: '{"matchType":"none"}' } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const result = await callOpenRouterChat(REQUEST);
    expect(result.ok).toBe(true);
    expect(result.ok && result.text).toBe('{"matchType":"none"}');
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("openrouter.ai"),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer test-key" }) }),
    );
  });

  it("surfaces url_citation annotations as citations, defaulting to [] when absent", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "answer",
                annotations: [
                  {
                    type: "url_citation",
                    url_citation: { url: "https://www.etsy.com/listing/1/mug", title: "Mug - Etsy" },
                  },
                  { type: "url_citation", url_citation: { url: "https://www.etsy.com/listing/2/bowl" } }, // no title
                  { type: "other", url_citation: { url: "https://ignored.example" } }, // wrong type
                  { type: "url_citation" }, // malformed
                ],
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const result = await callOpenRouterChat(REQUEST);
    expect(result.ok && result.citations).toEqual([
      { url: "https://www.etsy.com/listing/1/mug", title: "Mug - Etsy" },
      { url: "https://www.etsy.com/listing/2/bowl", title: null },
    ]);
  });

  it("returns empty citations when the message has no annotations", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }),
    );
    const result = await callOpenRouterChat(REQUEST);
    expect(result.ok && result.citations).toEqual([]);
  });

  it("omits the tools field entirely when no tools are passed (search-native models reject it)", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }),
    );
    await callOpenRouterChat({ ...REQUEST, tools: [] });
    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body).not.toHaveProperty("tools");
  });

  it("includes the tools field when tools are passed", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }),
    );
    await callOpenRouterChat(REQUEST);
    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body.tools).toEqual([{ type: "openrouter:web_search" }]);
  });

  it("maps a 401 to a clear credentials error", async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 401 }));
    const result = await callOpenRouterChat(REQUEST);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/rejected the configured API key/);
  });

  it("maps a 429 to a rate-limit error", async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 429 }));
    const result = await callOpenRouterChat(REQUEST);
    expect(!result.ok && result.error).toMatch(/rate-limiting/);
  });

  it("maps a network failure to an unreachable error, never throwing", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("network down"));
    const result = await callOpenRouterChat(REQUEST);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/Could not reach/);
  });

  it("handles malformed JSON without throwing", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("not json", { status: 200 }));
    const result = await callOpenRouterChat(REQUEST);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/unreadable/);
  });

  it("handles a response with no message content", async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [] }), { status: 200 }));
    const result = await callOpenRouterChat(REQUEST);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/empty response/);
  });
});
