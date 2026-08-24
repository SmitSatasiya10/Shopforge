import { describe, it, expect } from "vitest";
import { calculateProductScore, animatedScoreAtStep } from "./score";
import type { AnalysisCheckId, CheckOutcome } from "./types";

function outcome(status: CheckOutcome["status"], score: number | null): CheckOutcome {
  return { status, score, summary: "" };
}

describe("calculateProductScore", () => {
  it("returns a score in [80, 100] when at least one check is usable", () => {
    const outcomes = {
      fetch: outcome("completed", 100),
      margin: outcome("completed", 50),
      perceived_value: outcome("unavailable", null),
      reviews: outcome("unavailable", null),
      trends: outcome("unavailable", null),
    } as Record<AnalysisCheckId, CheckOutcome>;

    for (let i = 0; i < 20; i++) {
      const score = calculateProductScore(outcomes);
      expect(score).not.toBeNull();
      expect(score).toBeGreaterThanOrEqual(80);
      expect(score).toBeLessThanOrEqual(100);
    }
  });

  it("returns null when nothing produced a usable score", () => {
    const outcomes = {
      fetch: outcome("failed", null),
      margin: outcome("unavailable", null),
      perceived_value: outcome("unavailable", null),
      reviews: outcome("unavailable", null),
      trends: outcome("unavailable", null),
    } as Record<AnalysisCheckId, CheckOutcome>;
    expect(calculateProductScore(outcomes)).toBeNull();
  });
});

describe("animatedScoreAtStep", () => {
  it("starts at 0 before any step is revealed — never the final score up front", () => {
    expect(animatedScoreAtStep(93, 0, 5)).toBe(0);
  });

  it("lands exactly on the final score once every step is revealed", () => {
    expect(animatedScoreAtStep(93, 5, 5)).toBe(93);
    expect(animatedScoreAtStep(93, 8, 5)).toBe(93); // clamps past totalSteps too
  });

  it("is monotonically non-decreasing — this is the regression test for the 'starts high then drops' bug", () => {
    const finalScore = 83;
    const totalSteps = 5;
    const sequence = Array.from({ length: totalSteps + 1 }, (_, i) => animatedScoreAtStep(finalScore, i, totalSteps)!);
    for (let i = 1; i < sequence.length; i++) {
      expect(sequence[i]).toBeGreaterThanOrEqual(sequence[i - 1]);
    }
    expect(sequence[0]).toBe(0);
    expect(sequence[sequence.length - 1]).toBe(finalScore);
  });

  it("passes a null final score through without inventing a number", () => {
    expect(animatedScoreAtStep(null, 3, 5)).toBeNull();
  });
});
