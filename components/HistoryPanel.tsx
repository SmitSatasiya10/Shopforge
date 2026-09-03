"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { History as HistoryIcon } from "lucide-react";
import { VersionDiffModal } from "./VersionDiffModal";
import { formatAbsoluteTime, formatRelativeTime } from "@/lib/format/relative-time";
import { parseConfiguration, type StoreConfiguration } from "@/lib/store-config/store";
import { insertSection, removeSection, replaceSection } from "@/lib/store-config/template-ops";
import { diffConfigurations, type ConfigDiffEntry } from "@/lib/store-config/config-diff";

interface HistoryEntry {
  id: string;
  editCount: number;
  createdAt: string;
  updatedAt: string;
}

interface Checkpoint {
  configuration: StoreConfiguration;
  productTitle: string | null;
}

interface HistoryPanelProps {
  projectId: string;
  /** The editor's current, live values — diffed against whichever checkpoint gets selected. */
  configuration: StoreConfiguration;
  productTitle: string | null;
  onRestore: (result: { configuration: StoreConfiguration; productTitle: string | null }) => void;
}

/** Builds the section object a checkpoint restore of one section should produce, reusing the
 * same immutable template ops the editor's toolbars already use. */
function applySectionRestore(
  current: StoreConfiguration,
  checkpoint: StoreConfiguration,
  entry: Extract<ConfigDiffEntry, { scope: "section" }>,
): StoreConfiguration {
  const currentTemplate = current.templates[entry.page];
  const checkpointTemplate = checkpoint.templates[entry.page];

  const nextTemplate =
    entry.kind === "modified"
      ? replaceSection(currentTemplate, entry.sectionId, checkpointTemplate.sections[entry.sectionId])
      : entry.kind === "added"
        ? removeSection(currentTemplate, entry.sectionId)
        : (() => {
            // "removed" (existed at the checkpoint, gone now) — reinsert it at roughly the
            // same relative position by walking the checkpoint's order backward for the
            // nearest neighbor that still exists in the current draft.
            const checkpointOrder = checkpointTemplate.order ?? Object.keys(checkpointTemplate.sections);
            const currentOrder = currentTemplate.order ?? Object.keys(currentTemplate.sections);
            const posInCheckpoint = checkpointOrder.indexOf(entry.sectionId);
            let afterSectionId: string | null = null;
            for (let i = posInCheckpoint - 1; i >= 0; i--) {
              if (currentOrder.includes(checkpointOrder[i])) {
                afterSectionId = checkpointOrder[i];
                break;
              }
            }
            return insertSection(currentTemplate, entry.sectionId, checkpointTemplate.sections[entry.sectionId], afterSectionId);
          })();

  return { ...current, templates: { ...current.templates, [entry.page]: nextTemplate } };
}

/**
 * "Your recent changes" — lists the editor's autosave checkpoints (see
 * lib/history/checkpoint.ts, one row per burst of edits). Selecting one shows a diff against
 * the current draft (lib/store-config/config-diff.ts) so a bad AI rewrite can be recovered
 * from one section at a time instead of an all-or-nothing revert.
 */
export function HistoryPanel({ projectId, configuration, productTitle, onRestore }: HistoryPanelProps) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pendingCheckpoint, setPendingCheckpoint] = useState<Checkpoint | null>(null);
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

  // Selecting a different checkpoint isn't possible while this modal is open (it covers the
  // list), so pendingId only ever goes null -> id -> null — closeDiff always resets both.
  const closeDiff = useCallback(() => {
    setPendingId(null);
    setPendingCheckpoint(null);
  }, []);

  // Fetch the selected checkpoint's full snapshot once picked; the diff itself is derived
  // below rather than stored, so it always reflects the latest live `configuration`.
  useEffect(() => {
    if (!pendingId) return;
    let cancelled = false;
    fetch(`/api/project/${projectId}/history/${pendingId}`)
      .then((res) => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setPendingCheckpoint({
          configuration: parseConfiguration(data.version.configurationJson),
          productTitle: data.version.productTitle ?? null,
        });
      })
      .catch(() => {
        if (cancelled) return;
        // Dismiss the diff modal and surface the error on the list underneath instead of
        // leaving the modal stuck on "Loading…" with no explanation.
        closeDiff();
        setLoadError("Could not load this version");
      });
    return () => {
      cancelled = true;
    };
  }, [pendingId, projectId, closeDiff]);

  const diffEntries =
    pendingCheckpoint &&
    diffConfigurations(configuration, pendingCheckpoint.configuration, productTitle, pendingCheckpoint.productTitle);

  const applyAll = useCallback(() => {
    if (!pendingCheckpoint) return;
    onRestore({ configuration: pendingCheckpoint.configuration, productTitle: pendingCheckpoint.productTitle });
    setOpen(false);
    closeDiff();
  }, [pendingCheckpoint, onRestore, closeDiff]);

  const restoreSection = useCallback(
    (entry: Extract<ConfigDiffEntry, { scope: "section" }>) => {
      if (!pendingCheckpoint) return;
      onRestore({
        configuration: applySectionRestore(configuration, pendingCheckpoint.configuration, entry),
        productTitle: null,
      });
      setOpen(false);
      closeDiff();
    },
    [pendingCheckpoint, configuration, onRestore, closeDiff],
  );

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

      {pendingId ? (
        <VersionDiffModal
          entries={diffEntries}
          onApplyAll={applyAll}
          onRestoreSection={restoreSection}
          onCancel={closeDiff}
        />
      ) : null}
    </div>
  );
}
