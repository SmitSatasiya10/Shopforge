"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { MATERIAL_SYMBOLS_ICONS } from "@/lib/icons/material-symbols";

interface IconPanelProps {
  open: boolean;
  /** The icon setting's current value — may be blank or unrecognized; highlighted in the grid
   *  when it matches a curated entry, otherwise the grid still renders normally. */
  value: string;
  onSelect: (iconName: string) => void;
  onClose: () => void;
}

/**
 * "Choose an icon" — mirrors MediaPanel's shape and sidebar slot. A searchable grid of curated
 * Material Symbols names, rendered through the shared `.material-symbols-outlined` ligature font
 * (app/globals.css), each button applying its icon immediately on click.
 */
export function IconPanel({ open, value, onSelect, onClose }: IconPanelProps) {
  const [query, setQuery] = useState("");

  if (!open) return null;

  const normalizedQuery = query.trim().toLowerCase().replace(/\s+/g, "_");
  const filtered = normalizedQuery
    ? MATERIAL_SYMBOLS_ICONS.filter((name) => name.includes(normalizedQuery))
    : MATERIAL_SYMBOLS_ICONS;

  return (
    <div className="flex min-h-0 w-72 shrink-0 flex-col border-r border-neutral-200 bg-white text-neutral-900">
      <div className="flex items-center justify-between px-4 py-3">
        <p className="text-sm font-semibold text-neutral-900">Choose an icon</p>
        <button onClick={onClose} title="Close" className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-900">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="px-4 pb-3">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search icons..."
          className="w-full rounded border border-neutral-300 p-2 text-sm"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {filtered.length === 0 ? (
          <p className="px-1 py-4 text-xs text-neutral-400">No icons match &quot;{query}&quot;.</p>
        ) : (
          <div className="grid grid-cols-4 gap-2">
            {filtered.map((name) => (
              <button
                key={name}
                onClick={() => onSelect(name)}
                title={name.replace(/_/g, " ")}
                className={`grid aspect-square place-items-center rounded-lg ${
                  name === value ? "ring-2 ring-neutral-900" : "ring-1 ring-neutral-200 hover:ring-neutral-400"
                }`}
              >
                <span className="material-symbols-outlined text-2xl">{name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
