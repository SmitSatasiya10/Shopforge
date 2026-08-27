"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { History as HistoryIcon } from "lucide-react";
import { ConfirmDialog } from "./ConfirmDialog";
import { formatAbsoluteTime, formatRelativeTime } from "@/lib/format/relative-time";
import { parseConfiguration, type StoreConfiguration } from "@/lib/store-config/store";

interface HistoryEntry {
  id: string;
  editCount: number;
  createdAt: string;
  updatedAt: string;
}

interface HistoryPanelProps {
  projectId: string;
  onRestore: (result: { configuration: StoreConfiguration; productTitle: string | null }) => void;
}

/**
 * "Your recent changes" — lists the editor's autosave checkpoints (see
 * lib/history/checkpoint.ts, one row per burst of edits) and lets the user click one to
 * restore the project to that point in time. A restore is just handed back to the caller
 * as {configuration, productTitle}; the editor commits it through its normal edit path, so
 * it autosaves and shows up as a new checkpoint afterward like any other change.
 */
export function HistoryPanel({ projectId, onRestore }: HistoryPanelProps) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    fetch(`/api/project/${projectId}/history`)
      .then((res) => res.json())
      .then((data) => setEntries(data.versions ?? []))
      .catch(() => setLoadError("Could not load history"));
  }, [open, projectId]);

  const toggleOpen = () => {
    const next = !open;
    setOpen(next);
    if (next) {
      setLoadError(null);
      setEntries(null);
    }
  };

  // Same outside-click/Escape dismissal as the editor's other floating panels. A click inside
  // the preview never reaches this window's "mousedown" — it's a same-origin iframe, and
  // clicking into it moves focus into the iframe's own browsing context instead of bubbling
  // here (see PreviewFrame's onUndo/onRedo doc comment for the same fact). That focus move
  // fires "blur" on this window, which is what actually catches the "clicked the preview" case.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onBlur = () => setOpen(false);
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", onBlur);
    };
  }, [open]);

  const restore = useCallback(
    async (versionId: string) => {
      if (restoring) return;
      setRestoring(true);
      try {
        const res = await fetch(`/api/project/${projectId}/history/${versionId}`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        const configuration = parseConfiguration(data.version.configurationJson);
        onRestore({ configuration, productTitle: data.version.productTitle ?? null });
        setOpen(false);
      } catch {
        setLoadError("Could not apply this version");
      } finally {
        setRestoring(false);
        setPendingId(null);
      }
    },
    [projectId, onRestore, restoring],
  );

  const pendingEntry = entries?.find((e) => e.id === pendingId) ?? null;

  return (
    <div className="relative" ref={rootRef}>
      <button
        onClick={toggleOpen}
        title="Recent changes"
        className={`rounded p-1.5 text-neutral-400 hover:bg-white/10 hover:text-white ${open ? "bg-white/10 text-white" : ""}`}
      >
        <HistoryIcon className="h-3.5 w-3.5" />
      </button>

      {open ? (
        <div className="absolute top-full right-0 z-30 mt-2 w-72 rounded-2xl bg-neutral-900 p-2 text-white shadow-2xl ring-1 ring-white/10">
          <p className="px-2 pt-1 pb-2 text-xs font-semibold">Your recent changes</p>
          {loadError ? (
            <p className="px-2 pb-2 text-xs text-red-400">{loadError}</p>
          ) : entries === null ? (
            <p className="px-2 pb-2 text-xs text-neutral-400">Loading…</p>
          ) : entries.length === 0 ? (
            <p className="px-2 pb-2 text-xs text-neutral-400">No changes yet.</p>
          ) : (
            <ul className="max-h-64 space-y-0.5 overflow-y-auto">
              {entries.map((entry) => (
                <li key={entry.id}>
                  <button
                    onClick={() => setPendingId(entry.id)}
                    disabled={restoring}
                    className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-neutral-700 disabled:opacity-50"
                  >
                    <p className="text-xs font-medium">{formatRelativeTime(new Date(entry.updatedAt))}</p>
                    <p className="text-[11px] text-neutral-400">
                      {entry.editCount} update{entry.editCount === 1 ? "" : "s"} at{" "}
                      {formatAbsoluteTime(new Date(entry.updatedAt))}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {pendingEntry ? (
        <ConfirmDialog
          title="Apply this version?"
          message="Your current changes will be replaced with this earlier version. Undo (Ctrl+Z) right after to bring them back."
          confirmLabel={restoring ? "Applying…" : "Apply"}
          onConfirm={() => restore(pendingEntry.id)}
          onCancel={() => setPendingId(null)}
        />
      ) : null}
    </div>
  );
}
