"use client";

import { ImageUp, Wand2 } from "lucide-react";
import type { SelectionRect } from "./PreviewFrame";

interface ImageChangeButtonProps {
  rect: SelectionRect;
  /** SHOPFORGE_GENERATE_IMAGES's client-visible default (page.tsx's `generateImages` state) — disables "Edit with AI" rather than hiding it, so the capability stays discoverable. */
  aiEnabled: boolean;
  onChooseMedia: () => void;
  onEditWithAI: () => void;
}

/**
 * Floating popover over a clicked image_picker-backed image (docs/EDITOR-TOOLBARS.md's
 * InlineTextToolbar is the same anchoring pattern, for text instead of images). "Choose media"
 * opens the existing MediaPanel, unchanged; "Edit with AI" opens AiImageEditPanel targeted at
 * this same setting, with the current image as its reference.
 */
export function ImageChangeButton({ rect, aiEnabled, onChooseMedia, onEditWithAI }: ImageChangeButtonProps) {
  const top = rect.top > 96 ? rect.top - 88 : rect.top + rect.height + 8;
  const left = Math.max(8, rect.left);

  return (
    <div
      className="absolute z-20 flex select-none flex-col gap-0.5 rounded-xl bg-neutral-900 p-1.5 text-xs font-medium text-white shadow-2xl"
      style={{ top, left }}
    >
      <button onClick={onChooseMedia} className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 hover:bg-neutral-800">
        <ImageUp className="h-3.5 w-3.5" strokeWidth={1.75} />
        Choose media
      </button>
      <button
        onClick={onEditWithAI}
        disabled={!aiEnabled}
        title={aiEnabled ? undefined : "Turn on image generation for this project to use Edit with AI"}
        className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <Wand2 className="h-3.5 w-3.5" strokeWidth={1.75} />
        Edit with AI
      </button>
    </div>
  );
}
