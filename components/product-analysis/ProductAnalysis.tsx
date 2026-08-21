"use client";

import { useEffect, useMemo, useState } from "react";
import type { ProductDTO } from "@/lib/product/db-mapping";
import { ANALYSIS_STEPS, analyzeProduct } from "@/lib/product/analysis/analyze-product";
import { animatedScoreAtStep } from "@/lib/product/analysis/score";
import { AnalysisStepRow, type StepVisualStatus } from "./AnalysisStepRow";
import { ScoreMeter } from "./ScoreMeter";
import { ProductPreview } from "./ProductPreview";

// Paced reveal so results don't all flash in at once for a fast (already-computed)
// analysis — see §5/§17: the animation only paces when each row is *revealed*, the
// underlying result was already computed by real, deterministic logic beforehand.
const STEP_REVEAL_MS = 480;

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : false,
  );
  useEffect(() => {
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const listener = () => setReduced(mql.matches);
    mql.addEventListener("change", listener);
    return () => mql.removeEventListener("change", listener);
  }, []);
  return reduced;
}

export function ProductAnalysis({
  product,
  onContinue,
  continuing,
}: {
  product: ProductDTO;
  onContinue: () => void;
  continuing: boolean;
}) {
  const result = useMemo(() => analyzeProduct(product), [product]);
  const reducedMotion = useReducedMotion();
  const [revealedCount, setRevealedCount] = useState(0);

  useEffect(() => {
    if (result.failed || revealedCount >= ANALYSIS_STEPS.length) return;
    const delay = reducedMotion ? 0 : STEP_REVEAL_MS;
    const timer = setTimeout(() => setRevealedCount((c) => c + 1), delay);
    return () => clearTimeout(timer);
  }, [revealedCount, reducedMotion, result.failed]);

  const running = !result.failed && revealedCount < ANALYSIS_STEPS.length;
  const done = !result.failed && revealedCount >= ANALYSIS_STEPS.length;

  const latestLabel = revealedCount > 0 && revealedCount <= ANALYSIS_STEPS.length ? ANALYSIS_STEPS[revealedCount - 1] : null;
  const latestOutcome = latestLabel ? result.outcomes[latestLabel.id] : null;

  // result.score is the real, complete, deterministic score — computed once over every
  // check, never recomputed from a partial subset. displayScore only paces how that
  // fixed number is *revealed* on screen (0 -> result.score as steps complete); it can
  // never show a value the real score didn't land on, and never counts down.
  const displayScore = animatedScoreAtStep(result.score, revealedCount, ANALYSIS_STEPS.length);

  if (result.failed) {
    const reason = result.outcomes.fetch.detail ?? result.outcomes.fetch.summary;
    return (
      <div className="mx-auto w-full max-w-md flex-1 px-4 py-16">
        <h1 className="text-xl font-semibold text-neutral-100">Unable to analyze this product</h1>
        <p className="mt-2 text-sm text-neutral-400">{reason}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl flex-1 px-4 py-12 sm:px-8">
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1fr_auto]">
        <div>
          <div className="flex items-baseline justify-between">
            <h1 className="text-2xl font-semibold text-neutral-50">Your product score</h1>
            <span className="text-3xl font-semibold text-neutral-50 transition-all duration-300" aria-hidden="true">
              {displayScore ?? "—"}
            </span>
          </div>

          <div className="mt-4">
            <ScoreMeter score={displayScore} />
          </div>

          <p aria-live="polite" className="sr-only">
            {latestLabel && latestOutcome
              ? `${latestLabel.label}: ${latestOutcome.status}. ${latestOutcome.summary}`
              : "Starting analysis…"}
          </p>

          <div className="mt-6 flex flex-col gap-2">
            {ANALYSIS_STEPS.map((step, i) => {
              const outcome = result.outcomes[step.id];
              let status: StepVisualStatus;
              if (i < revealedCount) status = outcome.status;
              else if (i === revealedCount && running) status = "running";
              else status = "pending";

              return (
                <AnalysisStepRow
                  key={step.id}
                  label={step.label}
                  status={status}
                  detail={i < revealedCount ? (outcome.detail ?? outcome.summary) : undefined}
                />
              );
            })}
          </div>
        </div>

        <ProductPreview product={product} complete={done} />
      </div>

      <button
        type="button"
        onClick={onContinue}
        disabled={running || continuing}
        className="mt-10 rounded-lg bg-neutral-50 px-5 py-3 text-sm font-medium text-neutral-900 transition hover:bg-neutral-200 disabled:opacity-60"
      >
        {continuing ? "Creating store…" : "Continue"}
      </button>
      {!done && !continuing && (
        <p className="mt-2 text-xs text-neutral-500">Continue unlocks once analysis finishes.</p>
      )}
    </div>
  );
}
