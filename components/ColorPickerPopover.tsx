"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { NamedColor, ThemeColorRow } from "@/lib/editor/color-palette";

interface ColorPickerPopoverProps {
  value: string;
  themeRows: ThemeColorRow[];
  commonColors: NamedColor[];
  onChange: (hex: string) => void;
  onClose: () => void;
}

const HEX_RE = /^#[0-9a-f]{6}$/i;

function Swatch({ hex, active, onSelect }: { hex: string; active: boolean; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      title={hex}
      className={`h-6 w-6 shrink-0 rounded-full border ${
        active ? "border-2 border-white ring-2 ring-sky-400" : "border-white/10"
      }`}
      style={{ background: hex }}
    />
  );
}

/**
 * The inline toolbar's color swatch opens this instead of a bare native `<input type="color">`
 * (docs/EDITOR-TOOLBARS.md reference UX): a "Theme" tab of the store's own brand-color ramps
 * (lib/editor/color-palette.ts), a "Custom" tab for a free hex pick, and a "Common Colors" row
 * of theme-declared presets under both. Picking applies immediately, same as every other
 * inline-toolbar control — there's no separate "confirm" step.
 */
export function ColorPickerPopover({ value, themeRows, commonColors, onChange, onClose }: ColorPickerPopoverProps) {
  const [tab, setTab] = useState<"theme" | "custom">("theme");
  // Initialized once from `value`: the toolbar mounts a fresh instance of this popover each
  // time it opens (conditional render, no `key`), so there is no case where `value` changes
  // out from under an already-open picker other than this component's own `commitHex` calls,
  // which already keep `hexInput` in sync.
  const [hexInput, setHexInput] = useState(value);
  // Anchored left of the swatch button by default; when the button sits near the right edge
  // of the viewport (the toolbar can appear anywhere along the selected text, including flush
  // against the preview's right side), that would run this fixed-width panel off-screen — so
  // flip to right-aligned once mounted and measured.
  const [align, setAlign] = useState<"left" | "right">("left");
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.getBoundingClientRect().right > window.innerWidth) setAlign("right");
  }, []);

  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const commitHex = (hex: string) => {
    setHexInput(hex);
    if (HEX_RE.test(hex)) onChange(hex);
  };

  return (
    <div
      ref={ref}
      className={`absolute top-full z-30 mt-2 w-64 rounded-xl bg-neutral-900 p-3 text-white shadow-2xl select-none ${
        align === "left" ? "left-0" : "right-0"
      }`}
      // Same rationale as the toolbar itself: never eat the mousedown, so an in-progress
      // contenteditable edit still commits normally when this panel opens.
    >
      <div className="mb-2.5 flex items-center gap-1 rounded-lg bg-neutral-800 p-0.5 text-xs font-medium">
        {(["theme", "custom"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-md py-1 capitalize ${
              tab === t ? "bg-neutral-600 text-white" : "text-neutral-400 hover:text-neutral-200"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "theme" ? (
        <div className="flex flex-col gap-1.5">
          {themeRows.length === 0 ? (
            <p className="py-1 text-center text-[11px] text-neutral-500">No theme colors found</p>
          ) : (
            themeRows.map((row) => (
              <div key={row.label} className="flex justify-between gap-1">
                {row.swatches.map((hex) => (
                  <Swatch key={hex} hex={hex} active={hex.toLowerCase() === value.toLowerCase()} onSelect={() => commitHex(hex)} />
                ))}
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <label className="relative grid h-9 w-full cursor-pointer place-items-center overflow-hidden rounded-lg border border-neutral-700">
            <span className="pointer-events-none absolute inset-0" style={{ background: HEX_RE.test(hexInput) ? hexInput : value }} />
            <input
              type="color"
              value={HEX_RE.test(hexInput) ? hexInput : "#000000"}
              onChange={(e) => commitHex(e.target.value)}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </label>
          <input
            type="text"
            value={hexInput}
            onChange={(e) => commitHex(e.target.value.startsWith("#") ? e.target.value : `#${e.target.value}`)}
            placeholder="#000000"
            spellCheck={false}
            className="rounded-lg border border-neutral-700 bg-neutral-800 px-2 py-1 text-center font-mono text-xs uppercase text-white outline-none focus:border-neutral-500"
          />
        </div>
      )}

      {commonColors.length > 0 ? (
        <div className="mt-3 border-t border-neutral-800 pt-2.5">
          <p className="mb-1.5 text-[10px] font-medium tracking-wide text-neutral-500 uppercase">Common Colors</p>
          <div className="flex flex-wrap gap-1.5">
            {commonColors.map((c) => (
              <Swatch key={c.hex} hex={c.hex} active={c.hex.toLowerCase() === value.toLowerCase()} onSelect={() => commitHex(c.hex)} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
