import { ShopifySettingDef } from "@/lib/preview/section-schema";

// Maps a bound text setting's schema onto the inline toolbar's typographic controls
// (docs/EDITOR-TOOLBARS.md). Everything is heuristic-by-id over the block's (or section's)
// own settings — a control renders only when the schema really has somewhere to write, so
// the toolbar can never invent a setting the Liquid doesn't read.

export interface SizeControl {
  kind: "select" | "range";
  settingId: string;
  /** For selects: values in ascending visual size (schema order for this theme is h3→h0). */
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
}

export interface ColorControl {
  settingId: string;
  /** The `enable_custom_color`-style checkbox that gates the color, when the schema has one. */
  enableId?: string;
  /**
   * Highlight-color settings that must follow the text color. The theme styles <strong>/<em>
   * inside headings and text blocks with their own "highlight" colors (base.css:
   * `.heading.title-with-highlight-1--color strong { color: var(--hightlight-1--color) }`),
   * and a direct rule on strong beats the element's inherited custom color — so a title
   * wrapped entirely in <strong> would ignore the picked color unless these move with it.
   */
  companionIds: string[];
}

export interface AlignControl {
  settingId: string;
  /** Option values in schema order (this theme: left, center, right). */
  options: string[];
  /**
   * The matching `mobile_alignment` select, when declared. Alignment is directional intent
   * ("center this"), so unlike size it follows to mobile — mapped by option index because
   * the mobile values carry a `mobile-` prefix.
   */
  mobileId?: string;
  mobileOptions?: string[];
}

export interface TextControls {
  size?: SizeControl;
  weight?: { settingId: string; options: string[] };
  color?: ColorControl;
  align?: AlignControl;
}

const SIZE_ID = /size/i;
const MOBILE = /mobile/i;
const WEIGHT_ID = /weight/i;
const ALIGN_ID = /align/i;
/** The theme's per-element color settings; highlight/border/bold decorations are not "the text color". */
const COLOR_IDS = new Set(["custom_color", "custom_text_color", "text_color", "color"]);
/**
 * Highlight colors applied to <strong>/<em> spans, which must track the picked text color.
 * The `_gradient` variants matter just as much as the solid ones: in gradient mode the
 * theme paints the text via `background: var(--hightlight-1--color)` + background-clip with
 * a TRANSPARENT text fill — the element's own `color` is invisible — and a flat hex is a
 * valid CSS background, so writing it there renders the picked color in that mode too.
 */
const COMPANION_COLOR_ID = /^title_highlight_\d+_(color|gradient)$|^(bold|italic)_(solid|gradient)_color$/;
const COMPANION_TYPES = new Set(["color", "color_background"]);

export function findTextControls(defs: ShopifySettingDef[] | undefined): TextControls {
  const settings = (defs ?? []).filter((d) => d.id);
  const controls: TextControls = {};

  const sizeSelect = settings.find((d) => d.type === "select" && SIZE_ID.test(d.id!) && !MOBILE.test(d.id!));
  const sizeRange = settings.find(
    (d) => (d.type === "range" || d.type === "number") && SIZE_ID.test(d.id!) && !MOBILE.test(d.id!),
  );
  if (sizeSelect?.options?.length) {
    controls.size = {
      kind: "select",
      settingId: sizeSelect.id!,
      // "custom" switches the block to freeform pixel settings — stepping skips it.
      options: sizeSelect.options.map((o) => o.value).filter((v) => v !== "custom"),
    };
  } else if (sizeRange) {
    controls.size = {
      kind: "range",
      settingId: sizeRange.id!,
      min: sizeRange.min ?? 8,
      max: sizeRange.max ?? 72,
      step: sizeRange.step ?? 1,
    };
  }

  const weight = settings.find((d) => d.type === "select" && WEIGHT_ID.test(d.id!) && d.options?.length);
  if (weight) controls.weight = { settingId: weight.id!, options: weight.options!.map((o) => o.value) };

  const align = settings.find(
    (d) => d.type === "select" && ALIGN_ID.test(d.id!) && !MOBILE.test(d.id!) && d.options?.length,
  );
  if (align) {
    const mobile = settings.find(
      (d) => d.type === "select" && ALIGN_ID.test(d.id!) && MOBILE.test(d.id!) && d.options?.length,
    );
    controls.align = {
      settingId: align.id!,
      options: align.options!.map((o) => o.value),
      mobileId: mobile?.id,
      mobileOptions: mobile?.options?.map((o) => o.value),
    };
  }

  const color = settings.find((d) => d.type === "color" && COLOR_IDS.has(d.id!));
  if (color) {
    const enable = settings.find((d) => d.type === "checkbox" && /enable.*color/i.test(d.id!));
    const companions = settings
      .filter((d) => COMPANION_TYPES.has(d.type) && COMPANION_COLOR_ID.test(d.id!))
      .map((d) => d.id!);
    controls.color = { settingId: color.id!, enableId: enable?.id, companionIds: companions };
  }

  return controls;
}

/**
 * Generic small-to-large scale for the inline toolbar's size display — friendlier than a
 * theme's own raw option value (h0/h1/h2/h3, meaningless to a merchant) or a bare pixel
 * number, and independent of whatever wording a given block's schema happens to use.
 */
const SIZE_SCALE = ["XS", "S", "M", "L", "XL", "XXL", "XXXL"];

/**
 * Friendly display label for the toolbar's size control. For a `select`, schema options are
 * already documented as ascending visual size (see `SizeControl.options`), so position maps
 * directly onto the scale — this theme's actual heading-size options (Extra small/Small/
 * Medium/Large) land on exactly XS/S/M/L. For a `range`, there's no discrete step a theme
 * names, so the continuous min..max domain is bucketed into the same scale by where the
 * value falls. Falls back to the raw stored value when it can't be placed (unset, or more
 * discrete options than the scale covers).
 */
export function sizeLabel(control: SizeControl, currentValue: unknown): string {
  if (control.kind === "select") {
    const options = control.options ?? [];
    const index = options.indexOf(String(currentValue));
    if (index === -1 || index >= SIZE_SCALE.length) return String(currentValue ?? "–");
    return SIZE_SCALE[index];
  }
  const min = control.min ?? 0;
  const max = control.max ?? min + 1;
  const value = typeof currentValue === "number" ? currentValue : Number(currentValue);
  if (!Number.isFinite(value) || max <= min) return String(currentValue ?? "–");
  const fraction = Math.min(1, Math.max(0, (value - min) / (max - min)));
  const bucket = Math.round(fraction * (SIZE_SCALE.length - 1));
  return SIZE_SCALE[bucket];
}

/** The setting writes for one −/+ step. Returns null at the end of the scale. */
export function stepSize(
  control: SizeControl,
  currentValue: unknown,
  direction: -1 | 1,
): Record<string, unknown> | null {
  if (control.kind === "select") {
    const options = control.options ?? [];
    const index = options.indexOf(String(currentValue));
    const next = (index === -1 ? options.length - 1 : index) + direction;
    if (next < 0 || next >= options.length) return null;
    return { [control.settingId]: options[next] };
  }
  const step = control.step ?? 1;
  const current = typeof currentValue === "number" ? currentValue : Number(currentValue) || control.min || 14;
  const next = current + direction * step;
  if (next < (control.min ?? 0) || next > (control.max ?? Number.MAX_SAFE_INTEGER)) return null;
  return { [control.settingId]: next };
}

/**
 * The writes for picking a color: the color itself, the enable checkbox that gates it, and
 * the <strong>/<em> highlight colors that would otherwise override it (see ColorControl).
 */
export function applyColor(control: ColorControl, hex: string): Record<string, unknown> {
  const values: Record<string, unknown> = { [control.settingId]: hex };
  if (control.enableId) values[control.enableId] = true;
  for (const id of control.companionIds) values[id] = hex;
  return values;
}

/** The writes for picking an alignment: the desktop select, and the mobile one in step. */
export function applyAlign(control: AlignControl, value: string): Record<string, unknown> {
  const values: Record<string, unknown> = { [control.settingId]: value };
  const index = control.options.indexOf(value);
  const mobileValue = index === -1 ? undefined : control.mobileOptions?.[index];
  if (control.mobileId && mobileValue !== undefined) values[control.mobileId] = mobileValue;
  return values;
}

/** The writes for cycling the weight select to its next option. */
export function cycleWeight(
  control: { settingId: string; options: string[] },
  currentValue: unknown,
): Record<string, unknown> {
  const index = control.options.indexOf(String(currentValue));
  return { [control.settingId]: control.options[(index + 1) % control.options.length] };
}
