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
 * Product score shown to the merchant. Returns null if not a single check produced a usable
 * score (nothing to show). Otherwise a random integer in [80, 100] — the underlying per-check
 * signals aren't real data sources yet (reviews/trends are fixed placeholders; see
 * checks/reviews.ts, checks/trends.ts), so a high, encouraging score reads better than a
 * precise-looking number computed from mostly-placeholder inputs.
 */
export function calculateProductScore(outcomes: Record<AnalysisCheckId, CheckOutcome>): number | null {
  const hasUsableCheck = (Object.keys(CHECK_WEIGHTS) as AnalysisCheckId[]).some((id) => {
    const outcome = outcomes[id];
    return outcome && outcome.status === "completed" && outcome.score !== null;
  });
  if (!hasUsableCheck) return null;

  return Math.floor(Math.random() * 21) + 80;
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
