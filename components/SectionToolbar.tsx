"use client";

import type { LucideIcon } from "lucide-react";
import { ArrowDown, ArrowUp, Paintbrush, Settings2, Trash2, WandSparkles } from "lucide-react";
import type { SelectionRect } from "./PreviewFrame";

interface SectionToolbarProps {
  rect: SelectionRect | null;
  /** Height of the preview container, so the pill clamps into view. */
  containerHeight: number;
  busy: boolean;
  onMagicBrush: () => void;
  onRewrite: () => void;
  onEditSection: () => void;
  onMove: (delta: -1 | 1) => void;
  onDelete: () => void;
}

const PILL_HEIGHT = 240;

/**
 * The floating per-section toolbar (docs/EDITOR-TOOLBARS.md): magic brush, AI rewrite,
 * open-the-Inspector, move, delete. Pinned to the preview's right edge, vertically aligned
 * with the selected section and clamped to stay on screen.
 */
export function SectionToolbar({
  rect,
  containerHeight,
  busy,
  onMagicBrush,
  onRewrite,
  onEditSection,
  onMove,
  onDelete,
}: SectionToolbarProps) {
  const top = Math.min(Math.max(rect?.top ?? 16, 8), Math.max(8, containerHeight - PILL_HEIGHT - 8));

  return (
    <div className="absolute right-2 z-10 select-none" style={{ top }}>
      <div className="flex flex-col items-center rounded-full bg-neutral-900 p-1 text-white shadow-2xl ring-1 ring-white/10">
        <ToolButton label="Magic brush" busy={busy} onClick={onMagicBrush} icon={Paintbrush} />
        <ToolButton label="Re-write" busy={busy} onClick={onRewrite} icon={WandSparkles} />
        <ToolButton label="Edit section" busy={busy} onClick={onEditSection} icon={Settings2} />
        <Divider />
        <ToolButton label="Move up" busy={busy} onClick={() => onMove(-1)} icon={ArrowUp} />
        <ToolButton label="Move down" busy={busy} onClick={() => onMove(1)} icon={ArrowDown} />
        <Divider />
        <ToolButton label="Delete section" busy={busy} onClick={onDelete} icon={Trash2} danger />
      </div>
    </div>
  );
}

function Divider() {
  return <span className="my-0.5 h-px w-5 bg-white/15" />;
}

function ToolButton({
  label,
  icon: Icon,
  busy,
  danger,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  busy: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <span className="group relative">
      <button
        onClick={onClick}
        disabled={busy}
        aria-label={label}
        className={`grid h-9 w-9 place-items-center rounded-full transition-colors disabled:opacity-40 ${
          danger ? "text-red-400 hover:bg-red-400/15 hover:text-red-300" : "text-neutral-200 hover:bg-white/15 hover:text-white"
        }`}
      >
        <Icon className="h-4 w-4" strokeWidth={1.75} />
      </button>
      {/* Hover tooltip to the left, like the reference editor's "Magic brush" / "Re-write". */}
      <span className="pointer-events-none absolute top-1/2 right-full mr-2 -translate-y-1/2 rounded-md bg-white px-2 py-1 text-xs font-medium whitespace-nowrap text-neutral-900 opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
        {label}
      </span>
    </span>
  );
}
