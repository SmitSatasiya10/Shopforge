"use client";

import { useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowUp, LoaderCircle, Minus, Plus, RefreshCw, Sparkles, Wand2, X } from "lucide-react";
import { presetById, REWRITE_PRESETS, type RewritePreset } from "@/lib/ai/rewrite-presets";
import type { SelectionRect } from "./PreviewFrame";

/** "Quick suggestions" render as purple-tinted line icons, per the reference editor. */
const QUICK_ICONS: Record<string, LucideIcon> = {
  minus: Minus,
  plus: Plus,
  sparkles: Sparkles,
  wand: Wand2,
  "spell-check": RefreshCw,
};

/**
 * The neutral "just improve this, no specific direction" preset — pre-filled into the input on
 * open so a user with no particular instruction can submit immediately instead of being stuck
 * (submit is disabled while the input is empty, and a field-level rewrite shows no chips at
 * all as an alternative — see anchorToElement below).
 */
const DEFAULT_PRESET = presetById("rewrite")!;

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
/** Rough rendered height of the prompt card alone (no suggestions card), same purpose. */
const POPOVER_HEIGHT_COMPACT = 110;

interface AiRewritePopoverProps {
  /** Display name of the selected section — the popover renders only while one is selected. */
  sectionLabel: string;
  /** Selected section's rect, so the popover floats next to it like the reference editor. */
  rect: SelectionRect | null;
  /** Height of the preview container, so the popover clamps into view. */
  containerHeight: number;
  /**
   * True for a field selection (opened from the inline text toolbar): floats below the
   * selected element itself — same `Math.max(8, rect.left)` horizontal anchor that toolbar
   * already uses — instead of the fixed slot next to the section toolbar's pill, so it never
   * sits on top of the very content being rewritten. It also renders just the prompt input,
   * with no "Quick suggestions"/"Change angle" chips — those presets are written to rewrite a
   * whole section and read oddly applied to one field. False (the default layout) pins the
   * full panel, chips included, beside that pill on the right edge, for a section/block
   * selection with no single small rect.
   */
  anchorToElement: boolean;
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
  anchorToElement,
  busy,
  onSubmit,
  onClose,
}: AiRewritePopoverProps) {
  // Pre-filled with the neutral "Rewrite" preset rather than empty, so clicking submit with
  // no edits still does something sensible — the same unedited-submit-sends-the-preset-id
  // mechanism a chip click uses below.
  const [prompt, setPrompt] = useState(DEFAULT_PRESET.prompt);
  // The chip whose prompt currently fills the input, so an unedited submit can send the
  // preset id (richer instruction) instead of the short fill text.
  const [picked, setPicked] = useState<RewritePreset | null>(DEFAULT_PRESET);
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

  // Anchored to an element (a field selection): float below it, left-aligned to it exactly
  // like the inline text toolbar itself — so a wide element (e.g. a full-width heading) never
  // ends up hidden underneath the panel. Otherwise: float next to the selected section (left
  // of the section toolbar pill) — the section/block's own rect can be arbitrarily large, so
  // it's not a useful anchor for horizontal placement the way a single text element's is.
  const style = anchorToElement
    ? {
        top: Math.min(
          Math.max((rect?.top ?? 16) + (rect?.height ?? 0) + 8, 8),
          Math.max(8, containerHeight - POPOVER_HEIGHT_COMPACT - 8),
        ),
        left: Math.max(8, rect?.left ?? 8),
      }
    : { top: Math.min(Math.max(rect?.top ?? 16, 8), Math.max(8, containerHeight - POPOVER_HEIGHT - 8)) };

  return (
    <div
      className={`absolute z-20 w-80 select-none ${anchorToElement ? "" : "right-14"}`}
      style={style}
    >
      <div className="rounded-3xl bg-neutral-900 p-4 text-white shadow-2xl ring-1 ring-white/10">
        <div className="flex items-start gap-2">
          <textarea
            ref={inputRef}
            rows={anchorToElement ? 2 : 3}
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

      {anchorToElement ? null : (
        <div className="mt-2 rounded-2xl bg-neutral-900 p-3 text-white shadow-2xl ring-1 ring-white/10">
          <PresetGroup title="Quick suggestions" busy={busy} presets={quick} onPick={pickPreset} />
          <div className="mt-3">
            <PresetGroup title="Change angle" busy={busy} presets={angles} onPick={pickPreset} />
          </div>
        </div>
      )}
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
