"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import type { SectionSchema } from "@/lib/ai/catalog";
import type { NormalizedProduct } from "@/lib/product/types";
import type { BinaryReader, TemplateReader } from "@/lib/preview/template-loader";
import { SectionPreviewThumbnail } from "./SectionPreviewThumbnail";

interface SectionPickerProps {
  open: boolean;
  /** Already scoped to the current page and with locked sections excluded. */
  sections: SectionSchema[];
  onSelect: (section: SectionSchema) => void;
  onClose: () => void;
  /** The page the picker is scoped to, and what its cards render their live previews with. */
  templateName: string;
  readTemplate: TemplateReader;
  readBinary?: BinaryReader;
  product: NormalizedProduct | null;
  storeName: string;
}

const FALLBACK_CATEGORY = "misc";

function humanizeCategory(category: string): string {
  return category
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * The "Add section" picker: a category rail on the left, section cards on the right, styled
 * like the editor's other dark floating chrome (ConfirmDialog, AiRewritePopover). Sourced
 * entirely from the app's existing AI-facing section catalog (lib/ai/catalog.ts) — no separate
 * section-definition list, no generated thumbnails (none exist in the catalog).
 */
export function SectionPicker({
  open,
  sections,
  onSelect,
  onClose,
  templateName,
  readTemplate,
  readBinary,
  product,
  storeName,
}: SectionPickerProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [category, setCategory] = useState<string | null>(null);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const section of sections) {
      const key = section.category ?? FALLBACK_CATEGORY;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [sections]);

  const validCategory = category !== null && categories.some(([key]) => key === category);
  const activeCategory = validCategory ? category : (categories[0]?.[0] ?? null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const cards = activeCategory ? sections.filter((s) => (s.category ?? FALLBACK_CATEGORY) === activeCategory) : [];

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-neutral-950/50 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add section"
        onMouseDown={(e) => e.stopPropagation()}
        className="flex h-[80vh] w-full max-w-4xl flex-col rounded-2xl bg-neutral-900 text-white shadow-2xl ring-1 ring-white/10"
      >
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
          <p className="text-sm font-semibold">Add section</p>
          <button
            ref={closeRef}
            onClick={onClose}
            title="Close"
            className="rounded p-1 text-neutral-400 hover:bg-neutral-700 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          <div className="w-52 shrink-0 overflow-y-auto border-r border-white/10 p-2">
            {categories.length === 0 ? (
              <p className="px-2 py-4 text-xs text-neutral-400">No sections available for this page.</p>
            ) : (
              categories.map(([key, count]) => (
                <button
                  key={key}
                  onClick={() => setCategory(key)}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${
                    key === activeCategory
                      ? "bg-white/10 text-white"
                      : "text-neutral-400 hover:bg-white/5 hover:text-neutral-200"
                  }`}
                >
                  <span>{humanizeCategory(key)}</span>
                  <span className="text-xs text-neutral-500">{count}</span>
                </button>
              ))
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {activeCategory ? (
              <p className="mb-3 text-xs font-semibold tracking-wide text-neutral-400 uppercase">
                {humanizeCategory(activeCategory)}
              </p>
            ) : null}
            {cards.length === 0 ? (
              <p className="text-xs text-neutral-400">No sections in this category.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                {cards.map((section) => (
                  <button
                    key={section.id}
                    onClick={() => onSelect(section)}
                    className="flex flex-col items-start gap-2 rounded-xl bg-neutral-800 p-3 text-left ring-1 ring-white/10 hover:ring-white/30"
                  >
                    <SectionPreviewThumbnail
                      catalogId={section.id}
                      templateName={templateName}
                      readTemplate={readTemplate}
                      readBinary={readBinary}
                      product={product}
                      storeName={storeName}
                    />
                    <span className="text-sm font-medium">{section.label}</span>
                    {section.purpose ? (
                      <span className="line-clamp-2 text-xs text-neutral-400">{section.purpose}</span>
                    ) : null}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
