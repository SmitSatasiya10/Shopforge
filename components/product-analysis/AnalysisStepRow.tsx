export type StepVisualStatus = "pending" | "running" | "completed" | "unavailable" | "failed";

const STATUS_TEXT: Record<StepVisualStatus, string> = {
  pending: "Pending",
  running: "Running",
  completed: "Complete",
  unavailable: "Unavailable",
  failed: "Failed",
};

function StatusIcon({ status }: { status: StepVisualStatus }) {
  if (status === "completed") {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400" aria-hidden="true">
        ✓
      </span>
    );
  }
  if (status === "unavailable") {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-neutral-800 text-neutral-500" aria-hidden="true">
        –
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-500/20 text-red-400" aria-hidden="true">
        ✕
      </span>
    );
  }
  if (status === "running") {
    return (
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full bg-neutral-100 motion-safe:animate-pulse"
        aria-hidden="true"
      />
    );
  }
  return <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-neutral-700" aria-hidden="true" />;
}

// A single analysis check row (product-analysis-progress-screen-prompt.md §2/§4). Status
// is never communicated by color alone — the icon shape and the sr-only text both change.
export function AnalysisStepRow({
  label,
  status,
  detail,
}: {
  label: string;
  status: StepVisualStatus;
  detail?: string;
}) {
  const dim = status === "pending";
  return (
    <div
      className={`flex items-start gap-3 rounded-lg border border-neutral-800 px-4 py-3 transition-opacity ${
        dim ? "opacity-50" : "opacity-100"
      }`}
    >
      <StatusIcon status={status} />
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-medium ${status === "failed" ? "text-red-300" : "text-neutral-100"}`}>
          {label}
          <span className="sr-only"> — {STATUS_TEXT[status]}</span>
        </p>
        {detail && status !== "pending" && <p className="mt-0.5 text-xs text-neutral-500">{detail}</p>}
      </div>
    </div>
  );
}
