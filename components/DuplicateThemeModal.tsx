"use client";

import { useState } from "react";

// Naming step for "Duplicate" — pre-filled but editable, since theme names are user-facing
// (theme cards, the editor breadcrumb) and a stray "(Copy)" left unedited would linger in
// daily use. Shared by the theme-management page's card menu and the editor's own header.
export function DuplicateThemeModal({
  sourceName,
  onClose,
  onConfirm,
}: {
  sourceName: string;
  onClose: () => void;
  onConfirm: (name: string) => void;
}) {
  const [name, setName] = useState(`${sourceName} (Copy)`);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-neutral-950/50 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Duplicate theme"
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl bg-neutral-900 p-5 text-white shadow-2xl ring-1 ring-white/10"
      >
        <p className="text-sm font-semibold">Duplicate &quot;{sourceName}&quot;</p>
        <label className="mt-4 block">
          <span className="text-[11px] text-neutral-400">New theme name</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && name.trim() && onConfirm(name.trim())}
            className="mt-1 w-full rounded-lg border border-white/15 bg-neutral-800 px-2.5 py-1.5 text-xs text-white"
          />
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-full px-4 py-1.5 text-xs font-medium text-neutral-300 ring-1 ring-white/15 hover:bg-neutral-700 hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={() => name.trim() && onConfirm(name.trim())}
            disabled={!name.trim()}
            className="rounded-full bg-[#8B5CF6] px-4 py-1.5 text-xs font-medium text-white hover:bg-[#7C3AED] disabled:opacity-50"
          >
            Duplicate
          </button>
        </div>
      </div>
    </div>
  );
}
