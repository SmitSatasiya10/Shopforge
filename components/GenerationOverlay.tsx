"use client";

import { LoaderCircle } from "lucide-react";
import type { SelectionRect } from "./PreviewFrame";

interface GenerationOverlayProps {
  visible: boolean;
  label?: string;
  /**
   * Viewport-relative box to cover — the same SelectionRect every other floating toolbar
   * (SectionToolbar, AiRewritePopover, ImageChangeButton…) already anchors to, so a
   * section/element/image-scoped generation animates only that box. Omit (or null) for
   * `scope="page"`: the overlay fills its nearest positioned ancestor instead.
   */
  rect?: SelectionRect | null;
  /** Only affects corner rounding — a page-wide sweep looks odd rounded, a small scoped box
   *  looks odd without it. */
  scope?: "element" | "section" | "page" | "image";
}

/** Rough rendered height of the pill, incl. its pop-in transform's travel — mirrors
 *  SectionNameBadge's own BADGE_HEIGHT constant and the "float above, else drop inside" rule
 *  it uses so the pill never lands directly on top of a small rect's own text. */
const PILL_CLEARANCE = 36;

/**
 * One shared "AI is working on this" treatment for every generation/rewrite operation
 * (full generation, section/text/title/description rewrite, persona/marketing-angle
 * generation, image generation/editing) — a subtle gradient sweep over the affected area plus
 * a floating "Generating…" pill. Purely reflects an already-running request (visible is driven
 * by the caller's existing loading state); never triggers one itself. Entirely
 * pointer-events-none so it never blocks interaction with whatever's underneath.
 */
export function GenerationOverlay({ visible, label = "Generating…", rect, scope = "page" }: GenerationOverlayProps) {
  if (!visible) return null;

  // element/image scopes are frequently a single text field or thumbnail — small enough that
  // the pill can't sit inside it without covering the very content being rewritten, so it
  // floats just above the rect instead (dropping just inside the top edge when there's no room
  // above, same fallback SectionNameBadge uses). page/section scopes are always large enough to
  // hold the pill in a corner without obscuring anything.
  const pillPosition =
    scope === "page"
      ? "top-4 left-1/2 -translate-x-1/2"
      : scope === "section"
        ? "top-2 left-2"
        : "";
  const pillStyle =
    scope === "element" || scope === "image"
      ? { top: rect && rect.top >= PILL_CLEARANCE ? rect.top - PILL_CLEARANCE : (rect?.top ?? 0), left: rect?.left ?? 0 }
      : undefined;

  return (
    <>
      {/* Tint + sweep over the affected box — clipped to it, so the moving gradient never
          bleeds past the section/element/image being generated. */}
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute z-10 overflow-hidden ${scope === "page" ? "" : "rounded-lg"} ${
          rect ? "" : "inset-0"
        }`}
        style={rect ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height } : undefined}
      >
        {/* Static baseline tint — always visible, even with prefers-reduced-motion, so the
            affected area still reads as "active" with no moving parts. */}
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 via-transparent to-transparent" />
        {/* Slow gradient sweep — the actual "in progress" motion; disabled under reduced motion
            (see app/globals.css), leaving just the static tint above. */}
        <div className="sf-generating-sweep absolute inset-0" />
      </div>
      {/* The "Generating…" pill — a separate element from the tint box above so it's never
          clipped by that box's overflow-hidden when it needs to float outside a small rect. */}
      <div
        role="status"
        aria-live="polite"
        className={`sf-generating-pop pointer-events-none absolute z-10 flex items-center gap-1.5 rounded-full bg-neutral-900/90 px-3 py-1.5 text-xs font-medium text-white shadow-lg ring-1 ring-white/10 backdrop-blur-sm ${pillPosition}`}
        style={pillStyle}
      >
        <LoaderCircle className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
        {label}
      </div>
    </>
  );
}
