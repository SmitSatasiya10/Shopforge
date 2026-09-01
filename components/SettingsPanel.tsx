"use client";

import {
  PRESENTATIONAL_TYPES,
  ShopifySectionSchema,
  ShopifySettingDef,
  resolveSchemaLabel,
} from "@/lib/preview/section-schema";
import { filledIconSettingId, isIconSettingId } from "@/lib/preview/icon-setting";

interface SettingsPanelProps {
  sectionType: string | null;
  schema: ShopifySectionSchema | null;
  values: Record<string, unknown>;
  schemaLocale: Record<string, unknown>;
  onChange: (settingId: string, value: unknown) => void;
  /** Opens the "Your media" panel targeting this image_picker setting. */
  onBrowseMedia: (settingId: string) => void;
  /** Opens the icon picker (IconPanel) targeting this icon-name setting. */
  onBrowseIcon: (settingId: string) => void;
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
  onBrowseMedia,
  onBrowseIcon,
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
                <SettingControl
                  setting={setting}
                  value={value}
                  allValues={values}
                  onChange={onChange}
                  onBrowseMedia={onBrowseMedia}
                  onBrowseIcon={onBrowseIcon}
                  schemaLocale={schemaLocale}
                />
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
  allValues,
  onChange,
  onBrowseMedia,
  onBrowseIcon,
  schemaLocale,
}: {
  setting: ShopifySettingDef;
  value: unknown;
  allValues: Record<string, unknown>;
  onChange: (id: string, value: unknown) => void;
  onBrowseMedia: (settingId: string) => void;
  onBrowseIcon: (settingId: string) => void;
  schemaLocale: Record<string, unknown>;
}) {
  const id = setting.id!;
  const input = "rounded border border-neutral-300 p-2 text-sm font-normal";

  // Shopify has no dedicated "icon" setting type — this theme's icon settings are plain `text`
  // fields following an `icon`/`icon_N` naming convention (lib/preview/icon-setting.ts), so
  // detection is by id rather than by setting.type. Shown as a glyph preview + "Browse icons"
  // button instead of falling through to the generic text input below.
  if (setting.type === "text" && isIconSettingId(id)) {
    const filled = Boolean(allValues[filledIconSettingId(id)]);
    const iconName = String(value).trim();
    return (
      <span className="flex items-center gap-2">
        <span
          className={`grid h-8 w-8 shrink-0 place-items-center rounded border border-neutral-300 material-symbols-outlined${
            filled ? " filled" : ""
          }`}
        >
          {iconName || "help"}
        </span>
        <button
          type="button"
          onClick={() => onBrowseIcon(id)}
          className="flex-1 rounded border border-neutral-300 px-2 py-2 text-left text-xs font-medium text-neutral-700 hover:bg-neutral-100"
        >
          {iconName ? iconName.replace(/_/g, " ") : "Browse icons"}
        </button>
      </span>
    );
  }

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
    // so it is edited as a URL, either typed directly or picked from the project's existing
    // product images via "Your media" (MediaPanel).
    case "image_picker":
      return (
        <span className="flex items-center gap-2">
          <input
            type="url"
            className={`${input} flex-1`}
            placeholder={setting.placeholder}
            value={String(value)}
            onChange={(e) => onChange(id, e.target.value)}
          />
          <button
            type="button"
            onClick={() => onBrowseMedia(id)}
            className="shrink-0 rounded border border-neutral-300 px-2 py-2 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
          >
            Browse media
          </button>
        </span>
      );

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
