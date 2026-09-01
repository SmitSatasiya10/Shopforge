"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { loadBlockSchema, resolveSchemaLabel, ShopifySectionSchema } from "@/lib/preview/section-schema";
import type { TemplateReader } from "@/lib/preview/template-loader";

type SectionBlockDef = NonNullable<ShopifySectionSchema["blocks"]>[number];

interface BlockPickerProps {
  open: boolean;
  /** The selected section's own real block definitions (its `{% schema %}`'s `blocks` array). */
  blocks: SectionBlockDef[];
  schemaLocale: Record<string, unknown>;
  /** Reads a real Shopify theme block's own `blocks/<type>.liquid` schema for its `name`. */
  readTemplate: TemplateReader;
  onSelect: (block: SectionBlockDef) => void;
  onClose: () => void;
}

/**
 * The "Add block" picker: a flat, filterable list of the selected section's own block types,
 * sourced straight from its real Shopify `{% schema %}` (same source SettingsPanel already
 * reads) rather than a separate hand-kept list — so every section that Shopify itself would
 * let a merchant add a block to works here too, not just the curated AI catalog's ~29 sections.
 */
export function BlockPicker({ open, blocks, schemaLocale, readTemplate, onSelect, onClose }: BlockPickerProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [query, setQuery] = useState("");

  // A real Shopify theme-block reference (e.g. `{ "type": "product_price" }` in a section's own
  // `blocks` array) carries no `name` there — only `blocks/product_price.liquid`'s own
  // `{% schema %}` does ("Price"). Without this, the picker fell back to the raw type string
  // ("product_clickable-discount") for every such block. Resolved lazily per type and cached by
  // loadBlockSchema itself, so switching sections or reopening costs nothing extra.
  const [ownNames, setOwnNames] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const missing = blocks.filter((b) => !resolveSchemaLabel(b.name, schemaLocale) && !(b.type in ownNames));
    if (missing.length === 0) return;
    Promise.all(
      missing.map(async (b) => {
        const ownSchema = await loadBlockSchema(readTemplate, b.type);
        return [b.type, resolveSchemaLabel(ownSchema?.name, schemaLocale)] as const;
      }),
    ).then((entries) => {
      if (cancelled) return;
      const next = Object.fromEntries(entries.filter(([, name]) => name));
      if (Object.keys(next).length > 0) setOwnNames((prev) => ({ ...prev, ...next }));
    });
    return () => {
      cancelled = true;
    };
  }, [open, blocks, schemaLocale, readTemplate, ownNames]);

  // Clears the search on every close (Esc, backdrop, X, or picking a block) rather than in an
  // effect keyed on `open`, so reopening always starts from a blank search without a
  // setState-during-effect render cascade.
  const close = () => {
    setQuery("");
    onClose();
  };

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setQuery("");
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const labeled = useMemo(
    () =>
      blocks.map((block) => ({
        block,
        label: resolveSchemaLabel(block.name, schemaLocale) || ownNames[block.type] || block.type,
      })),
    [blocks, schemaLocale, ownNames],
  );

  const filtered = query.trim()
    ? labeled.filter(({ label, block }) => `${label} ${block.type}`.toLowerCase().includes(query.trim().toLowerCase()))
    : labeled;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-neutral-950/50 p-4" onMouseDown={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add block"
        onMouseDown={(e) => e.stopPropagation()}
        className="flex h-[70vh] w-full max-w-md flex-col rounded-2xl bg-neutral-900 text-white shadow-2xl ring-1 ring-white/10"
      >
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
          <p className="text-sm font-semibold">Add block</p>
          <button
            ref={closeRef}
            onClick={close}
            title="Close"
            className="rounded p-1 text-neutral-400 hover:bg-neutral-700 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="border-b border-white/10 p-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search blocks…"
            className="w-full rounded-lg bg-neutral-800 px-3 py-1.5 text-sm text-white placeholder-neutral-500 outline-none ring-1 ring-white/10 focus:ring-white/30"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {blocks.length === 0 ? (
            <p className="px-3 py-4 text-xs text-neutral-400">This section has no addable block types.</p>
          ) : filtered.length === 0 ? (
            <p className="px-3 py-4 text-xs text-neutral-400">No blocks match &quot;{query}&quot;.</p>
          ) : (
            filtered.map(({ block, label }, i) => (
              <button
                key={`${block.type}-${i}`}
                onClick={() => {
                  setQuery("");
                  onSelect(block);
                }}
                className="flex w-full flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-left hover:bg-white/10"
              >
                <span className="text-sm font-medium">{label}</span>
                <span className="font-mono text-[11px] text-neutral-500">{block.type}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
