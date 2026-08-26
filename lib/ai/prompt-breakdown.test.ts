import { describe, it, expect, vi, afterEach } from "vitest";
import {
  part,
  joinParts,
  distributeTokensByChars,
  computeBreakdownRows,
  renderContextBreakdownTable,
  renderGenerationStructureTable,
  type PromptPart,
  type GenerationMeta,
} from "./prompt-breakdown";

describe("part / joinParts", () => {
  it("joins parts with exactly one blank line between them, none within", () => {
    const parts = [part("product_data", "Product", "PRODUCT:", "Widget"), part("user_instruction", "Instruction", "INSTRUCTION:", "Shorten it")];
    expect(joinParts(parts)).toBe("PRODUCT:\nWidget\n\nINSTRUCTION:\nShorten it");
  });

  it("reproduces the same content a hand-written array().join('\\n') would, for an array with blank-line separators", () => {
    const handWritten = [`PRODUCT:`, `Widget`, ``, `INSTRUCTION:`, `Shorten it`].join("\n");
    const parts = [part("product_data", "Product", "PRODUCT:", "Widget"), part("user_instruction", "Instruction", "INSTRUCTION:", "Shorten it")];
    expect(joinParts(parts)).toBe(handWritten);
  });

  it("handles a single part with no separator needed", () => {
    expect(joinParts([part("product_data", "Product", "PRODUCT:", "Widget")])).toBe("PRODUCT:\nWidget");
  });

  it("handles zero parts", () => {
    expect(joinParts([])).toBe("");
  });
});

describe("distributeTokensByChars", () => {
  it("distributes proportionally and sums exactly to the total", () => {
    const result = distributeTokensByChars([100, 200, 700], 1000);
    expect(result).toEqual([100, 200, 700]);
    expect(result.reduce((s, v) => s! + v!, 0)).toBe(1000);
  });

  it("uses largest-remainder rounding with a deterministic index tie-break", () => {
    // 10/3 = 3.33 each; floors sum to 9, one remaining token goes to the lowest index among equal remainders.
    expect(distributeTokensByChars([1, 1, 1], 10)).toEqual([4, 3, 3]);
  });

  it("always sums exactly to the real total across many uneven splits", () => {
    const cases: [number[], number][] = [
      [[7, 13, 5, 22, 1], 97],
      [[3, 3, 3, 3], 10],
      [[1, 1], 1],
      [[50, 1], 3],
    ];
    for (const [chars, tokens] of cases) {
      const result = distributeTokensByChars(chars, tokens);
      const sum = result.reduce((s, v) => s! + (v ?? 0), 0);
      expect(sum).toBe(tokens);
    }
  });

  it("returns all null when inputTokens is null — never fabricates a number", () => {
    expect(distributeTokensByChars([10, 20], null)).toEqual([null, null]);
  });

  it("returns all null when every char count is zero — nothing to distribute against", () => {
    expect(distributeTokensByChars([0, 0], 100)).toEqual([null, null]);
  });

  it("handles an empty chars array", () => {
    expect(distributeTokensByChars([], 100)).toEqual([]);
  });
});

describe("computeBreakdownRows", () => {
  const userParts: PromptPart[] = [
    part("product_data", "Product data", "PRODUCT:\nWidget"),
    part("user_instruction", "Instruction", "INSTRUCTION:\nShorten it"),
  ];

  it("builds a system_prompt row, one row per part, and a reconciling other row", () => {
    const userChars = userParts.reduce((s, p) => s + p.text.length, 0) + 2; // +2 for the "\n\n" separator
    const rows = computeBreakdownRows({ systemChars: 50, userChars, userParts, inputTokens: null });

    expect(rows[0]).toMatchObject({ key: "system_prompt", chars: 50 });
    expect(rows[1]).toMatchObject({ key: "product_data", chars: userParts[0].text.length });
    expect(rows[2]).toMatchObject({ key: "user_instruction", chars: userParts[1].text.length });
    const other = rows[rows.length - 1];
    expect(other.key).toBe("other");
    expect(other.chars).toBe(2);
  });

  it("total row chars reconcile exactly to systemChars + userChars", () => {
    const userChars = userParts.reduce((s, p) => s + p.text.length, 0) + 2;
    const rows = computeBreakdownRows({ systemChars: 50, userChars, userParts, inputTokens: null });
    const totalChars = rows.reduce((s, r) => s + r.chars, 0);
    expect(totalChars).toBe(50 + userChars);
  });

  it("every row's estimatedTokens is null when usage is unavailable", () => {
    const userChars = userParts.reduce((s, p) => s + p.text.length, 0) + 2;
    const rows = computeBreakdownRows({ systemChars: 50, userChars, userParts, inputTokens: null });
    expect(rows.every((r) => r.estimatedTokens === null)).toBe(true);
  });

  it("token estimates reconcile exactly to a real inputTokens total", () => {
    const userChars = userParts.reduce((s, p) => s + p.text.length, 0) + 2;
    const rows = computeBreakdownRows({ systemChars: 50, userChars, userParts, inputTokens: 500 });
    const totalTokens = rows.reduce((s, r) => s + (r.estimatedTokens ?? 0), 0);
    expect(totalTokens).toBe(500);
    expect(rows.every((r) => r.estimatedTokens !== null)).toBe(true);
  });

  it("renders a truthful negative 'other' (not clamped to zero) and warns when parts over-account for the user content", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const overCounted: PromptPart[] = [part("product_data", "Product data", "0123456789")]; // 10 chars
    const rows = computeBreakdownRows({ systemChars: 0, userChars: 5, userParts: overCounted, inputTokens: null });
    const other = rows[rows.length - 1];
    expect(other.chars).toBe(-5);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("renderContextBreakdownTable", () => {
  it("renders a header, one row per BreakdownRow, a bolded total row, and the estimate footnote", () => {
    const rows = computeBreakdownRows({
      systemChars: 100,
      userChars: 52,
      userParts: [part("product_data", "Product data", "0".repeat(50))],
      inputTokens: 40,
    });
    const table = renderContextBreakdownTable(rows);
    expect(table).toContain("| Context | Chars | Est. tokens |");
    expect(table).toContain("| System prompt | 100 |");
    expect(table).toContain("| Product data | 50 |");
    expect(table).toContain("**Total input**");
    expect(table).toMatch(/152/); // total chars
    expect(table).toContain("Estimated tokens");
  });

  it("shows 'unavailable' for every token cell, including the total, when usage was never reported", () => {
    const rows = computeBreakdownRows({
      systemChars: 10,
      userChars: 10,
      userParts: [part("product_data", "Product data", "0".repeat(10))],
      inputTokens: null,
    });
    const table = renderContextBreakdownTable(rows);
    const unavailableCount = table.split("unavailable").length - 1;
    expect(unavailableCount).toBeGreaterThanOrEqual(3); // system, product_data, other, and the total row
  });
});

describe("renderGenerationStructureTable", () => {
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

  it("reconciles System + Schema + Content chars and tokens to the request total", () => {
    const rows = computeBreakdownRows({
      systemChars: 30,
      userChars: 60,
      userParts: [
        part("schema_definitions", "Page structure", "0".repeat(40)),
        part("user_instruction", "Task brief", "0".repeat(18)),
      ],
      inputTokens: 90,
    });
    const table = renderGenerationStructureTable(meta, rows);
    expect(table).toContain("| Page | Sections | Fixed blocks | Block-menu size |");
    expect(table).toContain("product");
    expect(table).toContain("| 2 | 5 | 3 |");
    expect(table).toContain("Sections: hero (slideshow), main-product (main-product)");
    expect(table).toContain("Fixed blocks");
    expect(table).toContain("Block-menu size");
  });

  it("shows 'unavailable' tokens when usage was never reported", () => {
    const rows = computeBreakdownRows({
      systemChars: 30,
      userChars: 60,
      userParts: [
        part("schema_definitions", "Page structure", "0".repeat(40)),
        part("user_instruction", "Task brief", "0".repeat(18)),
      ],
      inputTokens: null,
    });
    const table = renderGenerationStructureTable(meta, rows);
    expect(table).toContain("unavailable");
  });
});
