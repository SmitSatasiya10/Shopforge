import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { part, type GenerationMeta } from "./prompt-breakdown";

// The logger persists every request across three files under docs/ (see persistAuditLog in
// ./debug-logger): a scannable table (ai-prompt-token-audit-logs.md), full per-request detail
// entries (ai-prompt-token-audit-details.md), and a regenerated summary
// (ai-prompt-token-audit-summary.md). Mocking node:fs/node:fs/promises here means every test
// in this file exercises that real code path — the same appendFile/readFile/writeFile/mkdir
// calls production uses — without ever touching the real files or spending API credits.
// readFileMock plays back whatever has been appended to the table file so far, so
// regenerateAuditSummary() genuinely parses real (mocked) table content, not a stub.
const { existsSyncMock, appendFileMock, mkdirMock, readFileMock, writeFileMock, resetAuditFsState } = vi.hoisted(() => {
  let tableContent = "";
  const appendFileMock = vi.fn<(filePath: string, data: string, encoding?: string) => Promise<void>>(
    async (filePath, data) => {
      if (filePath.includes("ai-prompt-token-audit-logs.md")) tableContent += data;
    },
  );
  const readFileMock = vi.fn<(filePath: string, encoding?: string) => Promise<string>>(async (filePath) => {
    if (filePath.includes("ai-prompt-token-audit-logs.md")) return tableContent;
    const err = new Error("ENOENT: no such file") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    throw err;
  });
  return {
    existsSyncMock: vi.fn<(filePath: string) => boolean>(() => true),
    appendFileMock,
    mkdirMock: vi.fn<(dirPath: string, options?: { recursive: boolean }) => Promise<void>>(async () => {}),
    readFileMock,
    writeFileMock: vi.fn<(filePath: string, data: string, encoding?: string) => Promise<void>>(async () => {}),
    resetAuditFsState: () => {
      tableContent = "";
    },
  };
});
vi.mock("node:fs", () => ({ existsSync: existsSyncMock }));
vi.mock("node:fs/promises", () => ({
  appendFile: appendFileMock,
  mkdir: mkdirMock,
  readFile: readFileMock,
  writeFile: writeFileMock,
}));

import {
  startAIRequest,
  logAIRequestInput,
  logAIRequestOutput,
  finishAIRequest,
  logAIRequestError,
  withAIContext,
  withAITrace,
} from "./debug-logger";

// The central logger is pure observability (ai-request-debug-logging.md): every function
// here only ever writes to the console/audit files and returns void/whatever `fn` returns, so
// these tests assert on console and (mocked) file output rather than on application state.

function allLogOutput(spy: ReturnType<typeof vi.spyOn>): string {
  return spy.mock.calls.map((call: unknown[]) => call.join(" ")).join("\n");
}

/** Waits for the fire-and-forget persistAuditLog() promise chain (table row -> details entry -> summary) to resolve before assertions run. */
async function flushAuditLogWrites(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

function appendedTo(pathSubstring: string): string {
  return appendFileMock.mock.calls
    .filter((call) => call[0].includes(pathSubstring))
    .map((call) => call[1])
    .join("");
}

function tableFileText(): string {
  return appendedTo("ai-prompt-token-audit-logs.md");
}

function detailsFileText(): string {
  return appendedTo("ai-prompt-token-audit-details.md");
}

/** The summary file is overwritten, not appended — the latest write wins. */
function summaryFileText(): string | undefined {
  const calls = writeFileMock.mock.calls.filter((call) => call[0].includes("ai-prompt-token-audit-summary.md"));
  return calls.length > 0 ? calls[calls.length - 1][1] : undefined;
}

describe("debug-logger", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    appendFileMock.mockClear();
    mkdirMock.mockClear();
    readFileMock.mockClear();
    writeFileMock.mockClear();
    resetAuditFsState();
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    delete process.env.AI_DEBUG_LOGS;
  });

  it("generates a request id for every request", () => {
    const handle = startAIRequest({ operation: "section-rewrite", model: "test-model" });
    expect(handle.requestId).toBeTruthy();
    expect(typeof handle.requestId).toBe("string");
  });

  it("uses the same request id across start, complete, and error logs", () => {
    const handle = startAIRequest({ operation: "section-rewrite", model: "test-model" });
    finishAIRequest(handle, { usage: null });
    const output = allLogOutput(logSpy);
    const occurrences = output.split(handle.requestId).length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2); // once in START, once in COMPLETE
  });

  it("logs the model", () => {
    const handle = startAIRequest({ operation: "generate-homepage", model: "anthropic/claude-sonnet-4.5" });
    finishAIRequest(handle, { usage: null });
    expect(allLogOutput(logSpy)).toContain("anthropic/claude-sonnet-4.5");
  });

  it("logs the operation", () => {
    const handle = startAIRequest({ operation: "generate-persona", model: "test-model" });
    finishAIRequest(handle, { usage: null });
    expect(allLogOutput(logSpy)).toContain("generate-persona");
  });

  it("calculates and logs a non-negative duration", () => {
    const handle = startAIRequest({ operation: "section-rewrite", model: "test-model" });
    finishAIRequest(handle, { usage: null });
    const match = allLogOutput(logSpy).match(/Duration: ([\d,]+) ms/);
    expect(match).not.toBeNull();
    expect(Number(match![1].replace(/,/g, ""))).toBeGreaterThanOrEqual(0);
  });

  it("captures provider-reported token usage", () => {
    const handle = startAIRequest({ operation: "section-rewrite", model: "test-model" });
    finishAIRequest(handle, { usage: { inputTokens: 4821, outputTokens: 1203, totalTokens: 6024 } });
    const output = allLogOutput(logSpy);
    expect(output).toContain("Input tokens: 4,821");
    expect(output).toContain("Output tokens: 1,203");
    expect(output).toContain("Total tokens: 6,024");
  });

  it("reports missing usage as unavailable, never a fabricated number", () => {
    const handle = startAIRequest({ operation: "section-rewrite", model: "test-model" });
    finishAIRequest(handle, { usage: null });
    const output = allLogOutput(logSpy);
    expect(output).toContain("Input tokens: unavailable");
    expect(output).toContain("Output tokens: unavailable");
    expect(output).toContain("Total tokens: unavailable");
    expect(output).not.toMatch(/Input tokens: \d/);
  });

  it("logs successful requests as SUCCESS", () => {
    const handle = startAIRequest({ operation: "section-rewrite", model: "test-model" });
    finishAIRequest(handle, { usage: null });
    expect(allLogOutput(logSpy)).toContain("Status: SUCCESS");
  });

  it("logs failed requests as ERROR via console.error", () => {
    const handle = startAIRequest({ operation: "section-rewrite", model: "test-model" });
    logAIRequestError(handle, new Error("OpenRouter returned 502: bad gateway"));
    const output = allLogOutput(errorSpy);
    expect(output).toContain("[AI REQUEST FAILED]");
    expect(output).toContain("Status: ERROR");
    expect(output).toContain("OpenRouter returned 502: bad gateway");
  });

  it("never logs API keys or bearer tokens, even if one ends up in prompt/output text", () => {
    process.env.AI_DEBUG_LOGS = "true";
    const secret = "sk-or-v1-abcdefghijklmnopqrstuvwxyz0123456789";
    const handle = startAIRequest({ operation: "section-rewrite", model: "test-model" });
    logAIRequestInput(handle, [{ role: "user", content: `Authorization: Bearer ${secret}` }]);
    logAIRequestOutput(handle, JSON.stringify({ note: `token=${secret}` }));
    const output = allLogOutput(logSpy);
    expect(output).not.toContain(secret);
    expect(output).toContain("[REDACTED]");
  });

  it("AI_DEBUG_LOGS=false suppresses full prompt/output content but keeps the summary blocks", () => {
    process.env.AI_DEBUG_LOGS = "false";
    const handle = startAIRequest({ operation: "section-rewrite", model: "test-model" });
    logAIRequestInput(handle, [{ role: "user", content: "UNIQUE_PROMPT_MARKER_12345" }]);
    logAIRequestOutput(handle, "UNIQUE_OUTPUT_MARKER_67890");
    finishAIRequest(handle, { usage: null });
    const output = allLogOutput(logSpy);
    expect(output).not.toContain("UNIQUE_PROMPT_MARKER_12345");
    expect(output).not.toContain("UNIQUE_OUTPUT_MARKER_67890");
    expect(output).toContain("[AI REQUEST START]");
    expect(output).toContain("[AI REQUEST COMPLETE]");
  });

  it("AI_DEBUG_LOGS=true prints full prompt and output content", () => {
    process.env.AI_DEBUG_LOGS = "true";
    const handle = startAIRequest({ operation: "section-rewrite", model: "test-model" });
    logAIRequestInput(handle, [{ role: "user", content: "UNIQUE_PROMPT_MARKER_12345" }]);
    logAIRequestOutput(handle, "UNIQUE_OUTPUT_MARKER_67890");
    const output = allLogOutput(logSpy);
    expect(output).toContain("UNIQUE_PROMPT_MARKER_12345");
    expect(output).toContain("UNIQUE_OUTPUT_MARKER_67890");
  });

  it("groups multiple requests under one shared parent trace", async () => {
    await withAITrace("generate-store", { projectId: "proj-1" }, async () => {
      const a = startAIRequest({ operation: "generate-homepage", model: "test-model" });
      finishAIRequest(a, { usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } });
      const b = startAIRequest({ operation: "generate-product-page", model: "test-model" });
      finishAIRequest(b, { usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 } });
    });
    const output = allLogOutput(logSpy);
    expect(output).toContain("[AI TRACE COMPLETE]");
    expect(output).toContain("AI requests: 2");
    expect(output).toContain("Successful: 2");
    expect(output).toContain("Failed: 0");
    expect(output).toContain("Total input tokens: 30");
    expect(output).toContain("Total output tokens: 15");
    expect(output).toContain("Total tokens: 45");
  });

  it("counts a failed request within its trace without throwing", async () => {
    await withAITrace("generate-store", {}, async () => {
      const a = startAIRequest({ operation: "generate-homepage", model: "test-model" });
      logAIRequestError(a, new Error("boom"));
    });
    const output = allLogOutput(logSpy);
    expect(output).toContain("AI requests: 1");
    expect(output).toContain("Successful: 0");
    expect(output).toContain("Failed: 1");
  });

  it("propagates ambient context (operation, ids) set via withAIContext into startAIRequest", () => {
    withAIContext({ operation: "section-rewrite", projectId: "proj-9", sectionId: "hero" }, () => {
      const handle = startAIRequest({ model: "test-model" });
      finishAIRequest(handle, { usage: null });
    });
    const output = allLogOutput(logSpy);
    expect(output).toContain("Operation: section-rewrite");
    expect(output).toContain("Project: proj-9");
    expect(output).toContain("Section: hero");
  });

  it("lets a nested withAIContext layer more specific fields onto the outer context", () => {
    withAIContext({ operation: "section-rewrite", sectionId: "hero" }, () => {
      withAIContext({ blockId: "block-1", field: "heading" }, () => {
        const handle = startAIRequest({ model: "test-model" });
        finishAIRequest(handle, { usage: null });
      });
    });
    const output = allLogOutput(logSpy);
    expect(output).toContain("Section: hero");
    expect(output).toContain("Block: block-1");
    expect(output).toContain("Field: heading");
  });

  it("uses '-' for context fields that genuinely have no value, never a fabricated placeholder", () => {
    const handle = startAIRequest({ operation: "generate-persona", model: "test-model" });
    finishAIRequest(handle, { usage: null });
    const output = allLogOutput(logSpy);
    expect(output).toContain("Project: -");
    expect(output).toContain("Section: -");
  });

  describe("audit table (docs/ai-prompt-token-audit-logs.md)", () => {
    it("appends one scannable table row per successful request with time, operation, endpoint, model, tokens, duration, status, request id", async () => {
      const handle = withAIContext({ operation: "section-rewrite", route: "/api/project/[id]/rewrite-section", sectionId: "hero" }, () =>
        startAIRequest({ model: "test-model" }),
      );
      finishAIRequest(handle, { usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 } });
      await flushAuditLogWrites();

      const [filePath] = appendFileMock.mock.calls[0];
      expect(filePath).toContain("docs/ai-prompt-token-audit-logs.md");

      const text = tableFileText();
      expect(text).toContain(
        `| section-rewrite | /api/project/[id]/rewrite-section | test-model | 100 | 50 | 150 |`,
      );
      expect(text).toContain(`| SUCCESS | ${handle.requestId} |`);
      expect(text).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/); // ISO timestamp
    });

    it("records a failed request's row with status ERROR and unavailable tokens (never a fabricated count)", async () => {
      const handle = startAIRequest({ operation: "generate-persona", model: "test-model" });
      logAIRequestError(handle, new Error("OpenRouter returned 502: bad gateway"), { providerStatus: 502 });
      await flushAuditLogWrites();

      const text = tableFileText();
      expect(text).toContain("generate-persona");
      expect(text).toContain("| ERROR |");
      expect(text).toContain("| unavailable | unavailable | unavailable |");
    });

    it("is table-formatted regardless of AI_DEBUG_LOGS (independent of terminal verbosity)", async () => {
      process.env.AI_DEBUG_LOGS = "false";
      const handle = startAIRequest({ operation: "generate-marketing-angle", model: "test-model" });
      finishAIRequest(handle, { usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } });
      await flushAuditLogWrites();

      expect(allLogOutput(logSpy)).not.toContain("[AI INPUT]");
      expect(tableFileText()).toContain("generate-marketing-angle");
    });

    it("only ever appends — never truncates or rewrites the file — so prior rows accumulate in order", async () => {
      const h1 = startAIRequest({ operation: "generate-persona", model: "test-model" });
      finishAIRequest(h1, { usage: null });
      await flushAuditLogWrites();
      const h2 = startAIRequest({ operation: "generate-marketing-angle", model: "test-model" });
      finishAIRequest(h2, { usage: null });
      await flushAuditLogWrites();

      const text = tableFileText();
      expect(text).toContain("generate-persona");
      expect(text).toContain("generate-marketing-angle");
      expect(text.indexOf("generate-persona")).toBeLessThan(text.indexOf("generate-marketing-angle"));
    });

    it("writes the table header at most once across many requests", async () => {
      for (const op of ["generate-persona", "generate-marketing-angle", "section-rewrite"]) {
        const h = startAIRequest({ operation: op, model: "test-model" });
        finishAIRequest(h, { usage: null });
        await flushAuditLogWrites();
      }
      const headerWrites = appendFileMock.mock.calls.filter(
        (call) => call[0].includes("ai-prompt-token-audit-logs.md") && call[1].startsWith("# AI Prompt"),
      );
      expect(headerWrites.length).toBeLessThanOrEqual(1);
    });
  });

  describe("audit details (docs/ai-prompt-token-audit-details.md)", () => {
    it("captures full prompt/output, ids, and char counts for a specific request so it can be investigated", async () => {
      const handle = withAIContext({ operation: "section-rewrite", projectId: "proj-1", sectionId: "hero" }, () =>
        startAIRequest({ model: "test-model" }),
      );
      logAIRequestInput(handle, [
        { role: "system", content: "SYSTEM_MARKER" },
        { role: "user", content: "USER_MARKER" },
      ]);
      logAIRequestOutput(handle, JSON.stringify({ heading: "OUTPUT_MARKER" }));
      finishAIRequest(handle, { usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 } });
      await flushAuditLogWrites();

      const text = detailsFileText();
      expect(text).toContain(handle.requestId);
      expect(text).toContain("proj-1");
      expect(text).toContain("SYSTEM_MARKER");
      expect(text).toContain("USER_MARKER");
      expect(text).toContain("OUTPUT_MARKER");
      expect(text).toContain("| Input chars | 24 |"); // "SYSTEM_MARKER" (13) + "USER_MARKER" (11)
      expect(text).toMatch(/\| Output chars \| \d+ \|/);
    });

    it("records the error message and notes there is no output for a failed request", async () => {
      const handle = startAIRequest({ operation: "generate-persona", model: "test-model" });
      logAIRequestInput(handle, [{ role: "user", content: "USER_MARKER_2" }]);
      logAIRequestError(handle, new Error("OpenRouter returned 502: bad gateway"), { providerStatus: 502 });
      await flushAuditLogWrites();

      const text = detailsFileText();
      expect(text).toContain("OpenRouter returned 502: bad gateway");
      expect(text).toContain("USER_MARKER_2");
      expect(text).toContain("(request failed — no output)");
    });

    it("never writes API keys or bearer tokens to the details file", async () => {
      const secret = "sk-or-v1-abcdefghijklmnopqrstuvwxyz0123456789";
      const handle = startAIRequest({ operation: "section-rewrite", model: "test-model" });
      logAIRequestInput(handle, [{ role: "user", content: `Authorization: Bearer ${secret}` }]);
      logAIRequestOutput(handle, `{"token":"${secret}"}`);
      finishAIRequest(handle, { usage: null });
      await flushAuditLogWrites();

      const text = detailsFileText();
      expect(text).not.toContain(secret);
      expect(text).toContain("[REDACTED]");
    });
  });

  describe("context breakdown (docs/ai-prompt-token-audit-details.md)", () => {
    it("renders a Context breakdown table reconciling to a known usage.inputTokens total", async () => {
      const handle = startAIRequest({ operation: "section-rewrite", model: "test-model" });
      logAIRequestInput(
        handle,
        [
          { role: "system", content: "0".repeat(20) },
          { role: "user", content: "PRODUCT:\n" + "0".repeat(30) + "\n\nINSTRUCTION:\n" + "0".repeat(10) },
        ],
        {
          promptBreakdown: [
            part("product_data", "Product data", "PRODUCT:\n" + "0".repeat(30)),
            part("user_instruction", "Instruction", "INSTRUCTION:\n" + "0".repeat(10)),
          ],
        },
      );
      finishAIRequest(handle, { usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 } });
      await flushAuditLogWrites();

      const text = detailsFileText();
      expect(text).toContain("**Context breakdown:**");
      expect(text).toContain("| Context | Chars | Est. tokens |");
      expect(text).toContain("| Product data |");
      expect(text).toContain("| Instruction |");
      expect(text).toContain("**Total input**");
      // Sum of every named row's "Est. tokens" must reconcile exactly to the real reported total
      // (the "**Total input**" row is a second, redundant appearance of that same sum).
      const rowTokenCells = [...text.matchAll(/\| [^*|][^|]* \| [\d,]+ \| ([\d,]+|unavailable) \|/g)]
        .map((m) => m[1])
        .filter((v) => v !== "unavailable")
        .map((v) => Number(v.replace(/,/g, "")));
      expect(rowTokenCells.reduce((s, v) => s + v, 0)).toBe(100);
    });

    it("still renders chars, with tokens unavailable, when a request fails (no usage)", async () => {
      const handle = startAIRequest({ operation: "section-rewrite", model: "test-model" });
      logAIRequestInput(handle, [{ role: "user", content: "PRODUCT:\nWidget" }], {
        promptBreakdown: [part("product_data", "Product data", "PRODUCT:\nWidget")],
      });
      logAIRequestError(handle, new Error("boom"));
      await flushAuditLogWrites();

      const text = detailsFileText();
      expect(text).toContain("**Context breakdown:**");
      expect(text).toContain("| Product data | 15 | unavailable |");
    });

    it("omits the Context breakdown table entirely when no promptBreakdown was supplied (e.g. image generation)", async () => {
      const handle = startAIRequest({ operation: "generate-theme-images", model: "test-model" });
      logAIRequestInput(handle, [{ role: "user", content: "a photo of a widget" }]);
      finishAIRequest(handle, { usage: { inputTokens: 5, outputTokens: 1, totalTokens: 6 } });
      await flushAuditLogWrites();

      const text = detailsFileText();
      expect(text).not.toContain("**Context breakdown:**");
    });

    it("renders a Generation structure table only when generationMeta was supplied", async () => {
      const meta: GenerationMeta = {
        pageType: "product",
        sectionCount: 2,
        sections: [
          { id: "hero", type: "slideshow" },
          { id: "main-product", type: "main-product" },
        ],
        fixedBlockCount: 5,
        allowedBlockTypeMenuSize: 3,
        schemaChars: 40,
        contentChars: 20,
      };
      const handle = startAIRequest({ operation: "generate-product-page", model: "test-model" });
      logAIRequestInput(
        handle,
        [
          { role: "system", content: "0".repeat(10) },
          { role: "user", content: "PAGE STRUCTURE:\n" + "0".repeat(40) + "\n\nTASK:\n" + "0".repeat(20) },
        ],
        {
          promptBreakdown: [
            part("schema_definitions", "Page structure", "PAGE STRUCTURE:\n" + "0".repeat(40)),
            part("user_instruction", "Task brief", "TASK:\n" + "0".repeat(20)),
          ],
          generationMeta: meta,
        },
      );
      finishAIRequest(handle, { usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 } });
      await flushAuditLogWrites();

      const text = detailsFileText();
      expect(text).toContain("**Generation structure:**");
      expect(text).toContain("Sections: hero (slideshow), main-product (main-product)");
    });

    it("keeps [AI REQUEST START]/[AI REQUEST COMPLETE] console output unchanged even when a breakdown was supplied", () => {
      const handle = startAIRequest({ operation: "section-rewrite", model: "test-model" });
      logAIRequestInput(handle, [{ role: "user", content: "PRODUCT:\nWidget" }], {
        promptBreakdown: [part("product_data", "Product data", "PRODUCT:\nWidget")],
      });
      finishAIRequest(handle, { usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } });

      const output = allLogOutput(logSpy);
      expect(output).toContain("[AI REQUEST START]");
      expect(output).toContain("[AI REQUEST COMPLETE]");
      expect(output).not.toContain("Context breakdown");
      expect(output).not.toContain("promptBreakdown");
    });
  });

  describe("audit summary (docs/ai-prompt-token-audit-summary.md)", () => {
    it("regenerates totals — requests, success/fail, tokens, average duration — from the real table content after every request", async () => {
      const h1 = startAIRequest({ operation: "generate-persona", model: "test-model" });
      finishAIRequest(h1, { usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 } });
      await flushAuditLogWrites();

      const h2 = startAIRequest({ operation: "generate-marketing-angle", model: "test-model" });
      logAIRequestError(h2, new Error("boom"));
      await flushAuditLogWrites();

      const summary = summaryFileText();
      expect(summary).toBeDefined();
      expect(summary).toContain("| Total requests | 2 |");
      expect(summary).toContain("| Successful | 1 |");
      expect(summary).toContain("| Failed | 1 |");
      expect(summary).toContain("| Total input tokens | 100 |");
      expect(summary).toContain("| Total output tokens | 50 |");
      expect(summary).toContain("| Total tokens | 150 |");
      expect(summary).toMatch(/\| Average duration \| \d+(?:,\d{3})* ms \|/);
    });

    it("reports unavailable totals rather than a fabricated number when no request in the table reported usage", async () => {
      const handle = startAIRequest({ operation: "generate-persona", model: "test-model" });
      finishAIRequest(handle, { usage: null });
      await flushAuditLogWrites();

      const summary = summaryFileText();
      expect(summary).toContain("| Total input tokens | unavailable |");
      expect(summary).toContain("| Total output tokens | unavailable |");
      expect(summary).toContain("| Total tokens | unavailable |");
    });

    it("is overwritten (not appended) — writeFile is used, and each call reflects the running totals", async () => {
      const h1 = startAIRequest({ operation: "generate-persona", model: "test-model" });
      finishAIRequest(h1, { usage: null });
      await flushAuditLogWrites();
      const h2 = startAIRequest({ operation: "generate-marketing-angle", model: "test-model" });
      finishAIRequest(h2, { usage: null });
      await flushAuditLogWrites();

      expect(writeFileMock.mock.calls.length).toBe(2);
      expect(writeFileMock.mock.calls[0][1]).toContain("| Total requests | 1 |");
      expect(writeFileMock.mock.calls[1][1]).toContain("| Total requests | 2 |");
    });
  });
});
