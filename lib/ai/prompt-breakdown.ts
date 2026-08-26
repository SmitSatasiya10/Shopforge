// Per-component breakdown of an AI prompt's input, for the audit logger
// (docs/ai-prompt-token-audit-details.md). A leaf module — imports nothing from
// debug-logger.ts, openrouter.ts, or content-generator.ts, all of which import from here,
// so there is no cycle.
//
// Every prompt builder in lib/ai/*.ts constructs its user-message content as a sequence of
// labeled blocks (a header line + its value) with exactly one blank-line separator between
// each — `part()`/`joinParts()` formalize that shape so a builder can be decomposed into
// named parts without changing the joined string one character. Token counts, unlike chars,
// are never measured per component (OpenRouter reports one total per request, and this repo
// has no local tokenizer) — `distributeTokensByChars` turns that one real total into a
// per-component *estimate*, clearly distinguished from the exact char counts.

export type PromptComponentKey =
  | "system_prompt"
  | "user_instruction"
  | "product_data"
  | "language_instruction"
  | "persona"
  | "marketing_angle"
  | "schema_definitions"
  | "existing_content"
  | "existing_settings"
  | "other";

export interface PromptPart {
  key: PromptComponentKey;
  label: string;
  text: string;
}

/** One labeled block of a prompt: a header line plus its value, joined like the rest of the block's own lines. */
export function part(key: PromptComponentKey, label: string, ...lines: string[]): PromptPart {
  return { key, label, text: lines.join("\n") };
}

/** Reassembles a prompt's parts into the exact string a builder would have produced directly — one blank line between every pair of parts, none within. */
export function joinParts(parts: PromptPart[]): string {
  return parts.map((p) => p.text).join("\n\n");
}

export interface BreakdownRow {
  key: PromptComponentKey;
  label: string;
  chars: number;
  estimatedTokens: number | null;
}

/**
 * Distributes `inputTokens` across `chars` in proportion to each entry's share, using the
 * largest-remainder method so the results always sum to exactly `inputTokens` (never more,
 * never less, regardless of rounding) — ties broken by array index for determinism. Returns
 * all-null when `inputTokens` is null (no real total to distribute) or when every char count
 * is 0 (nothing to distribute proportionally against).
 */
export function distributeTokensByChars(chars: number[], inputTokens: number | null): (number | null)[] {
  if (inputTokens === null) return chars.map(() => null);
  const totalChars = chars.reduce((sum, c) => sum + c, 0);
  if (totalChars <= 0) return chars.map(() => null);

  const raw = chars.map((c) => (c / totalChars) * inputTokens);
  const floors = raw.map((r) => Math.floor(r));
  let remainder = inputTokens - floors.reduce((sum, f) => sum + f, 0);

  const order = raw
    .map((r, i) => ({ i, frac: r - floors[i] }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  const result = [...floors];
  for (const { i } of order) {
    if (remainder <= 0) break;
    result[i] += 1;
    remainder -= 1;
  }
  return result;
}

/**
 * Builds the full row set for one request's input: a synthesized "system_prompt" row from
 * `systemChars`, one row per supplied user-message part, and a trailing "other" row —
 * `userChars` minus the sum of every part's chars, which absorbs the blank-line separators
 * `joinParts` inserts between parts. Not clamped to zero: if a builder's part decomposition
 * ever left something uncounted (or double-counted), `other` should show the true — possibly
 * negative — value and this function warns, rather than silently hiding a bug behind a
 * reconciled-looking table.
 */
export function computeBreakdownRows(params: {
  systemChars: number;
  userChars: number;
  userParts: PromptPart[];
  inputTokens: number | null;
}): BreakdownRow[] {
  const { systemChars, userChars, userParts, inputTokens } = params;
  const partsCharSum = userParts.reduce((sum, p) => sum + p.text.length, 0);
  const otherChars = userChars - partsCharSum;

  if (otherChars < 0) {
    console.warn(
      `[AI AUDIT LOG] Prompt breakdown parts (${partsCharSum} chars) exceed the recorded user prompt ` +
        `(${userChars} chars) by ${-otherChars} — a builder's part decomposition is double-counting content.`,
    );
  }

  const chars = [systemChars, ...userParts.map((p) => p.text.length), otherChars];
  const estimatedTokens = distributeTokensByChars(chars, inputTokens);

  const rows: BreakdownRow[] = [
    { key: "system_prompt", label: "System prompt", chars: systemChars, estimatedTokens: estimatedTokens[0] },
    ...userParts.map((p, i) => ({
      key: p.key,
      label: p.label,
      chars: p.text.length,
      estimatedTokens: estimatedTokens[i + 1],
    })),
    { key: "other" as const, label: "Other", chars: otherChars, estimatedTokens: estimatedTokens[estimatedTokens.length - 1] },
  ];
  return rows;
}

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

function formatEstimatedTokens(value: number | null): string {
  return value === null ? "unavailable" : value.toLocaleString("en-US");
}

const BREAKDOWN_FOOTNOTE =
  "_Chars are measured exactly from the text actually sent to the model. Estimated tokens are " +
  "not measured per component — the provider reports only one total input-token count per " +
  "request — so each component's value is that real total distributed in proportion to its " +
  "share of characters (rows always sum exactly to the real total). \"unavailable\" means no " +
  "real total was reported (e.g. a failed request), not an estimate of zero._";

/** Renders the "Context breakdown" table for one request's details entry. */
export function renderContextBreakdownTable(rows: BreakdownRow[]): string {
  const totalChars = rows.reduce((sum, r) => sum + r.chars, 0);
  const totalTokens = rows.some((r) => r.estimatedTokens === null)
    ? null
    : rows.reduce((sum, r) => sum + (r.estimatedTokens ?? 0), 0);

  return [
    `| Context | Chars | Est. tokens |`,
    `| --- | ---: | ---: |`,
    ...rows.map((r) => `| ${r.label} | ${formatCount(r.chars)} | ${formatEstimatedTokens(r.estimatedTokens)} |`),
    `| **Total input** | **${formatCount(totalChars)}** | **${formatEstimatedTokens(totalTokens)}** |`,
    ``,
    BREAKDOWN_FOOTNOTE,
  ].join("\n");
}

export interface GenerationSectionMeta {
  id: string;
  type: string;
}

export interface GenerationMeta {
  pageType: "index" | "product";
  /** Non-locked fixed sections actually described to the model — matches describeFixedSections' own filter. */
  sectionCount: number;
  sections: GenerationSectionMeta[];
  /** Blocks the model must write settings for exactly (fixed_blocks sections) — a deterministic count. */
  fixedBlockCount: number;
  /** Sum of allowed_blocks menu sizes across ordinary sections — how many block TYPES are offered, not a count of blocks sent or generated. */
  allowedBlockTypeMenuSize: number;
  /** Chars of the schema_definitions part (the page-structure description). */
  schemaChars: number;
  /** userChars minus schemaChars — product/language/persona/angle/task, everything but the schema. */
  contentChars: number;
}

const GENERATION_FOOTNOTE =
  '_"Fixed blocks" is deterministic — the model must write settings for exactly these seeded ' +
  'blocks. "Block-menu size" is how many block TYPES the model may freely choose from for its ' +
  "other sections — not a count of blocks actually requested or returned._";

/** Renders the "Generation structure" table for a full-page generation request's details entry. */
export function renderGenerationStructureTable(meta: GenerationMeta, rows: BreakdownRow[]): string {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const system = byKey.get("system_prompt");
  const schema = byKey.get("schema_definitions");
  const schemaChars = schema?.chars ?? meta.schemaChars;
  const schemaTokens = schema?.estimatedTokens ?? null;
  const systemChars = system?.chars ?? 0;
  const systemTokens = system?.estimatedTokens ?? null;

  const totalChars = rows.reduce((sum, r) => sum + r.chars, 0);
  const contentChars = totalChars - systemChars - schemaChars;
  const contentTokens =
    rows.some((r) => r.estimatedTokens === null)
      ? null
      : rows.reduce((sum, r) => sum + (r.estimatedTokens ?? 0), 0) - (systemTokens ?? 0) - (schemaTokens ?? 0);

  const header = [
    `Page`,
    `Sections`,
    `Fixed blocks`,
    `Block-menu size`,
    `Sys chars`,
    `Schema chars`,
    `Content chars`,
    `Sys tokens`,
    `Schema tokens`,
    `Content tokens`,
  ];
  const row = [
    meta.pageType,
    formatCount(meta.sectionCount),
    formatCount(meta.fixedBlockCount),
    formatCount(meta.allowedBlockTypeMenuSize),
    formatCount(systemChars),
    formatCount(schemaChars),
    formatCount(contentChars),
    formatEstimatedTokens(systemTokens),
    formatEstimatedTokens(schemaTokens),
    formatEstimatedTokens(contentTokens),
  ];

  return [
    `| ${header.join(" | ")} |`,
    `| --- | ${header.slice(1).map(() => "---:").join(" | ")} |`,
    `| ${row.join(" | ")} |`,
    ``,
    `Sections: ${meta.sections.map((s) => `${s.id} (${s.type})`).join(", ")}`,
    ``,
    GENERATION_FOOTNOTE,
  ].join("\n");
}
