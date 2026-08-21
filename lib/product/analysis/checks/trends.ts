import type { CheckOutcome } from "../types";

// No market/trend data provider is connected yet — see reviews.ts for the identical
// reasoning. Per an explicit product decision, this check is shown as "completed" with a
// fixed placeholder score instead of "unavailable"; no demand/search-volume/growth figure
// is invented, only a flat neutral score. Swap the body of this function for a real
// provider when one exists, and remove the placeholder.
const PLACEHOLDER_SCORE = 60;

export function checkTrends(): CheckOutcome {
  return {
    status: "completed",
    score: PLACEHOLDER_SCORE,
    summary: "Trend data isn't connected yet — showing a placeholder signal.",
  };
}
