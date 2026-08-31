import { useEffect, type RefObject } from "react";

/** Closes an open floating panel (dropdown/menu) on an outside click or Escape — the
 * non-editor-chrome variant of the pattern in components/HistoryPanel.tsx (no `blur`
 * listener, since that one exists only to catch clicks landing inside a same-origin
 * preview iframe, which nothing outside the editor has). */
export function useOutsideDismiss(rootRef: RefObject<HTMLElement | null>, open: boolean, onDismiss: () => void) {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onDismiss();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, rootRef, onDismiss]);
}
