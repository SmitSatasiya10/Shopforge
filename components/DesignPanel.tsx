"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Image,
  MousePointerClick,
  Palette,
  Search,
  Shuffle,
  SquareRoundCorner,
  Star,
  Type,
  X,
  type LucideIcon,
} from "lucide-react";
import { resolveSchemaLabel } from "@/lib/preview/section-schema";
import {
  BUTTON_STYLE_PRESETS,
  CARD_STYLE_PRESETS,
  DESIGN_CATEGORIES,
  DesignCategoryKey,
  DesignSettingRow,
  IMAGE_STYLE_PRESETS,
  matchStylePreset,
  SchemaGroup,
  settingsForCategory,
  TYPOGRAPHY_PRIMARY_IDS,
} from "@/lib/editor/design-categories";
import { describeFontHandle, fontFamilyName, type FontOption } from "@/lib/editor/font-options";
import { SettingControl } from "./SettingsPanel";

const CATEGORY_ICONS: Record<DesignCategoryKey, LucideIcon> = {
  colors: Palette,
  typography: Type,
  buttons: MousePointerClick,
  media: Image,
  cards: CreditCard,
  icons: Star,
  borderRadius: SquareRoundCorner,
};

interface DesignPanelProps {
  activeCategory: DesignCategoryKey | null;
  onSelectCategory: (key: DesignCategoryKey | null) => void;
  schemaGroups: SchemaGroup[];
  schemaLocale: Record<string, unknown>;
  values: Record<string, unknown>;
  onChange: (settingId: string, value: unknown) => void;
  /** Applies several real theme settings at once (a Buttons style preset) as one undo step. */
  onApplyPreset: (values: Record<string, unknown>) => void;
  /** Rolls a new curated, coordinated Primary/Secondary pair — one themeSettings update. */
  onShufflePalette: () => void;
  onClose: () => void;
  /** Known font handles for any `font_picker` setting in the current category (Typography). */
  fontOptions: FontOption[];
}

/**
 * Global theme settings — colors/typography/buttons/images/cards/icons/border-radius — applied
 * store-wide via StoreConfiguration.themeSettings, distinct from the section Inspector
 * (SettingsPanel) and the per-block image/icon pickers, which stay untouched. Same sidebar
 * slot and w-72 light-theme convention as MediaPanel/IconPanel.
 */
export function DesignPanel({
  activeCategory,
  onSelectCategory,
  schemaGroups,
  schemaLocale,
  values,
  onChange,
  onApplyPreset,
  onShufflePalette,
  onClose,
  fontOptions,
}: DesignPanelProps) {
  const category = DESIGN_CATEGORIES.find((c) => c.key === activeCategory) ?? null;

  return (
    <div className="flex min-h-0 w-72 shrink-0 flex-col border-r border-neutral-200 bg-white text-neutral-900">
      <div className="flex items-center gap-2 px-4 py-3">
        {category ? (
          <button
            onClick={() => onSelectCategory(null)}
            title="Back to Design"
            className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-900"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        ) : null}
        <p className="flex-1 text-sm font-semibold text-neutral-900">{category ? category.label : "Design"}</p>
        <button onClick={onClose} title="Close" className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-900">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!category ? (
          <div className="flex flex-col p-2">
            {DESIGN_CATEGORIES.map(({ key, label }) => {
              const Icon = CATEGORY_ICONS[key];
              return (
                <button
                  key={key}
                  onClick={() => onSelectCategory(key)}
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-neutral-700 hover:bg-neutral-100"
                >
                  <Icon className="h-4 w-4 shrink-0 text-neutral-500" strokeWidth={1.75} />
                  <span className="flex-1">{label}</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-neutral-300" />
                </button>
              );
            })}
          </div>
        ) : category.key === "colors" ? (
          <div className="flex flex-col gap-4 p-4">
            {groupBySectionLabel(settingsForCategory("colors", schemaGroups)).map(([sectionLabel, rows]) => (
              <div key={sectionLabel} className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">{sectionLabel}</p>
                  {sectionLabel === "Color Palette" ? <PaletteShuffleButton onShuffle={onShufflePalette} /> : null}
                </div>
                <div className="flex flex-col gap-1.5">
                  {rows.map(({ setting, labelOverride }) => (
                    <ColorRow
                      key={setting.id}
                      id={setting.id!}
                      label={labelOverride ?? resolveSchemaLabel(setting.label, schemaLocale)}
                      info={resolveSchemaLabel(setting.info, schemaLocale)}
                      value={String(values[setting.id!] ?? setting.default ?? "")}
                      onChange={onChange}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : category.key === "typography" ? (
          <TypographySection
            rows={settingsForCategory("typography", schemaGroups)}
            values={values}
            schemaLocale={schemaLocale}
            onChange={onChange}
            fontOptions={fontOptions}
          />
        ) : category.key === "buttons" ? (
          <div className="flex flex-col gap-2 p-4">
            <p className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">Styles</p>
            <ButtonStyleCards values={values} onApplyPreset={onApplyPreset} />
          </div>
        ) : category.key === "media" ? (
          <div className="flex flex-col gap-2 p-4">
            <p className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">Styles</p>
            <ImageStyleCards values={values} onApplyPreset={onApplyPreset} />
          </div>
        ) : category.key === "cards" ? (
          <div className="flex flex-col gap-2 p-4">
            <p className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">Styles</p>
            <CardStyleCards values={values} onApplyPreset={onApplyPreset} />
          </div>
        ) : (
          <div className="flex flex-col gap-4 p-4">
            {settingsForCategory(category.key, schemaGroups).map((row, i, rows) => (
              <SettingRow
                key={row.setting.id ?? i}
                row={row}
                previousSectionLabel={rows[i - 1]?.sectionLabel}
                values={values}
                schemaLocale={schemaLocale}
                onChange={onChange}
                fontOptions={fontOptions}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** [sectionLabel, rows] pairs, in first-seen order — used by Colors to render one heading per
 *  group instead of repeating it whenever the previous row's group happens to differ. */
function groupBySectionLabel(rows: DesignSettingRow[]): [string, DesignSettingRow[]][] {
  const groups = new Map<string, DesignSettingRow[]>();
  for (const row of rows) {
    const label = row.sectionLabel ?? "";
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(row);
  }
  return [...groups.entries()];
}

/**
 * "Shuffle palette" — rolls a new curated, coordinated Primary/Secondary pair
 * (lib/editor/palette-shuffle.ts) in one click/one undo step. Deterministic/local, so the
 * "loading" state here is purely a brief visual acknowledgment, not a real async wait; the
 * short disable window is what actually prevents a double-click from queueing two shuffles.
 */
function PaletteShuffleButton({ onShuffle }: { onShuffle: () => void }) {
  const [active, setActive] = useState(false);

  const handleClick = () => {
    if (active) return;
    setActive(true);
    onShuffle();
    setTimeout(() => setActive(false), 300);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={active}
      title="Shuffle palette"
      aria-label="Shuffle palette"
      className="shrink-0 rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-50"
    >
      <Shuffle className={`h-3.5 w-3.5 transition-transform duration-300 ${active ? "rotate-180" : ""}`} />
    </button>
  );
}

/**
 * Design → Colors: a compact swatch + label + hex row instead of a label-above-input block —
 * the swatch IS a native `<input type="color">` (real picker, real onChange, no second color
 * state), just styled to read as a visual palette entry. `info` (dropped from the earlier
 * permanent-paragraph treatment) survives as the row's native tooltip.
 */
function ColorRow({
  id,
  label,
  info,
  value,
  onChange,
}: {
  id: string;
  label: string;
  info?: string;
  value: string;
  onChange: (settingId: string, value: unknown) => void;
}) {
  const hex = /^#[0-9a-f]{6}$/i.test(value) ? value : "#000000";
  return (
    <label
      title={info || undefined}
      className="flex items-center gap-3 rounded-lg border border-neutral-200 px-3 py-2 hover:border-neutral-400"
    >
      <input
        type="color"
        value={hex}
        onChange={(e) => onChange(id, e.target.value)}
        className="h-8 w-8 shrink-0 cursor-pointer rounded-full border border-neutral-300 bg-transparent p-0 [&::-moz-color-swatch]:rounded-full [&::-moz-color-swatch]:border-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:rounded-full [&::-webkit-color-swatch-wrapper]:p-0"
      />
      <span className="flex-1 text-xs font-medium text-neutral-700">{label}</span>
      <span className="font-mono text-[11px] text-neutral-400 uppercase">{hex}</span>
    </label>
  );
}

/**
 * Design → Typography: just the two settings a merchant actually thinks of as "the fonts"
 * (type_header_font/type_body_font), as searchable font pickers instead of raw dropdowns.
 * Every other typography setting (scale, line height, letter spacing, custom-font fields) is a
 * real setting still, just tucked under a closed-by-default "Advanced" — nothing removed from
 * the underlying configuration, only hidden from the primary view.
 */
function TypographySection({
  rows,
  values,
  schemaLocale,
  onChange,
  fontOptions,
}: {
  rows: DesignSettingRow[];
  values: Record<string, unknown>;
  schemaLocale: Record<string, unknown>;
  onChange: (settingId: string, value: unknown) => void;
  fontOptions: FontOption[];
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const headerRow = rows.find((r) => r.setting.id === "type_header_font");
  const bodyRow = rows.find((r) => r.setting.id === "type_body_font");
  const advancedRows = rows.filter((r) => !TYPOGRAPHY_PRIMARY_IDS.includes(r.setting.id ?? ""));

  return (
    <div className="flex flex-col gap-4 p-4">
      <p className="text-sm font-semibold text-neutral-900">Fonts</p>
      {headerRow ? (
        <FontRow
          label="Titles"
          value={String(values[headerRow.setting.id!] ?? headerRow.setting.default ?? "")}
          options={fontOptions}
          onChange={(value) => onChange(headerRow.setting.id!, value)}
        />
      ) : null}
      {bodyRow ? (
        <FontRow
          label="Content"
          value={String(values[bodyRow.setting.id!] ?? bodyRow.setting.default ?? "")}
          options={fontOptions}
          onChange={(value) => onChange(bodyRow.setting.id!, value)}
        />
      ) : null}
      {advancedRows.length > 0 ? (
        <div className="flex flex-col gap-3 border-t border-neutral-200 pt-3">
          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            className="flex items-center gap-1 self-start text-xs font-semibold tracking-wide text-neutral-500 uppercase hover:text-neutral-700"
          >
            <ChevronRight className={`h-3.5 w-3.5 transition-transform ${advancedOpen ? "rotate-90" : ""}`} />
            Advanced
          </button>
          {advancedOpen ? (
            <div className="flex flex-col gap-4">
              {advancedRows.map((row, i) => (
                <SettingRow
                  key={row.setting.id ?? i}
                  row={row}
                  previousSectionLabel={advancedRows[i - 1]?.sectionLabel}
                  values={values}
                  schemaLocale={schemaLocale}
                  onChange={onChange}
                  fontOptions={fontOptions}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** A large button showing the current font's friendly name, opening a searchable list on click
 *  — same "click outside/Escape closes" pattern as ColorPickerPopover.tsx. Storing/reading the
 *  value goes through the same `onChange` every other control uses; this only changes the
 *  control's presentation. */
function FontRow({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: FontOption[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const current = options.find((o) => o.value === value);
  const currentLabel = current?.label ?? (value ? describeFontHandle(value) : "");
  const filtered = query.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  return (
    <div ref={ref} className="relative flex flex-col gap-1">
      <span className="text-xs font-medium text-neutral-500">{label}</span>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between gap-2 rounded-lg border border-neutral-200 px-3 py-2.5 text-left text-sm font-medium text-neutral-900 hover:border-neutral-400"
      >
        <span className="truncate" style={{ fontFamily: value ? `'${fontFamilyName(value)}', sans-serif` : undefined }}>
          {currentLabel || "Select a font"}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-neutral-400" />
      </button>

      {open ? (
        <div className="absolute top-full left-0 z-30 mt-1 w-full overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-lg">
          <div className="flex items-center gap-2 border-b border-neutral-100 px-2.5 py-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search font..."
              className="w-full text-xs text-neutral-900 outline-none placeholder:text-neutral-400"
            />
          </div>
          <div className="max-h-48 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <p className="px-2 py-3 text-xs text-neutral-400">No fonts match &quot;{query}&quot;.</p>
            ) : (
              filtered.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                    setQuery("");
                  }}
                  className={`block w-full rounded px-2 py-1.5 text-left text-xs ${
                    option.value === value ? "bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-100"
                  }`}
                >
                  {option.label}
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SettingRow({
  row: { setting, sectionLabel, labelOverride },
  previousSectionLabel,
  values,
  schemaLocale,
  onChange,
  fontOptions,
}: {
  row: DesignSettingRow;
  previousSectionLabel?: string;
  values: Record<string, unknown>;
  schemaLocale: Record<string, unknown>;
  onChange: (settingId: string, value: unknown) => void;
  fontOptions: FontOption[];
}) {
  return (
    <div className="flex flex-col gap-1">
      {sectionLabel && sectionLabel !== previousSectionLabel ? (
        <p className="border-t border-neutral-200 pt-3 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
          {sectionLabel}
        </p>
      ) : null}
      <label className="flex flex-col gap-1 text-xs font-medium text-neutral-700">
        {labelOverride ?? resolveSchemaLabel(setting.label, schemaLocale)}
        <SettingControl
          setting={setting}
          value={values[setting.id!] ?? setting.default ?? ""}
          allValues={values}
          onChange={onChange}
          onBrowseMedia={() => {}}
          onBrowseIcon={() => {}}
          schemaLocale={schemaLocale}
          fontOptions={fontOptions}
        />
        {setting.info ? (
          <span className="text-[11px] font-normal text-neutral-400">{resolveSchemaLabel(setting.info, schemaLocale)}</span>
        ) : null}
      </label>
    </div>
  );
}

/**
 * Design → Buttons → Styles: five real presets, each a bundle of the theme's own
 * buttons_radius/border/shadow settings (lib/editor/design-categories.ts documents why
 * Gradient/Ghost aren't included — no backing capability exists for either). Every card's
 * preview renders the literal geometry that preset writes, not a stand-in illustration.
 */
function ButtonStyleCards({
  values,
  onApplyPreset,
}: {
  values: Record<string, unknown>;
  onApplyPreset: (values: Record<string, unknown>) => void;
}) {
  const activeKey = matchStylePreset(BUTTON_STYLE_PRESETS, values);

  return (
    <div className="flex flex-col gap-2">
      {BUTTON_STYLE_PRESETS.map((preset) => {
        const selected = preset.key === activeKey;
        return (
          <button
            key={preset.key}
            type="button"
            aria-pressed={selected}
            onClick={() => onApplyPreset(preset.values)}
            className={`flex flex-col gap-2 rounded-xl border p-3 text-left transition ${
              selected ? "border-neutral-900 bg-neutral-50 ring-1 ring-neutral-900" : "border-neutral-200 hover:border-neutral-400"
            }`}
          >
            <ButtonStylePreview values={preset.values} />
            <span className={`text-xs font-medium ${selected ? "text-neutral-900" : "text-neutral-600"}`}>{preset.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function ButtonStylePreview({ values }: { values: Record<string, number> }) {
  const border = values.buttons_border_thickness
    ? `${values.buttons_border_thickness}px solid rgba(255,255,255,${(values.buttons_border_opacity ?? 0) / 100})`
    : undefined;
  const boxShadow = values.buttons_shadow_opacity
    ? `${values.buttons_shadow_horizontal_offset ?? 0}px ${values.buttons_shadow_vertical_offset ?? 0}px ${
        values.buttons_shadow_blur ?? 0
      }px rgba(0,0,0,${values.buttons_shadow_opacity / 100})`
    : undefined;

  return (
    <span
      className="flex w-full items-center justify-center bg-neutral-900 px-4 py-2.5 text-sm font-semibold text-white"
      style={{ borderRadius: `${values.buttons_radius ?? 0}px`, border, boxShadow }}
    >
      Add to cart
    </span>
  );
}

/**
 * Design → Images → Styles: six real presets, each a bundle of the theme's own
 * media_border_thickness/opacity, media_radius, and media_shadow_* settings — every one of the
 * theme's real Media settings, none left over. 2-column grid to match the reference layout.
 */
function ImageStyleCards({
  values,
  onApplyPreset,
}: {
  values: Record<string, unknown>;
  onApplyPreset: (values: Record<string, unknown>) => void;
}) {
  const activeKey = matchStylePreset(IMAGE_STYLE_PRESETS, values);

  return (
    <div className="grid grid-cols-2 gap-3">
      {IMAGE_STYLE_PRESETS.map((preset) => {
        const selected = preset.key === activeKey;
        return (
          <button
            key={preset.key}
            type="button"
            aria-pressed={selected}
            onClick={() => onApplyPreset(preset.values)}
            className={`flex flex-col items-center gap-2 rounded-xl border p-2 transition ${
              selected ? "border-neutral-900 bg-neutral-50 ring-1 ring-neutral-900" : "border-neutral-200 hover:border-neutral-400"
            }`}
          >
            <ImageStylePreview values={preset.values} />
            <span className={`text-xs font-medium ${selected ? "text-neutral-900" : "text-neutral-600"}`}>{preset.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function ImageStylePreview({ values }: { values: Record<string, number> }) {
  const border = values.media_border_thickness
    ? `${values.media_border_thickness}px solid rgba(23,23,23,${(values.media_border_opacity ?? 0) / 100})`
    : undefined;
  const boxShadow = values.media_shadow_opacity
    ? `${values.media_shadow_horizontal_offset ?? 0}px ${values.media_shadow_vertical_offset ?? 0}px ${
        values.media_shadow_blur ?? 0
      }px rgba(23,23,23,${values.media_shadow_opacity / 100})`
    : undefined;

  return (
    <span
      className="block aspect-square w-full bg-gradient-to-br from-amber-100 to-neutral-300"
      style={{ borderRadius: `${values.media_radius ?? 0}px`, border, boxShadow }}
    />
  );
}

/**
 * Design → Cards → Styles: four real presets bundling the theme's own card_border_thickness/
 * opacity, card_corner_radius, and card_shadow_* settings (lib/editor/design-categories.ts
 * documents why card_style — the schema's real but 2-value "Standard/Card" setting — stays a
 * separate control below instead of folding into these four). Preview renders a small card
 * skeleton (image block + text lines) with the literal geometry each preset writes.
 */
function CardStyleCards({
  values,
  onApplyPreset,
}: {
  values: Record<string, unknown>;
  onApplyPreset: (values: Record<string, unknown>) => void;
}) {
  const activeKey = matchStylePreset(CARD_STYLE_PRESETS, values);

  return (
    <div className="grid grid-cols-2 gap-3">
      {CARD_STYLE_PRESETS.map((preset) => {
        const selected = preset.key === activeKey;
        return (
          <button
            key={preset.key}
            type="button"
            aria-pressed={selected}
            onClick={() => onApplyPreset(preset.values)}
            className={`flex flex-col items-center gap-2 rounded-xl border p-2 transition ${
              selected ? "border-neutral-900 bg-neutral-50 ring-1 ring-neutral-900" : "border-neutral-200 hover:border-neutral-400"
            }`}
          >
            <CardStylePreview values={preset.values} />
            <span className={`text-xs font-medium ${selected ? "text-neutral-900" : "text-neutral-600"}`}>{preset.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function CardStylePreview({ values }: { values: Record<string, number> }) {
  const border = values.card_border_thickness
    ? `${values.card_border_thickness}px solid rgba(23,23,23,${(values.card_border_opacity ?? 0) / 100})`
    : undefined;
  const boxShadow = values.card_shadow_opacity
    ? `${values.card_shadow_horizontal_offset ?? 0}px ${values.card_shadow_vertical_offset ?? 0}px ${
        values.card_shadow_blur ?? 0
      }px rgba(23,23,23,${values.card_shadow_opacity / 100})`
    : undefined;

  return (
    <span
      className="flex w-full flex-col gap-1.5 bg-white p-2"
      style={{ borderRadius: `${values.card_corner_radius ?? 0}px`, border, boxShadow }}
    >
      <span className="block aspect-[4/3] w-full rounded-sm bg-gradient-to-br from-amber-100 to-neutral-300" />
      <span className="block h-1.5 w-3/4 rounded-full bg-neutral-300" />
      <span className="block h-1.5 w-1/2 rounded-full bg-neutral-200" />
    </span>
  );
}
