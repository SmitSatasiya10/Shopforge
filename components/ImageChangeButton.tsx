"use client";

import { ImageUp } from "lucide-react";
import type { SelectionRect } from "./PreviewFrame";

interface ImageChangeButtonProps {
  rect: SelectionRect;
  onClick: () => void;
}

/**
 * Floating pill over a clicked image_picker-backed image (docs/EDITOR-TOOLBARS.md's
 * InlineTextToolbar is the same pattern, positioned the same way, for text instead of images).
 */
export function ImageChangeButton({ rect, onClick }: ImageChangeButtonProps) {
  const top = rect.top > 56 ? rect.top - 48 : rect.top + rect.height + 8;
  const left = Math.max(8, rect.left);

  return (
    <div className="absolute z-20 select-none" style={{ top, left }}>
      <button
        onClick={onClick}
        className="flex items-center gap-1.5 rounded-xl bg-neutral-900 px-2.5 py-1.5 text-xs font-medium text-white shadow-2xl hover:bg-neutral-800"
      >
        <ImageUp className="h-3.5 w-3.5" strokeWidth={1.75} />
        Change image
      </button>
    </div>
  );
}
