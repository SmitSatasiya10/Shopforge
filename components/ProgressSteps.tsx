import { Fragment } from "react";

const STEPS = ["Source", "Product URL", "Products", "Analysis", "Language", "Persona", "Visuals"] as const;

// Header/progress area shared by the Start Store -> URL entry -> Products Found ->
// Analysis -> Customer Language -> Customer Persona -> Product Images flow
// (docs/product-phases/02-product-import.md, product-analysis-progress-screen-prompt.md,
// store-content-language-selection-implementation.md,
// product_based_customer_persona_implementation.md,
// shopforge-personalization-image-selection-plan.md). Marketing Angle is a substep of
// Persona (never its own entry here); Product Images is a real 7th step. Back is omitted on
// the first step since there's nowhere to go back to. Labels here are the shortened,
// presentation-only names for the pipeline UI — step count and order stay 1:1 with the
// underlying wizard state.
export function ProgressSteps({ step, onBack }: { step: 1 | 2 | 3 | 4 | 5 | 6 | 7; onBack?: () => void }) {
  return (
    <div className="flex items-center gap-4 border-b border-white/[0.08] bg-[#09090B] px-4 py-4 sm:px-8">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          aria-label="Go back"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 text-[#A1A1AA] transition duration-200 hover:border-white/20 hover:bg-white/5 hover:text-[#FAFAFA] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8B5CF6]/60"
        >
          <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.75">
            <path d="M12.5 4.5 7 10l5.5 5.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      ) : (
        <div className="h-9 w-9 shrink-0" aria-hidden="true" />
      )}

      <div
        className="mx-auto flex w-full max-w-5xl items-center overflow-x-auto"
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
                <div
                  className={`mx-2.5 h-px min-w-4 flex-1 rounded-full transition-colors duration-300 sm:mx-3 ${
                    done ? "bg-white/20" : "bg-white/[0.08]"
                  }`}
                />
              )}
              <div className="flex shrink-0 items-center gap-2.5">
                <span
                  className={`flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold transition duration-200 ${
                    done
                      ? "border border-white/15 bg-white/[0.06] text-[#A1A1AA]"
                      : current
                        ? "border-2 border-[#8B5CF6] bg-[#8B5CF6]/10 text-[#FAFAFA] shadow-[0_0_0_4px_rgba(139,92,246,0.14)]"
                        : "border border-white/10 bg-transparent text-[#71717A]"
                  }`}
                  aria-hidden="true"
                >
                  {done ? (
                    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="m4.5 10.5 3.5 3.5 7.5-8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : (
                    String(i + 1).padStart(2, "0")
                  )}
                </span>
                <span
                  className={`hidden whitespace-nowrap text-[11px] font-medium tracking-[0.06em] uppercase sm:block ${
                    current ? "text-[#FAFAFA]" : done ? "text-[#A1A1AA]" : "text-[#71717A]"
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
