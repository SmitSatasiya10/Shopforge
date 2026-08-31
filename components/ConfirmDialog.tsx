"use client";

import { useEffect, useRef } from "react";
import { Info, Trash2 } from "lucide-react";

interface ConfirmDialogProps {
  title: string;
  message: string;
  /** Label for the action button, e.g. "Delete" or "Publish". */
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** "destructive" (default) is red/Trash2, for delete-style actions. "info" is a neutral
   * purple/Info icon and button, for confirms that change state without destroying anything
   * (e.g. "make this theme active"). */
  tone?: "destructive" | "info";
}

/**
 * In-app replacement for `window.confirm`, styled like the editor's floating cards (dark
 * neutral-900, ring-white/10 — see AiRewritePopover). Escape or a backdrop click cancels;
 * focus starts on Cancel so Enter never confirms by accident.
 */
export function ConfirmDialog({ title, message, confirmLabel, onConfirm, onCancel, tone = "destructive" }: ConfirmDialogProps) {
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
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-neutral-950/50 p-4"
      onMouseDown={onCancel}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl bg-neutral-900 p-5 text-white shadow-2xl ring-1 ring-white/10"
      >
        <div className="flex items-start gap-3">
          <span
            className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${
              tone === "destructive" ? "bg-red-500/15 text-red-400" : "bg-[#8B5CF6]/15 text-[#A78BFA]"
            }`}
          >
            {tone === "destructive" ? (
              <Trash2 className="h-4.5 w-4.5" strokeWidth={1.75} />
            ) : (
              <Info className="h-4.5 w-4.5" strokeWidth={1.75} />
            )}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold">{title}</p>
            <p className="mt-1 text-xs leading-relaxed text-neutral-400">{message}</p>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelRef}
            onClick={onCancel}
            className="rounded-full px-4 py-1.5 text-xs font-medium text-neutral-300 ring-1 ring-white/15 hover:bg-neutral-700 hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`rounded-full px-4 py-1.5 text-xs font-medium text-white ${
              tone === "destructive" ? "bg-red-500 hover:bg-red-400" : "bg-[#8B5CF6] hover:bg-[#7C3AED]"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
