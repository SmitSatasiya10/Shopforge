import type { ProductDTO } from "@/lib/product/db-mapping";
import type { AnalysisCheckId, AnalysisStepDefinition, CheckOutcome } from "./types";
import { checkProductData } from "./checks/product-data";
import { checkMargin } from "./checks/margin";
import { checkPerceivedValue } from "./checks/perceived-value";
import { checkReviews } from "./checks/reviews";
import { checkTrends } from "./checks/trends";
import { calculateProductScore } from "./score";

export const ANALYSIS_STEPS: AnalysisStepDefinition[] = [
  { id: "fetch", label: "Fetching product data" },
  { id: "margin", label: "Margin constraints" },
  { id: "perceived_value", label: "Perceived value" },
  { id: "reviews", label: "Review analysis" },
  { id: "trends", label: "Trend analysis" },
];

function runCheck(id: AnalysisCheckId, product: ProductDTO): CheckOutcome {
  try {
    switch (id) {
      case "fetch":
        return checkProductData(product);
      case "margin":
        return checkMargin(product);
      case "perceived_value":
        return checkPerceivedValue(product);
      case "reviews":
        return checkReviews();
      case "trends":
        return checkTrends();
    }
  } catch (err) {
    // Today's checks are pure and can't throw, but future checks may call a real
    // data provider — a defensive per-check catch keeps one bad check from taking
    // down the whole analysis.
    return {
      status: "failed",
      score: null,
      summary: "This check could not complete.",
      detail: err instanceof Error ? err.message : undefined,
    };
  }
}

export interface ProductAnalysisResult {
  outcomes: Record<AnalysisCheckId, CheckOutcome>;
  score: number | null;
  /** true only when the foundational "fetch" check failed — analysis can't proceed. */
  failed: boolean;
}

/** Runs every analysis check against an already-imported product. Pure and synchronous. */
export function analyzeProduct(product: ProductDTO): ProductAnalysisResult {
  const outcomes = {} as Record<AnalysisCheckId, CheckOutcome>;
  for (const step of ANALYSIS_STEPS) {
    outcomes[step.id] = runCheck(step.id, product);
  }

  const failed = outcomes.fetch.status === "failed";
  const score = failed ? null : calculateProductScore(outcomes);

  return { outcomes, score, failed };
}
