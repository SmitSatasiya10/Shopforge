// Product Analysis — deterministic checks over an already-imported product
// (product-analysis-progress-screen-prompt.md §11/§17/§18). Every check is a pure
// function of ProductDTO; nothing here calls out to a real market/review data
// provider yet, so checks without a real data source resolve to "unavailable"
// rather than inventing a result.

export type AnalysisCheckId = "fetch" | "margin" | "perceived_value" | "reviews" | "trends";

export type CheckStatus = "completed" | "unavailable" | "failed";

export interface CheckOutcome {
  status: CheckStatus;
  /** 0-100 sub-score. Always null unless status is "completed" — an unavailable or
   *  failed check must never contribute a fabricated number to the overall score. */
  score: number | null;
  summary: string;
  detail?: string;
}

export interface AnalysisStepDefinition {
  id: AnalysisCheckId;
  label: string;
}
