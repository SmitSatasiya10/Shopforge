"use client";

import { useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowUp, LoaderCircle, Minus, Plus, RefreshCw, Sparkles, X } from "lucide-react";
import { REWRITE_PRESETS, type RewritePreset } from "@/lib/ai/rewrite-presets";
import type { SelectionRect } from "./PreviewFrame";

/** "Quick suggestions" render as purple-tinted line icons, per the reference editor. */
const QUICK_ICONS: Record<string, LucideIcon> = {
  minus: Minus,
  plus: Plus,
  sparkles: Sparkles,
  "spell-check": RefreshCw,
};

/** "Change angle" presets render as colored emoji, per the reference editor. Keyed by preset id. */
const ANGLE_EMOJI: Record<string, string> = {
  emotional: "❤️",
  logical: "🧠",
  social_proof: "👥",
  urgency: "⏰",
  aspirational: "🚀",
  fomo: "🔥",
};

/** Rough rendered height of prompt card + suggestions card, used only to clamp into view. */
const POPOVER_HEIGHT = 400;

interface AiRewritePopoverProps {
  /** Display name of the selected section — the popover renders only while one is selected. */
  sectionLabel: string;
  /** Selected section's rect, so the popover floats next to it like the reference editor. */
  rect: SelectionRect | null;
  /** Height of the preview container, so the popover clamps into view. */
  containerHeight: number;
  busy: boolean;
  onSubmit: (options: { prompt?: string; preset?: string }) => void;
  onClose: () => void;
}

/**
 * The floating "rewrite this section" prompt shown over the preview when a section is
 * selected (docs/SECTION-AI-EDITING.md): a free-text instruction plus preset chips.
 * A chip click never submits — it fills the input with the preset's editable prompt,
 * and only the arrow button or Enter sends it. Submitted unedited, the preset id goes
 * to the API (its richer instruction is used); edited, the user's text goes as typed.
 */
export function AiRewritePopover({
  sectionLabel,
  rect,
  containerHeight,
  busy,
  onSubmit,
  onClose,
}: AiRewritePopoverProps) {
  const [prompt, setPrompt] = useState("");
  // The chip whose prompt currently fills the input, so an unedited submit can send the
  // preset id (richer instruction) instead of the short fill text.
  const [picked, setPicked] = useState<RewritePreset | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!busy) inputRef.current?.focus();
  }, [busy]);

  const pickPreset = (preset: RewritePreset) => {
    if (busy) return;
    setPrompt(preset.prompt);
    setPicked(preset);
    inputRef.current?.focus();
  };

  const submitPrompt = () => {
    if (busy || !prompt.trim()) return;
    if (picked && prompt.trim() === picked.prompt) {
      onSubmit({ preset: picked.id });
    } else {
      onSubmit({ prompt: prompt.trim() });
    }
    setPrompt("");
    setPicked(null);
  };

  const quick = REWRITE_PRESETS.filter((p) => p.group === "quick");
  const angles = REWRITE_PRESETS.filter((p) => p.group === "angle");

  // Float next to the selected section (left of the section toolbar), clamped on screen.
  const top = Math.min(Math.max(rect?.top ?? 16, 8), Math.max(8, containerHeight - POPOVER_HEIGHT - 8));

  return (
    <div className="absolute right-14 z-20 w-80 select-none" style={{ top }}>
      <div className="rounded-3xl bg-neutral-900 p-4 text-white shadow-2xl ring-1 ring-white/10">
        <div className="flex items-start gap-2">
          <textarea
            ref={inputRef}
            rows={3}
            value={prompt}
            disabled={busy}
            placeholder={busy ? "Rewriting…" : `Enter a prompt to rewrite ${sectionLabel}…`}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submitPrompt();
              }
              if (e.key === "Escape") onClose();
            }}
            className="flex-1 resize-none bg-transparent text-sm placeholder-neutral-400 outline-none disabled:opacity-50"
          />
          <button
            onClick={onClose}
            title="Close"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-neutral-400 hover:bg-neutral-700 hover:text-white"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
          <button
            onClick={submitPrompt}
            disabled={busy || !prompt.trim()}
            title="Rewrite"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white text-neutral-900 disabled:opacity-30"
          >
            {busy ? <LoaderCircle className="h-4 w-4 animate-spin" strokeWidth={2} /> : <ArrowUp className="h-4 w-4" strokeWidth={2} />}
          </button>
        </div>
      </div>

      <div className="mt-2 rounded-2xl bg-neutral-900 p-3 text-white shadow-2xl ring-1 ring-white/10">
        <PresetGroup title="Quick suggestions" busy={busy} presets={quick} onPick={pickPreset} />
        <div className="mt-3">
          <PresetGroup title="Change angle" busy={busy} presets={angles} onPick={pickPreset} />
        </div>
      </div>
    </div>
  );
}

function PresetGroup({
  title,
  presets,
  busy,
  onPick,
}: {
  title: string;
  presets: RewritePreset[];
  busy: boolean;
  onPick: (preset: RewritePreset) => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-semibold tracking-widest text-neutral-400 uppercase">{title}</p>
      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
        {presets.map((preset) => {
          const emoji = ANGLE_EMOJI[preset.id];
          const Icon = QUICK_ICONS[preset.icon] ?? Sparkles;
          return (
            <button
              key={preset.id}
              disabled={busy}
              onClick={() => onPick(preset)}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-medium hover:bg-neutral-700 disabled:opacity-40"
            >
              {emoji ? (
                <span className="w-4 shrink-0 text-center text-sm leading-none">{emoji}</span>
              ) : (
                <Icon className="h-3.5 w-3.5 shrink-0 text-violet-400" strokeWidth={2} />
              )}
              {preset.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
