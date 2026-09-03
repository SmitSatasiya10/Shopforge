"use client";

import { useEffect, useRef } from "react";
import type { ConfigDiffEntry } from "@/lib/store-config/config-diff";

function pageLabel(page: "index" | "product"): string {
  return page === "index" ? "Homepage" : "Product page";
}

function kindBadge(kind: "added" | "removed" | "modified") {
  const styles: Record<typeof kind, string> = {
    added: "bg-emerald-500/15 text-emerald-400",
    removed: "bg-red-500/15 text-red-400",
    modified: "bg-[#8B5CF6]/15 text-[#A78BFA]",
  };
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${styles[kind]}`}>{kind}</span>;
}

function DetailList({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return <p className="mt-0.5 truncate text-[11px] text-neutral-400">{items.join(", ")}</p>;
}

interface VersionDiffModalProps {
  /** null while the checkpoint's snapshot is still being fetched. */
  entries: ConfigDiffEntry[] | null;
  onApplyAll: () => void;
  onRestoreSection: (entry: Extract<ConfigDiffEntry, { scope: "section" }>) => void;
  onCancel: () => void;
}

/**
 * Shown when a checkpoint is selected from the history panel, in place of a generic "are you
 * sure" confirm — lists what actually differs from the current draft so a bad AI rewrite can
 * be recovered from one section at a time instead of discarding every edit made since.
 */
export function VersionDiffModal({ entries, onApplyAll, onRestoreSection, onCancel }: VersionDiffModalProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-neutral-950/50 p-4" onMouseDown={onCancel}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label="What changed"
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-md flex-col rounded-2xl bg-neutral-900 p-5 text-white shadow-2xl ring-1 ring-white/10"
      >
        <p className="text-sm font-semibold">What changed since this version</p>

        {entries === null ? (
          <p className="mt-3 text-xs text-neutral-400">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="mt-3 text-xs text-neutral-400">No changes since this version.</p>
        ) : (
          <ul className="mt-3 -mr-1 space-y-1 overflow-y-auto pr-1">
            {entries.map((entry, i) => (
              <li key={i} className="rounded-lg px-2 py-2 hover:bg-white/5">
                {entry.scope === "section" ? (
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        {kindBadge(entry.kind)}
                        <span className="truncate text-xs font-medium">{entry.label}</span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-neutral-500">{pageLabel(entry.page)}</p>
                      <DetailList items={entry.changedSettings} />
                      <DetailList items={entry.changedBlocks.map((id) => `block: ${id}`)} />
                    </div>
                    <button
                      onClick={() => onRestoreSection(entry)}
                      className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium text-neutral-300 ring-1 ring-white/15 hover:bg-neutral-700 hover:text-white"
                    >
                      Restore
                    </button>
                  </div>
                ) : entry.scope === "order" ? (
                  <p className="text-xs text-neutral-300">
                    {pageLabel(entry.page)} sections reordered
                  </p>
                ) : entry.scope === "theme" ? (
                  <div className="flex items-center gap-1.5">
                    {kindBadge(entry.kind)}
                    <span className="text-xs text-neutral-300">Theme setting: {entry.label}</span>
                  </div>
                ) : (
                  <p className="text-xs text-neutral-300">
                    Product title: &quot;{entry.before ?? "—"}&quot; → &quot;{entry.after ?? "—"}&quot;
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}

        {entries && entries.length > 0 ? (
          <p className="mt-3 text-[11px] text-neutral-500">
            Undo (Ctrl+Z) right after to bring back what you just replaced.
          </p>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          <button
            ref={cancelRef}
            onClick={onCancel}
            className="rounded-full px-4 py-1.5 text-xs font-medium text-neutral-300 ring-1 ring-white/15 hover:bg-neutral-700 hover:text-white"
          >
            Cancel
          </button>
          {entries && entries.length > 0 ? (
            <button
              onClick={onApplyAll}
              className="rounded-full bg-[#8B5CF6] px-4 py-1.5 text-xs font-medium text-white hover:bg-[#7C3AED]"
            >
              Apply all
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
