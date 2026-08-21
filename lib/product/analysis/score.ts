import type { AnalysisCheckId, CheckOutcome } from "./types";

// Relative importance of each check. Documented here rather than inferred: product-data
// completeness and margin/perceived-value signals we can actually compute today are
// weighted equally and heavily; reviews/trends are weighted lower since they currently
// run against a fixed placeholder score (checks/reviews.ts, checks/trends.ts) rather than
// a real data source. A check that does resolve "unavailable" or "failed" (e.g. margin
// with no price at all) is still excluded from the average entirely.
export const CHECK_WEIGHTS: Record<AnalysisCheckId, number> = {
  fetch: 25,
  margin: 25,
  perceived_value: 25,
  reviews: 15,
  trends: 10,
};

/**
 * Weighted average of every "completed" check's 0-100 sub-score, re-normalized over
 * only the checks that actually produced a score. A check that's "unavailable" (no data
 * source) or "failed" contributes nothing to either the numerator or denominator — this
 * is what keeps the score honest instead of scoring absent data as zero or as neutral.
 * Returns null only if not a single check produced a usable score.
 */
export function calculateProductScore(outcomes: Record<AnalysisCheckId, CheckOutcome>): number | null {
  let weightedSum = 0;
  let weightTotal = 0;

  for (const id of Object.keys(CHECK_WEIGHTS) as AnalysisCheckId[]) {
    const outcome = outcomes[id];
    if (outcome && outcome.status === "completed" && outcome.score !== null) {
      weightedSum += outcome.score * CHECK_WEIGHTS[id];
      weightTotal += CHECK_WEIGHTS[id];
    }
  }

  if (weightTotal === 0) return null;
  return Math.round(weightedSum / weightTotal);
}

/**
 * Purely presentational: a monotonically increasing value from 0 up to `finalScore` as
 * more steps are revealed during the analysis animation. This must NEVER be used as (or
 * confused with) the real score — the real score is always calculateProductScore() over
 * the complete, final set of outcomes, computed once and never recomputed from whatever
 * subset of checks happens to be revealed so far. That distinction is what stops the
 * displayed number from starting high (e.g. because the first-revealed check alone
 * scored well) and drifting down as weaker checks join a live average.
 */
export function animatedScoreAtStep(finalScore: number | null, revealedSteps: number, totalSteps: number): number | null {
  if (finalScore === null) return null;
  if (revealedSteps <= 0) return 0;
  if (revealedSteps >= totalSteps) return finalScore;
  return Math.round((finalScore * revealedSteps) / totalSteps);
}
