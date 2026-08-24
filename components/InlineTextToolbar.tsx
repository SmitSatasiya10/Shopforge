"use client";

import { Minus, Plus, Trash2, WandSparkles, X } from "lucide-react";
import type { SelectionRect } from "./PreviewFrame";
import { sizeLabel, type TextControls } from "@/lib/editor/text-controls";

interface InlineTextToolbarProps {
  rect: SelectionRect;
  controls: TextControls;
  /** Current values at the bound path, for showing the active size/weight/color. */
  values: Record<string, unknown>;
  busy: boolean;
  /** The binding sits inside a block, so it can be deleted. */
  canDeleteBlock: boolean;
  onRewrite: () => void;
  onStepSize: (direction: -1 | 1) => void;
  onCycleWeight: () => void;
  onAlign: (value: string) => void;
  onPickColor: (hex: string) => void;
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
  busy,
  canDeleteBlock,
  onRewrite,
  onStepSize,
  onCycleWeight,
  onAlign,
  onPickColor,
  onDeleteBlock,
  onClose,
}: InlineTextToolbarProps) {
  // Above the element when there is room, below it otherwise; never off the left edge.
  const top = rect.top > 56 ? rect.top - 48 : rect.top + rect.height + 8;
  const left = Math.max(8, rect.left);

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
      // action can never throw away an in-progress edit.
    >
      <button
        onClick={onRewrite}
        disabled={busy}
        className="flex items-center gap-1.5 rounded-lg bg-neutral-700 px-2.5 py-1 text-xs font-medium hover:bg-neutral-600 disabled:opacity-40"
      >
        <WandSparkles className="h-3.5 w-3.5" strokeWidth={1.75} />
        Rewrite
      </button>

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

      {controls.size ? (
        <span className="flex items-center gap-0.5 rounded-lg border border-neutral-700 px-1">
          <button onClick={() => onStepSize(-1)} disabled={busy} aria-label="Smaller" className="grid h-6 w-6 place-items-center rounded hover:bg-neutral-700 disabled:opacity-40">
            <Minus className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
          <span className="min-w-8 text-center font-mono text-[11px] text-neutral-300 uppercase">
            {sizeLabel(controls.size, values[controls.size.settingId])}
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
        <label className="relative grid h-6 w-6 cursor-pointer place-items-center" title="Text color">
          <span
            className="h-4 w-4 rounded-full border border-neutral-500"
            style={{
              background: colorActive
                ? colorValue
                : "repeating-linear-gradient(45deg, #525252 0 2px, transparent 2px 5px)",
            }}
          />
          <input
            type="color"
            value={/^#[0-9a-f]{6}$/i.test(colorValue) ? colorValue : "#000000"}
            disabled={busy}
            onChange={(e) => onPickColor(e.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>
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
