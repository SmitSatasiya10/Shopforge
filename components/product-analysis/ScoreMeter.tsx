const SEGMENT_COUNT = 40;

// Segmented score meter (product-analysis-progress-screen-prompt.md §7). Uses one accent
// color rather than a rainbow gradient to match the app's existing monochrome dark shell.
export function ScoreMeter({ score }: { score: number | null }) {
  const filled = score === null ? 0 : Math.round((score / 100) * SEGMENT_COUNT);

  return (
    <div
      role="img"
      aria-label={score === null ? "Product score not yet available" : `Product score ${score} out of 100`}
      className="flex h-16 items-end gap-[3px]"
    >
      {Array.from({ length: SEGMENT_COUNT }, (_, i) => (
        <div
          key={i}
          aria-hidden="true"
          className={`flex-1 rounded-sm transition-colors duration-300 ${
            i < filled ? "bg-neutral-50" : "bg-neutral-800"
          }`}
          style={{ height: `${30 + ((i % 7) * 6 + 10)}%` }}
        />
      ))}
    </div>
  );
}
