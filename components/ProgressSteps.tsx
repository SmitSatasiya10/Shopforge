import { Fragment } from "react";

const STEPS = ["Start", "Product URL", "Products", "Analysis"] as const;

// Header/progress area shared by the Start Store -> URL entry -> Products Found ->
// Analysis flow (docs/product-phases/02-product-import.md,
// product-analysis-progress-screen-prompt.md). Back is omitted on the first step since
// there's nowhere to go back to.
export function ProgressSteps({ step, onBack }: { step: 1 | 2 | 3 | 4; onBack?: () => void }) {
  return (
    <div className="flex items-center gap-4 border-b border-neutral-800 bg-neutral-950 px-4 py-4 sm:px-8">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          aria-label="Go back"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-neutral-800 text-neutral-400 transition hover:border-neutral-600 hover:bg-neutral-800 hover:text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
        >
          <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.75">
            <path d="M12.5 4.5 7 10l5.5 5.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      ) : (
        <div className="h-9 w-9 shrink-0" aria-hidden="true" />
      )}

      <div
        className="mx-auto flex w-full max-w-2xl items-center"
        role="progressbar"
        aria-valuenow={step}
        aria-valuemin={1}
        aria-valuemax={STEPS.length}
        aria-valuetext={`Step ${step} of ${STEPS.length}: ${STEPS[step - 1]}`}
      >
        {STEPS.map((label, i) => {
          const done = i + 1 < step;
          const current = i + 1 === step;
          return (
            <Fragment key={label}>
              {i > 0 && (
                <div className={`mx-3 h-px min-w-4 flex-1 rounded-full ${done || current ? "bg-neutral-400" : "bg-neutral-800"}`} />
              )}
              <div className="flex shrink-0 items-center gap-2.5">
                <span
                  className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold transition ${
                    done
                      ? "bg-neutral-100 text-neutral-900"
                      : current
                        ? "border-2 border-neutral-100 bg-neutral-900 text-neutral-100"
                        : "border border-neutral-700 bg-neutral-950 text-neutral-500"
                  }`}
                  aria-hidden="true"
                >
                  {done ? (
                    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="m4.5 10.5 3.5 3.5 7.5-8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : (
                    i + 1
                  )}
                </span>
                <span
                  className={`hidden whitespace-nowrap text-sm sm:block ${
                    current ? "font-medium text-neutral-100" : done ? "text-neutral-300" : "text-neutral-500"
                  }`}
                >
                  {label}
                </span>
              </div>
            </Fragment>
          );
        })}
      </div>

      <div className="h-9 w-9 shrink-0" aria-hidden="true" />
    </div>
  );
}
