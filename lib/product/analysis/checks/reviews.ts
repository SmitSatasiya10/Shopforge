import type { CheckOutcome } from "../types";

// No review data source is connected yet — there's no Review model and no third-party
// reviews API integrated into this project. Per an explicit product decision, this check
// is shown as "completed" with a fixed placeholder score instead of "unavailable" so it
// doesn't visibly stand out as incomplete on the analysis screen. This is NOT a real
// review signal — no rating/count/sentiment is invented, only a flat neutral score that
// contributes to the overall product score. Swap the body of this function for a real
// provider (e.g. a reviews API keyed by product/vendor) when one exists, and remove the
// placeholder.
const PLACEHOLDER_SCORE = 65;

export function checkReviews(): CheckOutcome {
  return {
    status: "completed",
    score: PLACEHOLDER_SCORE,
    summary: "Review data isn't connected yet — showing a placeholder signal.",
  };
}
