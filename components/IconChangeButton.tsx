"use client";

import { Shapes } from "lucide-react";
import type { SelectionRect } from "./PreviewFrame";

interface IconChangeButtonProps {
  rect: SelectionRect;
  onBrowseIcons: () => void;
}

/**
 * Floating popover over a clicked icon-setting glyph (data-sf-editable="icon") — the same
 * anchoring pattern as ImageChangeButton, but a single action: there is no AI-editing
 * equivalent for icons.
 */
export function IconChangeButton({ rect, onBrowseIcons }: IconChangeButtonProps) {
  const top = rect.top > 96 ? rect.top - 44 : rect.top + rect.height + 8;
  const left = Math.max(8, rect.left);

  return (
    <div
      className="absolute z-20 flex select-none flex-col gap-0.5 rounded-xl bg-neutral-900 p-1.5 text-xs font-medium text-white shadow-2xl"
      style={{ top, left }}
    >
      <button onClick={onBrowseIcons} className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 hover:bg-neutral-800">
        <Shapes className="h-3.5 w-3.5" strokeWidth={1.75} />
        Change icon
      </button>
    </div>
  );
}
