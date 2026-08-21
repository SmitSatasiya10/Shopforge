"use client";

import {
  PRESENTATIONAL_TYPES,
  ShopifySectionSchema,
  ShopifySettingDef,
  resolveSchemaLabel,
} from "@/lib/preview/section-schema";

interface SettingsPanelProps {
  sectionType: string | null;
  schema: ShopifySectionSchema | null;
  values: Record<string, unknown>;
  schemaLocale: Record<string, unknown>;
  onChange: (settingId: string, value: unknown) => void;
  onClose: () => void;
  /** Collapses the panel to its rail; distinct from onClose, which clears the selection. */
  onCollapse: () => void;
}

/**
 * The Inspector, rendered from a section's real Shopify `{% schema %}`. Setting types map
 * one-to-one onto the controls Shopify's own editor uses, so a section behaves the same here
 * as it will in the Shopify theme editor (docs/product-spec/09-visual-editor.md).
 */
export function SettingsPanel({
  sectionType,
  schema,
  values,
  schemaLocale,
  onChange,
  onClose,
  onCollapse,
}: SettingsPanelProps) {
  const collapseButton = (
    <button
      onClick={onCollapse}
      title="Collapse panel"
      className="text-xs text-neutral-500 hover:text-neutral-900"
    >
      ⟩⟩
    </button>
  );

  if (!sectionType) {
    return (
      <aside className="w-80 shrink-0 border-l border-neutral-200 p-4 text-sm text-neutral-500">
        <div className="mb-2 flex justify-end">{collapseButton}</div>
        Click a section in the preview to edit its settings.
      </aside>
    );
  }

  const label = (setting: ShopifySettingDef) => resolveSchemaLabel(setting.label, schemaLocale);

  return (
    // `min-h-0` lets this shrink to its flex parent so `overflow-y-auto` scrolls the panel
    // itself; `overscroll-contain` stops a scroll that reaches the end from chaining out to
    // the page behind it.
    <aside className="w-80 min-h-0 shrink-0 overflow-y-auto overscroll-contain border-l border-neutral-200 p-4">
      <div className="mb-4 flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900">
            {resolveSchemaLabel(schema?.name, schemaLocale) || sectionType}
          </h2>
          <p className="font-mono text-[11px] text-neutral-400">{sectionType}</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="text-xs text-neutral-500 hover:text-neutral-900">
            Close
          </button>
          {collapseButton}
        </div>
      </div>

      {!schema ? (
        <p className="text-xs text-neutral-500">This section exposes no editable schema.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {schema.settings.map((setting, i) => {
            if (PRESENTATIONAL_TYPES.has(setting.type)) {
              return (
                <p
                  key={`presentational-${i}`}
                  className="border-t border-neutral-200 pt-3 text-xs font-semibold tracking-wide text-neutral-500 uppercase"
                >
                  {label(setting)}
                </p>
              );
            }
            if (!setting.id) return null;

            const value = values[setting.id] ?? setting.default ?? "";
            return (
              <label
                key={setting.id}
                className="flex flex-col gap-1 text-xs font-medium text-neutral-700"
              >
                {label(setting)}
                <SettingControl setting={setting} value={value} onChange={onChange} schemaLocale={schemaLocale} />
                {setting.info ? (
                  <span className="text-[11px] font-normal text-neutral-400">
                    {resolveSchemaLabel(setting.info, schemaLocale)}
                  </span>
                ) : null}
              </label>
            );
          })}
        </div>
      )}
    </aside>
  );
}

function SettingControl({
  setting,
  value,
  onChange,
  schemaLocale,
}: {
  setting: ShopifySettingDef;
  value: unknown;
  onChange: (id: string, value: unknown) => void;
  schemaLocale: Record<string, unknown>;
}) {
  const id = setting.id!;
  const input = "rounded border border-neutral-300 p-2 text-sm font-normal";

  switch (setting.type) {
    case "checkbox":
      return (
        <input
          type="checkbox"
          className="h-4 w-4"
          checked={Boolean(value)}
          onChange={(e) => onChange(id, e.target.checked)}
        />
      );

    case "select":
    case "radio":
      return (
        <select className={input} value={String(value)} onChange={(e) => onChange(id, e.target.value)}>
          {(setting.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {resolveSchemaLabel(option.label, schemaLocale)}
            </option>
          ))}
        </select>
      );

    case "range":
      return (
        <span className="flex items-center gap-2">
          <input
            type="range"
            className="flex-1"
            min={setting.min}
            max={setting.max}
            step={setting.step}
            value={Number(value) || setting.min || 0}
            onChange={(e) => onChange(id, Number(e.target.value))}
          />
          <span className="w-12 text-right font-mono text-[11px] text-neutral-500">
            {String(value)}
            {setting.unit}
          </span>
        </span>
      );

    case "color":
      return (
        <input
          type="color"
          className="h-8 w-full rounded border border-neutral-300"
          value={/^#[0-9a-f]{6}$/i.test(String(value)) ? String(value) : "#000000"}
          onChange={(e) => onChange(id, e.target.value)}
        />
      );

    case "number":
      return (
        <input
          type="number"
          className={input}
          value={String(value)}
          onChange={(e) => onChange(id, e.target.value === "" ? "" : Number(e.target.value))}
        />
      );

    case "textarea":
    case "richtext":
    case "html":
    case "liquid":
      return (
        <textarea
          className={input}
          rows={4}
          value={String(value)}
          onChange={(e) => onChange(id, e.target.value)}
        />
      );

    // image_picker holds a URL in the preview — there is no Shopify Files store behind it,
    // so it is edited as a URL and populated by the image toggle during generation.
    case "image_picker":
    case "video":
    case "url":
    case "video_url":
      return (
        <input
          type="url"
          className={input}
          placeholder={setting.placeholder}
          value={String(value)}
          onChange={(e) => onChange(id, e.target.value)}
        />
      );

    default:
      return (
        <input
          type="text"
          className={input}
          placeholder={setting.placeholder}
          value={String(value)}
          onChange={(e) => onChange(id, e.target.value)}
        />
      );
  }
}
