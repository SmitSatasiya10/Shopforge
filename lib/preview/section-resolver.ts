import { getSectionDefinition } from "@/lib/sections/registry";
import { SectionDefinition } from "@/lib/store-config/types";

/** SectionInstance.type -> SectionDefinition, a direct catalog lookup — unresolved type is a validation failure, never a silent skip. */
export function resolveSectionDefinition(type: string): SectionDefinition {
  const def = getSectionDefinition(type);
  if (!def) throw new Error(`Unknown section type: "${type}" is not in the Section Library.`);
  return def;
}

/** Instance settings win; anything absent falls back to the section's schema default (Shopify semantics). */
export function mergeSettingsWithDefaults(
  def: SectionDefinition,
  instanceSettings: Record<string, string | boolean>,
): Record<string, string | boolean> {
  const merged: Record<string, string | boolean> = {};
  for (const setting of def.settings) {
    merged[setting.id] = instanceSettings[setting.id] ?? setting.default ?? "";
  }
  return merged;
}
