"use client";

import { Check, X } from "lucide-react";
import { DESIGN_TEMPLATES, matchDesignTemplate, type DesignTemplate } from "@/lib/editor/design-templates";

interface TemplatesPanelProps {
  /** The editor's current effective themeSettings — used only to detect and highlight which
   *  template (if any) is already applied, the same way Design's style-preset cards do. */
  values: Record<string, unknown>;
  onApply: (values: Record<string, unknown>) => void;
  onClose: () => void;
}

/**
 * Templates — a whole-theme visual preset picker, same shared left-rail slot as Sections/AI/
 * Media/Design. Each row is a lightweight, static preview built straight from the template's own
 * `values` (no iframe, no Liquid render, no AI) — a heading sample, a primary/secondary color
 * pair, and two button swatches, styled inline so the row is always an accurate preview of what
 * Apply will set. Selecting a row calls `onApply(template.values)`, which the caller wires to the
 * same `updateThemeSettings` every Design style-preset card already uses — one merge, one undo
 * step, entire previous design restored on Ctrl/Cmd+Z.
 */
export function TemplatesPanel({ values, onApply, onClose }: TemplatesPanelProps) {
  const activeId = matchDesignTemplate(values);

  return (
    <div className="flex min-h-0 w-96 shrink-0 flex-col border-r border-neutral-200 bg-white text-neutral-900">
      <div className="flex items-center gap-2 px-4 py-3">
        <p className="flex-1 text-sm font-semibold text-neutral-900">Templates</p>
        <button onClick={onClose} title="Close" className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-900">
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="px-4 pb-3 text-xs text-neutral-500">
        Apply a complete visual design — colors, fonts, buttons, cards, and radius — across the whole theme.
      </p>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
        {DESIGN_TEMPLATES.map((template) => (
          <TemplateRow
            key={template.id}
            template={template}
            selected={template.id === activeId}
            onApply={() => onApply(template.values)}
          />
        ))}
      </div>
    </div>
  );
}

function TemplateRow({
  template,
  selected,
  onApply,
}: {
  template: DesignTemplate;
  selected: boolean;
  onApply: () => void;
}) {
  const { preview, values } = template;
  const buttonRadius = Math.min(Number(values.buttons_radius ?? 0), 16);

  return (
    <button
      type="button"
      onClick={onApply}
      title={template.description}
      aria-pressed={selected}
      className={`flex flex-col gap-3 rounded-xl border p-3 text-left transition ${
        selected ? "border-neutral-900 ring-1 ring-neutral-900" : "border-neutral-200 hover:border-neutral-400"
      }`}
    >
      <div className="flex items-center justify-between gap-3 rounded-lg p-3" style={{ backgroundColor: preview.background }}>
        <span style={{ fontFamily: preview.headingFontStack, color: preview.text }} className="text-2xl leading-none font-bold">
          Aa
        </span>
        <span className="flex -space-x-1.5">
          <span className="h-6 w-6 rounded-full ring-2 ring-white" style={{ backgroundColor: preview.accent }} />
          <span className="h-6 w-6 rounded-full ring-2 ring-white" style={{ backgroundColor: preview.text }} />
        </span>
      </div>

      <div className="flex items-center gap-3">
        <span
          className="min-w-0 flex-1 truncate px-3 py-1.5 text-center text-[11px] font-medium"
          style={{ backgroundColor: preview.accent, color: preview.accentText, borderRadius: buttonRadius, fontFamily: preview.bodyFontStack }}
        >
          Button
        </span>
        <span
          className="min-w-0 flex-1 truncate px-3 py-1.5 text-center text-[11px] font-medium"
          style={{
            backgroundColor: "transparent",
            color: preview.text,
            border: `1px solid ${preview.text}`,
            borderRadius: buttonRadius,
            fontFamily: preview.bodyFontStack,
          }}
        >
          Button
        </span>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-neutral-900">{template.name}</span>
        {selected ? (
          <span className="flex items-center gap-1 text-[11px] font-medium text-neutral-900">
            <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
            Applied
          </span>
        ) : null}
      </div>
    </button>
  );
}
