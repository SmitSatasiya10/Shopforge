"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Minus, Plus, Trash2, WandSparkles, X } from "lucide-react";
import type { SelectionRect } from "./PreviewFrame";
import { sizeLabel, sizeSettingFor, type TextControls } from "@/lib/editor/text-controls";
import type { NamedColor, ThemeColorRow } from "@/lib/editor/color-palette";
import { ColorPickerPopover } from "./ColorPickerPopover";
import { VoiceDictationButton } from "./VoiceDictationButton";

interface InlineTextToolbarProps {
  rect: SelectionRect;
  controls: TextControls;
  /** Current values at the bound path, for showing the active size/weight/color. */
  values: Record<string, unknown>;
  /**
   * Which preview the merchant is looking at. Size is per-viewport in this theme, so the −/+
   * reads and writes the mobile setting while the mobile preview is on — see `sizeSettingFor`.
   */
  viewport: "desktop" | "mobile";
  busy: boolean;
  /** The binding sits inside a block, so it can be deleted and reordered. */
  canDeleteBlock: boolean;
  /** Feeds the color swatch's "Theme"/"Common Colors" tabs (lib/editor/color-palette.ts). */
  themeColorRows: ThemeColorRow[];
  commonColors: NamedColor[];
  /** BCP-47 locale for the mic's voice dictation — see lib/store-config/dictation-locale.ts. */
  dictationLang: string;
  /**
   * Inserts speech-recognized text into the field being edited, at its live caret — forwards
   * straight to PreviewFrame's imperative handle (docs/VOICE-DICTATION-PLAN.md §5). This toolbar
   * never touches the iframe's DOM itself.
   */
  onDictate: (text: string, isFinal: boolean) => void;
  onRewrite: () => void;
  onStepSize: (direction: -1 | 1) => void;
  onCycleWeight: () => void;
  onAlign: (value: string) => void;
  onPickColor: (hex: string) => void;
  onMoveBlock: (delta: -1 | 1) => void;
  onDeleteBlock: () => void;
  onClose: () => void;
}

/** Bars icon for an alignment option, keyed on the option value ("left", "mobile-center", …). */
function AlignIcon({ value }: { value: string }) {
  const x = (width: number) => (/right/i.test(value) ? 14 - width : /center/i.test(value) ? (14 - width) / 2 : 0);
  return (
    <svg viewBox="0 0 14 10" className="h-2.5 w-3.5" aria-hidden>
      {[10, 14, 7].map((width, i) => (
        <rect key={i} x={x(width)} y={i * 4} width={width} height="2" rx="1" fill="currentColor" />
      ))}
    </svg>
  );
}

/**
 * The floating toolbar over a clicked text element (docs/EDITOR-TOOLBARS.md): AI rewrite for
 * just this setting, plus size / weight / color controls that render only when the bound
 * block's schema actually declares them. The text itself is already contenteditable —
 * this bar is for everything typing can't do.
 */
export function InlineTextToolbar({
  rect,
  controls,
  values,
  viewport,
  busy,
  canDeleteBlock,
  themeColorRows,
  commonColors,
  dictationLang,
  onDictate,
  onRewrite,
  onStepSize,
  onCycleWeight,
  onAlign,
  onPickColor,
  onMoveBlock,
  onDeleteBlock,
  onClose,
}: InlineTextToolbarProps) {
  const [colorPickerOpen, setColorPickerOpen] = useState(false);

  // Above the element when there is room, below it otherwise; never off the left edge.
  const top = rect.top > 56 ? rect.top - 48 : rect.top + rect.height + 8;
  const left = Math.max(8, rect.left);

  const sizeSetting = controls.size ? sizeSettingFor(controls.size, viewport) : null;
  const alignValue = controls.align ? String(values[controls.align.settingId] ?? "") : "";
  const weightValue = controls.weight ? String(values[controls.weight.settingId] ?? "") : "";
  const colorValue = controls.color ? String(values[controls.color.settingId] ?? "#000000") : "#000000";
  // A stored color that the enable checkbox keeps switched off is not visible on the page —
  // show the swatch as "no color" so the circle never claims a color the text does not have.
  const colorActive =
    !controls.color?.enableId || Boolean(values[controls.color.enableId]);

  return (
    <div
      className="absolute z-20 flex items-center gap-1 rounded-xl bg-neutral-900 p-1.5 text-white shadow-2xl select-none"
      style={{ top, left }}
      // Deliberately NOT preventing mousedown: pressing any control first blurs the
      // contenteditable text, which commits whatever was typed — so a size/color/rewrite
      // action can never throw away an in-progress edit. The mic button is the one exception —
      // it prevents its own pointerdown default so the field stays focused and dictation can
      // insert at the live caret (docs/VOICE-DICTATION-PLAN.md §5).
    >
      <button
        onClick={onRewrite}
        disabled={busy}
        className="flex items-center gap-1.5 rounded-lg bg-neutral-700 px-2.5 py-1 text-xs font-medium hover:bg-neutral-600 disabled:opacity-40"
      >
        <WandSparkles className="h-3.5 w-3.5" strokeWidth={1.75} />
        Rewrite
      </button>

      <VoiceDictationButton
        lang={dictationLang}
        onInterim={(text) => onDictate(text, false)}
        onFinal={(text) => onDictate(text, true)}
      />

      {controls.align ? (
        <span className="flex items-center gap-0.5 rounded-lg border border-neutral-700 px-0.5 py-0.5">
          {controls.align.options.map((value) => (
            <button
              key={value}
              onClick={() => onAlign(value)}
              disabled={busy}
              title={`Align ${value}`}
              className={`grid h-6 w-6 place-items-center rounded disabled:opacity-40 ${
                value === alignValue ? "bg-neutral-600 text-white" : "text-neutral-300 hover:bg-neutral-700"
              }`}
            >
              <AlignIcon value={value} />
            </button>
          ))}
        </span>
      ) : null}

      {sizeSetting ? (
        <span className="flex items-center gap-0.5 rounded-lg border border-neutral-700 px-1">
          <button onClick={() => onStepSize(-1)} disabled={busy} aria-label="Smaller" className="grid h-6 w-6 place-items-center rounded hover:bg-neutral-700 disabled:opacity-40">
            <Minus className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
          <span className="min-w-8 text-center font-mono text-[11px] text-neutral-300 uppercase">
            {sizeLabel(sizeSetting, values[sizeSetting.settingId])}
          </span>
          <button onClick={() => onStepSize(1)} disabled={busy} aria-label="Larger" className="grid h-6 w-6 place-items-center rounded hover:bg-neutral-700 disabled:opacity-40">
            <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        </span>
      ) : null}

      {controls.weight ? (
        <button onClick={onCycleWeight} disabled={busy} className="rounded-lg px-2 py-1 text-xs capitalize hover:bg-neutral-700 disabled:opacity-40">
          {weightValue || "weight"}
        </button>
      ) : null}

      {controls.color ? (
        <div className="relative">
          <button
            onClick={() => setColorPickerOpen((v) => !v)}
            disabled={busy}
            title="Text color"
            className="grid h-6 w-6 place-items-center rounded disabled:opacity-40"
          >
            <span
              className="h-4 w-4 rounded-full border border-neutral-500"
              style={{
                background: colorActive
                  ? colorValue
                  : "repeating-linear-gradient(45deg, #525252 0 2px, transparent 2px 5px)",
              }}
            />
          </button>
          {colorPickerOpen ? (
            <ColorPickerPopover
              value={/^#[0-9a-f]{6}$/i.test(colorValue) ? colorValue : "#000000"}
              themeRows={themeColorRows}
              commonColors={commonColors}
              onChange={onPickColor}
              onClose={() => setColorPickerOpen(false)}
            />
          ) : null}
        </div>
      ) : null}

      {canDeleteBlock ? (
        <span className="flex items-center gap-0.5 rounded-lg border border-neutral-700 px-0.5 py-0.5">
          <button onClick={() => onMoveBlock(-1)} disabled={busy} title="Move block up" className="grid h-6 w-6 place-items-center rounded text-neutral-300 hover:bg-neutral-700 disabled:opacity-40">
            <ArrowUp className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
          <button onClick={() => onMoveBlock(1)} disabled={busy} title="Move block down" className="grid h-6 w-6 place-items-center rounded text-neutral-300 hover:bg-neutral-700 disabled:opacity-40">
            <ArrowDown className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        </span>
      ) : null}

      {canDeleteBlock ? (
        <button onClick={onDeleteBlock} disabled={busy} title="Delete block" className="grid h-6 w-6 place-items-center rounded text-red-400 hover:bg-red-400/15 hover:text-red-300 disabled:opacity-40">
          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      ) : null}

      <button onClick={onClose} title="Close" className="grid h-6 w-6 place-items-center rounded text-neutral-400 hover:bg-neutral-700 hover:text-white">
        <X className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
    </div>
  );
}
