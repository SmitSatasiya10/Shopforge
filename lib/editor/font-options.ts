import { SchemaGroup } from "@/lib/editor/design-categories";

// The Design panel's font dropdown — built strictly from font handles that actually appear in
// the Base Theme's own config files (a font_picker setting's schema default, its current value,
// or any of settings_data.json's presets), never a fabricated font catalog. Shopify's real font
// picker draws from a huge hosted library this project doesn't have; this theme instead stores
// a plain handle like "poetsen_one_n4" (family + weight/style code — lib/shopify-compat/
// setting-drops.ts's FontDrop), so the only "known" fonts are the ones already on record here.

export interface FontOption {
  value: string;
  label: string;
}

const WEIGHT_NAMES: Record<number, string> = {
  100: "Thin",
  200: "Extra Light",
  300: "Light",
  400: "",
  500: "Medium",
  600: "Semibold",
  700: "Bold",
  800: "Extra Bold",
  900: "Black",
};

function parseFontHandle(handle: string): { family: string; weight: number; style: "normal" | "italic" } {
  const match = handle.match(/^(.*)_([ni])(\d)$/);
  const familyRaw = match ? match[1] : handle;
  const family = familyRaw
    .split(/[_-]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
  return {
    family: family || handle,
    weight: match ? Number(match[3]) * 100 : 400,
    style: match?.[2] === "i" ? "italic" : "normal",
  };
}

/** "poetsen_one_n4" -> "Poetsen One"; "harmonia_sans_n6" -> "Harmonia Sans Semibold". */
export function describeFontHandle(handle: string): string {
  const { family, weight, style } = parseFontHandle(handle);
  const styleLabel = style === "italic" ? "Italic" : "";
  return [family, WEIGHT_NAMES[weight] ?? "", styleLabel].filter(Boolean).join(" ") || handle;
}

/** Just the family name (no weight/style suffix) — for an optional CSS `font-family` preview
 *  hint. No `@font-face`/network loading: renders in this font only if it happens to already
 *  be installed, and falls back silently otherwise. */
export function fontFamilyName(handle: string): string {
  return parseFontHandle(handle).family;
}

function fontPickerIds(schemaGroups: SchemaGroup[]): string[] {
  const ids = new Set<string>();
  for (const group of schemaGroups) {
    for (const setting of group.settings ?? []) {
      if (setting.type === "font_picker" && setting.id) ids.add(setting.id);
    }
  }
  return [...ids];
}

function collectFrom(target: Set<string>, ids: string[], values: unknown): void {
  if (!values || typeof values !== "object") return;
  for (const id of ids) {
    const raw = (values as Record<string, unknown>)[id];
    if (typeof raw === "string" && raw) target.add(raw);
  }
}

/**
 * Every distinct font handle this theme actually ships: each font_picker setting's schema
 * default, plus every value it takes on across settings_data.json's `current` and `presets`.
 */
export function collectKnownFontHandles(
  schemaGroups: SchemaGroup[],
  settingsDataRaw: Record<string, unknown>,
): Set<string> {
  const ids = fontPickerIds(schemaGroups);
  const handles = new Set<string>();

  for (const group of schemaGroups) {
    for (const setting of group.settings ?? []) {
      if (setting.type === "font_picker" && typeof setting.default === "string") handles.add(setting.default);
    }
  }

  const current = settingsDataRaw.current;
  const presets = settingsDataRaw.presets as Record<string, unknown> | undefined;
  collectFrom(handles, ids, typeof current === "string" ? presets?.[current] : current);
  for (const preset of Object.values(presets ?? {})) collectFrom(handles, ids, preset);

  return handles;
}
