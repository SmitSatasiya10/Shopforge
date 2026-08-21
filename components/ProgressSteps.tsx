const STEPS = ["Start", "Product URL", "Products Found", "Analysis"] as const;

// Header/progress area shared by the Start Store -> URL entry -> Products Found ->
// Analysis flow (docs/product-phases/02-product-import.md,
// product-analysis-progress-screen-prompt.md). Back is omitted on the first step since
// there's nowhere to go back to.
export function ProgressSteps({ step, onBack }: { step: 1 | 2 | 3 | 4; onBack?: () => void }) {
  return (
    <div className="flex items-center gap-4 border-b border-neutral-800 px-4 py-3 sm:px-8">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          aria-label="Go back"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-400 transition hover:bg-neutral-800 hover:text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
        >
          ←
        </button>
      ) : (
        <div className="h-8 w-8 shrink-0" aria-hidden="true" />
      )}
      <div
        className="flex flex-1 items-center gap-2"
        role="progressbar"
        aria-valuenow={step}
        aria-valuemin={1}
        aria-valuemax={STEPS.length}
        aria-valuetext={`Step ${step} of ${STEPS.length}: ${STEPS[step - 1]}`}
      >
        {STEPS.map((label, i) => (
          <div key={label} className={`h-1 flex-1 rounded-full ${i < step ? "bg-neutral-100" : "bg-neutral-800"}`} />
        ))}
      </div>
      <span className="shrink-0 text-xs text-neutral-500">{STEPS[step - 1]}</span>
    </div>
  );
}
