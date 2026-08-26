import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  type PromptPart,
  type GenerationMeta,
  computeBreakdownRows,
  renderContextBreakdownTable,
  renderGenerationStructureTable,
} from "./prompt-breakdown";

// Centralized AI request/response debug logging (ai-request-debug-logging.md). Purely
// additive observability: every function here only ever logs to the console/disk and
// returns void — nothing it does can change what a caller receives or how an existing error
// is thrown/handled.
//
// Route handlers set ambient context (operation, projectId, sectionId, ...) once via
// withAIContext/withAITrace around their call into lib/ai/*. That context rides Node's
// AsyncLocalStorage through the whole call chain — including Promise.all-spawned children,
// which is what lets a fan-out like generateStore() (two concurrent template generations)
// or rewriteWholeSectionParallel() (one call per block) share a trace/base context without
// every intermediate function threading new parameters through its signature. The two
// lowest shared call layers, chat() (lib/ai/openrouter.ts) and requestImage()
// (lib/ai/images.ts), read the ambient context and log against it — so any future AI call
// site that goes through either one is instrumented automatically, on the terminal AND in
// the three audit files below.

export interface AIRequestContext {
  operation?: string;
  route?: string;
  projectId?: string;
  productId?: string;
  template?: string;
  sectionId?: string;
  blockId?: string;
  field?: string;
  traceId?: string;
}

export interface AIUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

export interface AIRequestHandle {
  requestId: string;
  operation: string;
  model: string;
  provider: string;
  startedAt: number;
  context: AIRequestContext;
}

interface TraceAccumulator {
  operation: string;
  startedAt: number;
  count: number;
  succeeded: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** True once at least one request in this trace reported real provider usage. */
  hasUsage: boolean;
  aiTimeMs: number;
}

const SEPARATOR = "─".repeat(48);
const UNAVAILABLE = "unavailable";
const NOT_SET = "-";

const contextStorage = new AsyncLocalStorage<AIRequestContext>();
const traces = new Map<string, TraceAccumulator>();

// Bearer tokens, OpenRouter/OpenAI-style "sk-..." keys (which themselves contain hyphens,
// e.g. "sk-or-v1-..."), and "key: value"/"key=value" pairs whose key name looks credential-
// shaped — scrubbed from anything that reaches the console or disk, even though today's
// prompts/outputs are app-authored text that shouldn't contain any. The third alternative
// optionally swallows a "Bearer " scheme prefix as part of the value so "Authorization:
// Bearer sk-..." redacts as one match instead of leaving the token dangling after "Bearer"
// gets consumed as if it were the value itself.
const SECRET_PATTERN =
  /bearer\s+[a-z0-9._-]{8,}|sk-[a-z0-9-]{10,}|(?:api[_-]?key|access[_-]?token|token|authorization|cookie|password|secret)\s*[:=]\s*["']?(?:bearer\s+)?[a-z0-9._-]{6,}/gi;

function redact(text: string): string {
  return text.replace(SECRET_PATTERN, "[REDACTED]");
}

function isDebugEnabled(): boolean {
  return ["1", "true", "yes", "on"].includes((process.env.AI_DEBUG_LOGS ?? "").trim().toLowerCase());
}

function shortId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 6);
}

function ambientContext(): AIRequestContext {
  return contextStorage.getStore() ?? {};
}

function formatTokenCount(value: number | null): string {
  return value === null ? UNAVAILABLE : value.toLocaleString("en-US");
}

function prettyPrintOutput(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) {
      try {
        return JSON.stringify(JSON.parse(fenced[1]), null, 2);
      } catch {
        // fall through to raw text below
      }
    }
    return raw;
  }
}

/**
 * Runs `fn` with ambient AI-log context available to every startAIRequest()/chat()/
 * requestImage() call inside it — merges onto whatever context is already active, so a
 * nested call (e.g. one block's rewrite inside a whole-section rewrite) can layer on a more
 * specific blockId/field without losing the route-level projectId/sectionId/operation.
 */
export function withAIContext<T>(context: AIRequestContext, fn: () => T): T {
  const merged: AIRequestContext = { ...ambientContext(), ...context };
  return contextStorage.run(merged, fn);
}

/**
 * Runs `fn` as one logical multi-request AI operation (e.g. "generate my store", which fans
 * out into a homepage generation and a product-page generation, each possibly followed by
 * image generation). Assigns a shared traceId, logs a trace summary on completion aggregating
 * every request logged inside it, and always cleans up its accumulator even if `fn` throws.
 */
export async function withAITrace<T>(
  operation: string,
  context: Omit<AIRequestContext, "traceId" | "operation">,
  fn: () => Promise<T>,
): Promise<T> {
  const traceId = shortId();
  const startedAt = Date.now();
  traces.set(traceId, {
    operation,
    startedAt,
    count: 0,
    succeeded: 0,
    failed: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    hasUsage: false,
    aiTimeMs: 0,
  });

  try {
    return await withAIContext({ ...context, operation, traceId }, fn);
  } finally {
    const acc = traces.get(traceId);
    traces.delete(traceId);
    if (acc) {
      const wallMs = Date.now() - startedAt;
      console.log(
        [
          SEPARATOR,
          `[AI TRACE COMPLETE]`,
          `Trace ID: ${traceId}`,
          `Operation: ${operation}`,
          ``,
          `AI requests: ${acc.count}`,
          `Successful: ${acc.succeeded}`,
          `Failed: ${acc.failed}`,
          ``,
          `Total input tokens: ${formatTokenCount(acc.hasUsage ? acc.inputTokens : null)}`,
          `Total output tokens: ${formatTokenCount(acc.hasUsage ? acc.outputTokens : null)}`,
          `Total tokens: ${formatTokenCount(acc.hasUsage ? acc.totalTokens : null)}`,
          ``,
          `Total AI time: ${(acc.aiTimeMs / 1000).toFixed(2)}s`,
          `Wall time: ${(wallMs / 1000).toFixed(2)}s`,
          SEPARATOR,
        ].join("\n"),
      );
    }
  }
}

function recordInTrace(
  handle: AIRequestHandle,
  result: { status: "success" | "error"; durationMs: number; usage?: AIUsage },
): void {
  const traceId = handle.context.traceId;
  if (!traceId) return;
  const acc = traces.get(traceId);
  if (!acc) return;
  if (result.status === "success") acc.succeeded++;
  else acc.failed++;
  acc.aiTimeMs += result.durationMs;
  if (result.usage && (result.usage.inputTokens !== null || result.usage.outputTokens !== null || result.usage.totalTokens !== null)) {
    acc.hasUsage = true;
    acc.inputTokens += result.usage.inputTokens ?? 0;
    acc.outputTokens += result.usage.outputTokens ?? 0;
    acc.totalTokens += result.usage.totalTokens ?? 0;
  }
}

export interface StartAIRequestParams {
  /** Falls back to the ambient operation (set via withAIContext/withAITrace), then "-", when omitted. */
  operation?: string;
  model: string;
  provider?: string;
  messages?: { role: string; content: string }[];
  /** Overrides/augments the ambient context (set via withAIContext/withAITrace) for this one request. */
  context?: AIRequestContext;
}

/**
 * Begins one AI request's lifecycle: allocates a request id, logs the [AI REQUEST START]
 * block, and returns a handle that logAIRequestInput/logAIRequestOutput/finishAIRequest/
 * logAIRequestError all take so every log line for this request carries the same id.
 */
export function startAIRequest(params: StartAIRequestParams): AIRequestHandle {
  const context: AIRequestContext = { ...ambientContext(), ...params.context };
  const requestId = shortId();
  const startedAt = Date.now();
  const provider = params.provider ?? "OpenRouter";
  const operation = params.operation || context.operation || NOT_SET;

  if (context.traceId) {
    const acc = traces.get(context.traceId);
    if (acc) acc.count++;
  }

  const messages = params.messages ?? [];
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const user = messages
    .filter((m) => m.role !== "system")
    .map((m) => m.content)
    .join("\n\n");

  console.log(
    [
      SEPARATOR,
      `[AI REQUEST START]`,
      `Request ID: ${requestId}`,
      `Trace ID: ${context.traceId ?? NOT_SET}`,
      `Operation: ${operation}`,
      `Route: ${context.route ?? NOT_SET}`,
      `Project: ${context.projectId ?? NOT_SET}`,
      `Product: ${context.productId ?? NOT_SET}`,
      `Template: ${context.template ?? NOT_SET}`,
      `Section: ${context.sectionId ?? NOT_SET}`,
      `Block: ${context.blockId ?? NOT_SET}`,
      `Field: ${context.field ?? NOT_SET}`,
      `Provider: ${provider}`,
      `Model: ${params.model}`,
      `Started: ${new Date(startedAt).toLocaleTimeString()}`,
      `Messages: ${messages.length}`,
      `System prompt chars: ${system.length}`,
      `User prompt chars: ${user.length}`,
      SEPARATOR,
    ].join("\n"),
  );

  return { requestId, operation, model: params.model, provider, startedAt, context };
}

// ---------------------------------------------------------------------------------------
// Append-only audit trail, spread across three files under docs/ so each stays readable:
//   - ai-prompt-token-audit-logs.md     one scannable table row per request (the "main log")
//   - ai-prompt-token-audit-details.md  one full entry per request (prompt/output/context),
//                                       cross-referenced with the table by Request ID
//   - ai-prompt-token-audit-summary.md  rolling totals, regenerated from the table after
//                                       every request — the one file that's overwritten, since
//                                       it's a computed rollup rather than raw log data; the
//                                       table and details files are only ever appended to.
// Independent of AI_DEBUG_LOGS, which only governs the terminal's verbosity.
// ---------------------------------------------------------------------------------------

const AUDIT_TABLE_PATH = path.join(process.cwd(), "docs", "ai-prompt-token-audit-logs.md");
const AUDIT_DETAILS_PATH = path.join(process.cwd(), "docs", "ai-prompt-token-audit-details.md");
const AUDIT_SUMMARY_PATH = path.join(process.cwd(), "docs", "ai-prompt-token-audit-summary.md");

const AUDIT_TABLE_HEADER = `# AI Prompt & Token Audit Log

Auto-appended by \`lib/ai/debug-logger.ts\` for every AI/OpenRouter request, across every
operation (full-store generation, section rewrites, title/description rewrites, persona and
marketing-angle generation, product and theme image generation, and any future AI call that
goes through \`chat()\`/\`requestImage()\`). Append-only — rows are never edited or removed by
the logger; do not hand-edit this file.

Full per-request prompt/output: \`ai-prompt-token-audit-details.md\` (cross-referenced by the
Request ID column below). Rolling totals: \`ai-prompt-token-audit-summary.md\`.

| Time | Operation | Endpoint | Model | Input | Output | Total | Duration | Status | Request ID |
|------|-----------|----------|-------|------:|-------:|------:|---------:|--------|------------|
`;

const AUDIT_DETAILS_HEADER = `# AI Prompt & Token Audit — Request Details

Auto-appended by \`lib/ai/debug-logger.ts\`. One entry per request, cross-referenced by
Request ID with the table in \`ai-prompt-token-audit-logs.md\`. Append-only.

---
`;

let tableHeaderWritten = existsSync(AUDIT_TABLE_PATH);
let detailsHeaderWritten = existsSync(AUDIT_DETAILS_PATH);

interface PendingCaptureEntry {
  system: string;
  user: string;
  systemChars: number;
  userChars: number;
  output?: string;
  outputChars?: number;
  promptBreakdown?: PromptPart[];
  generationMeta?: GenerationMeta;
}

const pendingCapture = new Map<string, PendingCaptureEntry>();

function tableCell(value: string): string {
  // Escape pipes/newlines so a value (e.g. an error message) can never break the table's structure.
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

function formatDurationMs(ms: number): string {
  return `${ms.toLocaleString("en-US")} ms`;
}

function buildTableRow(handle: AIRequestHandle, status: "SUCCESS" | "ERROR", durationMs: number, usage: AIUsage): string {
  const cells = [
    new Date().toISOString(),
    handle.operation,
    handle.context.route ?? NOT_SET,
    handle.model,
    formatTokenCount(usage.inputTokens),
    formatTokenCount(usage.outputTokens),
    formatTokenCount(usage.totalTokens),
    formatDurationMs(durationMs),
    status,
    handle.requestId,
  ].map(tableCell);
  return `| ${cells.join(" | ")} |\n`;
}

function codeBlock(text: string): string {
  return "```text\n" + (text || "(none)") + "\n```";
}

/**
 * Renders the "Context breakdown" table (and, for a full-page generation, the "Generation
 * structure" table) into details-entry lines — empty when no breakdown was captured for this
 * request (e.g. image generation, which stays out of scope), so those entries render exactly
 * as they did before this was added.
 */
function breakdownSection(captured: PendingCaptureEntry | undefined, usage: AIUsage): string[] {
  if (!captured?.promptBreakdown) return [];

  const rows = computeBreakdownRows({
    systemChars: captured.systemChars,
    userChars: captured.userChars,
    userParts: captured.promptBreakdown,
    inputTokens: usage.inputTokens,
  });

  return [
    `**Context breakdown:**`,
    ``,
    renderContextBreakdownTable(rows),
    ``,
    ...(captured.generationMeta
      ? [`**Generation structure:**`, ``, renderGenerationStructureTable(captured.generationMeta, rows), ``]
      : []),
  ];
}

function buildDetailsEntry(
  handle: AIRequestHandle,
  status: "SUCCESS" | "ERROR",
  durationMs: number,
  extra: { usage?: AIUsage; errorMessage?: string; providerStatus?: number },
): string {
  const captured = pendingCapture.get(handle.requestId);
  const usage = extra.usage ?? { inputTokens: null, outputTokens: null, totalTokens: null };
  const inputChars = captured ? captured.systemChars + captured.userChars : null;

  return [
    `## ${handle.operation} — ${status} — ${new Date().toISOString()}`,
    ``,
    `| Field | Value |`,
    `| --- | --- |`,
    `| Request ID | ${handle.requestId} |`,
    `| Trace ID | ${handle.context.traceId ?? NOT_SET} |`,
    `| Endpoint | ${handle.context.route ?? NOT_SET} |`,
    `| Project | ${handle.context.projectId ?? NOT_SET} |`,
    `| Product | ${handle.context.productId ?? NOT_SET} |`,
    `| Template | ${handle.context.template ?? NOT_SET} |`,
    `| Section | ${handle.context.sectionId ?? NOT_SET} |`,
    `| Block | ${handle.context.blockId ?? NOT_SET} |`,
    `| Field | ${handle.context.field ?? NOT_SET} |`,
    `| Model | ${handle.model} |`,
    `| Provider | ${handle.provider} |`,
    `| Duration | ${durationMs.toLocaleString("en-US")} ms |`,
    `| Input tokens | ${formatTokenCount(usage.inputTokens)} |`,
    `| Output tokens | ${formatTokenCount(usage.outputTokens)} |`,
    `| Total tokens | ${formatTokenCount(usage.totalTokens)} |`,
    `| Input chars | ${inputChars === null ? NOT_SET : inputChars.toLocaleString("en-US")} |`,
    `| Output chars | ${captured?.outputChars !== undefined ? captured.outputChars.toLocaleString("en-US") : NOT_SET} |`,
    `| Status | ${status} |`,
    ``,
    ...breakdownSection(captured, usage),
    `**System prompt:**`,
    ``,
    codeBlock(captured?.system ?? ""),
    ``,
    `**User prompt:**`,
    ``,
    codeBlock(captured?.user ?? ""),
    ``,
    `**Output:**`,
    ``,
    codeBlock(captured?.output ?? (status === "ERROR" ? "(request failed — no output)" : "")),
    ``,
    ...(extra.errorMessage
      ? [
          `**Error:**`,
          ``,
          codeBlock(
            extra.providerStatus !== undefined
              ? `${extra.errorMessage}\n\nProvider status: ${extra.providerStatus}`
              : extra.errorMessage,
          ),
          ``,
        ]
      : []),
    `---`,
    ``,
  ].join("\n");
}

async function appendTableRow(row: string): Promise<void> {
  await mkdir(path.dirname(AUDIT_TABLE_PATH), { recursive: true });
  if (!tableHeaderWritten) {
    await appendFile(AUDIT_TABLE_PATH, AUDIT_TABLE_HEADER, "utf8");
    tableHeaderWritten = true;
  }
  await appendFile(AUDIT_TABLE_PATH, row, "utf8");
}

async function appendDetailsEntry(entry: string): Promise<void> {
  await mkdir(path.dirname(AUDIT_DETAILS_PATH), { recursive: true });
  if (!detailsHeaderWritten) {
    await appendFile(AUDIT_DETAILS_PATH, AUDIT_DETAILS_HEADER, "utf8");
    detailsHeaderWritten = true;
  }
  await appendFile(AUDIT_DETAILS_PATH, entry, "utf8");
}

interface ParsedTableRow {
  input: number | null;
  output: number | null;
  total: number | null;
  durationMs: number;
  status: "SUCCESS" | "ERROR";
}

function parseTokenCell(cell: string): number | null {
  return cell === UNAVAILABLE ? null : Number(cell.replace(/,/g, ""));
}

/** Parses the table file's own rows back out — used only to (re)compute the summary, never to change the table itself. */
function parseTableRows(content: string): ParsedTableRow[] {
  const rows: ParsedTableRow[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|") || trimmed.startsWith("| Time") || /^\|[\s:|-]+\|$/.test(trimmed)) continue;
    const cells = trimmed
      .slice(1, -1)
      .split("|")
      .map((c) => c.trim());
    if (cells.length < 10) continue;
    const [, , , , inputCell, outputCell, totalCell, durationCell, statusCell] = cells;
    const durationMs = Number(durationCell.replace(/,/g, "").replace(/\s*ms$/i, ""));
    if (!Number.isFinite(durationMs)) continue;
    rows.push({
      input: parseTokenCell(inputCell),
      output: parseTokenCell(outputCell),
      total: parseTokenCell(totalCell),
      durationMs,
      status: statusCell === "ERROR" ? "ERROR" : "SUCCESS",
    });
  }
  return rows;
}

function sumOrNull(values: (number | null)[]): number | null {
  let sum: number | null = null;
  for (const v of values) {
    if (v === null) continue;
    sum = (sum ?? 0) + v;
  }
  return sum;
}

/** Recomputes docs/ai-prompt-token-audit-summary.md from the table file's current rows. The only audit file that's overwritten rather than appended to. */
async function regenerateAuditSummary(): Promise<void> {
  let content: string;
  try {
    content = await readFile(AUDIT_TABLE_PATH, "utf8");
  } catch {
    return; // table file doesn't exist yet — nothing to summarize
  }

  const rows = parseTableRows(content);
  const total = rows.length;
  const succeeded = rows.filter((r) => r.status === "SUCCESS").length;
  const failed = total - succeeded;
  const totalInput = sumOrNull(rows.map((r) => r.input));
  const totalOutput = sumOrNull(rows.map((r) => r.output));
  const totalTokens = sumOrNull(rows.map((r) => r.total));
  const avgDurationMs = total > 0 ? rows.reduce((acc, r) => acc + r.durationMs, 0) / total : null;

  const text = [
    `# AI Prompt & Token Audit — Summary`,
    ``,
    `Auto-regenerated by \`lib/ai/debug-logger.ts\` after every request, computed from`,
    `\`ai-prompt-token-audit-logs.md\`. This is the one audit file that is overwritten — as a`,
    `computed rollup, not raw log data — rather than appended to; the underlying table rows`,
    `and detail entries are never modified.`,
    ``,
    `_Last updated: ${new Date().toISOString()}_`,
    ``,
    `| Metric | Value |`,
    `| --- | --- |`,
    `| Total requests | ${total} |`,
    `| Successful | ${succeeded} |`,
    `| Failed | ${failed} |`,
    `| Total input tokens | ${formatTokenCount(totalInput)} |`,
    `| Total output tokens | ${formatTokenCount(totalOutput)} |`,
    `| Total tokens | ${formatTokenCount(totalTokens)} |`,
    `| Average duration | ${avgDurationMs === null ? NOT_SET : `${Math.round(avgDurationMs).toLocaleString("en-US")} ms`} |`,
    ``,
  ].join("\n");

  await mkdir(path.dirname(AUDIT_SUMMARY_PATH), { recursive: true });
  await writeFile(AUDIT_SUMMARY_PATH, text, "utf8");
}

/** Writes the table row, the details entry, and refreshes the summary, in that order. Never throws — a disk/permission failure only logs a console warning, it never breaks the AI request it's recording. */
async function persistAuditLog(tableRow: string, detailsEntry: string): Promise<void> {
  try {
    await appendTableRow(tableRow);
    await appendDetailsEntry(detailsEntry);
    await regenerateAuditSummary();
  } catch (err) {
    console.error(`[AI AUDIT LOG] Failed to persist audit log:`, err instanceof Error ? err.message : err);
  }
}

/**
 * Prints the actual AI messages, in full, when AI_DEBUG_LOGS is enabled. Suppressed by
 * default so a normal run doesn't dump every prompt to the console — the START block's
 * message count/char sizes are always visible regardless. Always captured (redacted) for the
 * details audit file, independent of AI_DEBUG_LOGS, which only governs the terminal.
 */
export function logAIRequestInput(
  handle: AIRequestHandle,
  messages: { role: string; content: string }[],
  extra?: { promptBreakdown?: PromptPart[]; generationMeta?: GenerationMeta },
): void {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const user = messages
    .filter((m) => m.role !== "system")
    .map((m) => m.content)
    .join("\n\n");
  const redactedSystem = redact(system);
  const redactedUser = redact(user);
  pendingCapture.set(handle.requestId, {
    system: redactedSystem,
    user: redactedUser,
    systemChars: system.length,
    userChars: user.length,
    ...(extra?.promptBreakdown ? { promptBreakdown: extra.promptBreakdown } : {}),
    ...(extra?.generationMeta ? { generationMeta: extra.generationMeta } : {}),
  });

  if (!isDebugEnabled()) return;
  console.log(
    [
      `[AI INPUT]`,
      `Request ID: ${handle.requestId}`,
      ``,
      `[SYSTEM PROMPT]`,
      redactedSystem || "(none)",
      ``,
      `[USER PROMPT]`,
      redactedUser || "(none)",
    ].join("\n"),
  );
}

/**
 * Prints the model's raw output, pretty-printed when it's JSON, when AI_DEBUG_LOGS is
 * enabled. Always captured (redacted) for the details audit file, independent of
 * AI_DEBUG_LOGS.
 */
export function logAIRequestOutput(handle: AIRequestHandle, output: string): void {
  const pretty = redact(prettyPrintOutput(output));
  const captured = pendingCapture.get(handle.requestId) ?? { system: "", user: "", systemChars: 0, userChars: 0 };
  pendingCapture.set(handle.requestId, { ...captured, output: pretty, outputChars: output.length });

  if (!isDebugEnabled()) return;
  console.log(
    [
      `[AI RESPONSE]`,
      `Request ID: ${handle.requestId}`,
      ``,
      `Output:`,
      pretty,
      ``,
      `Output characters: ${output.length}`,
    ].join("\n"),
  );
}

export interface FinishAIRequestResult {
  usage: AIUsage | null;
}

/**
 * Ends a successful request's lifecycle: logs [AI REQUEST COMPLETE] to the terminal (as
 * before), folds it into its trace, if any, and always persists it — one table row, one
 * details entry, and a refreshed summary — across the three append-only-ish audit files,
 * independent of AI_DEBUG_LOGS.
 */
export function finishAIRequest(handle: AIRequestHandle, result: FinishAIRequestResult): void {
  const durationMs = Date.now() - handle.startedAt;
  const usage = result.usage ?? { inputTokens: null, outputTokens: null, totalTokens: null };
  recordInTrace(handle, { status: "success", durationMs, usage });

  console.log(
    [
      SEPARATOR,
      `[AI REQUEST COMPLETE]`,
      `Request ID: ${handle.requestId}`,
      `Operation: ${handle.operation}`,
      `Model: ${handle.model}`,
      `Status: SUCCESS`,
      `Duration: ${durationMs.toLocaleString("en-US")} ms`,
      `Input tokens: ${formatTokenCount(usage.inputTokens)}`,
      `Output tokens: ${formatTokenCount(usage.outputTokens)}`,
      `Total tokens: ${formatTokenCount(usage.totalTokens)}`,
      SEPARATOR,
    ].join("\n"),
  );

  // Built synchronously (and reads pendingCapture) before the fire-and-forget file I/O below,
  // so the delete on the next line can never race the read.
  const tableRow = buildTableRow(handle, "SUCCESS", durationMs, usage);
  const detailsEntry = buildDetailsEntry(handle, "SUCCESS", durationMs, { usage });
  void persistAuditLog(tableRow, detailsEntry);
  pendingCapture.delete(handle.requestId);
}

/**
 * Ends a failed request's lifecycle: logs [AI REQUEST FAILED] to the terminal (as before),
 * folds it into its trace, if any, and always persists it across the audit files,
 * independent of AI_DEBUG_LOGS. Never itself throws.
 */
export function logAIRequestError(
  handle: AIRequestHandle,
  error: unknown,
  extra?: { providerStatus?: number; providerResponse?: string },
): void {
  const durationMs = Date.now() - handle.startedAt;
  recordInTrace(handle, { status: "error", durationMs });

  const message = error instanceof Error ? error.message : String(error);
  const status =
    extra?.providerStatus ?? (typeof (error as { status?: unknown })?.status === "number" ? (error as { status: number }).status : undefined);

  console.error(
    [
      SEPARATOR,
      `[AI REQUEST FAILED]`,
      `Request ID: ${handle.requestId}`,
      `Operation: ${handle.operation}`,
      `Model: ${handle.model}`,
      `Duration: ${durationMs.toLocaleString("en-US")} ms`,
      `Status: ERROR`,
      ``,
      `Error:`,
      redact(message),
      `Provider status:`,
      status === undefined ? NOT_SET : String(status),
      ...(extra?.providerResponse ? [``, `Provider response:`, redact(extra.providerResponse)] : []),
      SEPARATOR,
    ].join("\n"),
  );

  const tableRow = buildTableRow(handle, "ERROR", durationMs, { inputTokens: null, outputTokens: null, totalTokens: null });
  const detailsEntry = buildDetailsEntry(handle, "ERROR", durationMs, {
    errorMessage: redact(message),
    providerStatus: status,
  });
  void persistAuditLog(tableRow, detailsEntry);
  pendingCapture.delete(handle.requestId);
}
