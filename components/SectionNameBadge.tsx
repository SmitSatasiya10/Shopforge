"use client";

import { LayoutPanelTop } from "lucide-react";
import type { SelectionRect } from "./PreviewFrame";

interface SectionNameBadgeProps {
  /** The selected section's own root box (not the specific field/block clicked within it). */
  rect: SelectionRect | null;
  name: string;
}

const BADGE_HEIGHT = 24;

/**
 * Small pill naming the selected section, pinned to its top-left corner — the same affordance
 * Shopify's own theme editor shows on selection. Sits just above the section; when the section
 * is scrolled flush with (or past) the top of the preview there's no room above it, so it drops
 * just inside the top edge instead of clipping off-screen.
 */
export function SectionNameBadge({ rect, name }: SectionNameBadgeProps) {
  if (!rect) return null;
  const top = rect.top >= BADGE_HEIGHT ? rect.top - BADGE_HEIGHT : rect.top;

  return (
    <div
      className="pointer-events-none absolute z-10 flex items-center gap-1 rounded-t-md bg-emerald-600 px-2 py-1 text-xs font-medium whitespace-nowrap text-white shadow"
      style={{ top, left: rect.left }}
    >
      <LayoutPanelTop className="h-3 w-3 shrink-0" strokeWidth={2} />
      {name}
    </div>
  );
}
