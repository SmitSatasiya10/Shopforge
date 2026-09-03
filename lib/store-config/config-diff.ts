import { PAGE_TEMPLATES, PageTemplate, StoreConfiguration } from "./store";
import { ShopifySection, ShopifyTemplate } from "@/lib/preview/shopify-template";

// Structural diff between two Store Configurations, for the history panel's "what changed"
// view. Section-level granularity only — AI rewrites replace a whole section at a time
// (lib/store-config/template-ops.ts's replaceSection), so that's the level at which damage
// actually happens and at which "restore just this" is useful. Settings/blocks are still
// listed per changed section for context, but there's no per-setting restore action.

export type ConfigDiffEntry =
  | {
      scope: "section";
      kind: "added" | "removed" | "modified";
      page: PageTemplate;
      sectionId: string;
      label: string;
      changedSettings: string[];
      changedBlocks: string[];
    }
  | { scope: "order"; page: PageTemplate }
  | { scope: "theme"; kind: "added" | "removed" | "modified"; settingId: string; label: string }
  | { scope: "productTitle"; before: string | null; after: string | null };

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  if (aKeys.length !== Object.keys(bObj).length) return false;
  return aKeys.every((key) => key in bObj && deepEqual(aObj[key], bObj[key]));
}

/** "product_title" / "free-shipping-banner" -> "Product Title" / "Free Shipping Banner". */
export function humanizeId(id: string): string {
  return id
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function sectionLabel(section: ShopifySection): string {
  return section.name?.trim() || humanizeId(section.type);
}

/** Ids present in either record whose values differ (added, removed, or changed). */
function diffKeyedRecord(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const ids = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...ids].filter((id) => !deepEqual(before[id], after[id]));
}

function diffSectionsForPage(
  page: PageTemplate,
  current: ShopifyTemplate,
  checkpoint: ShopifyTemplate,
): ConfigDiffEntry[] {
  const entries: ConfigDiffEntry[] = [];
  const sectionIds = new Set([...Object.keys(current.sections), ...Object.keys(checkpoint.sections)]);

  for (const sectionId of sectionIds) {
    const currentSection = current.sections[sectionId];
    const checkpointSection = checkpoint.sections[sectionId];

    if (!currentSection && checkpointSection) {
      // Existed at the checkpoint, gone now — restoring brings it back.
      entries.push({
        scope: "section",
        kind: "removed",
        page,
        sectionId,
        label: sectionLabel(checkpointSection),
        changedSettings: [],
        changedBlocks: [],
      });
    } else if (currentSection && !checkpointSection) {
      // Didn't exist at the checkpoint — restoring removes it.
      entries.push({
        scope: "section",
        kind: "added",
        page,
        sectionId,
        label: sectionLabel(currentSection),
        changedSettings: [],
        changedBlocks: [],
      });
    } else if (currentSection && checkpointSection && !deepEqual(currentSection, checkpointSection)) {
      entries.push({
        scope: "section",
        kind: "modified",
        page,
        sectionId,
        label: sectionLabel(currentSection),
        changedSettings: diffKeyedRecord(currentSection.settings, checkpointSection.settings),
        changedBlocks: diffKeyedRecord(currentSection.blocks ?? {}, checkpointSection.blocks ?? {}),
      });
    }
  }

  const currentOrder = current.order ?? Object.keys(current.sections);
  const checkpointOrder = checkpoint.order ?? Object.keys(checkpoint.sections);
  // Only the relative order of sections present on both sides counts as a reorder — an
  // add/remove already shifts the raw arrays and is reported above instead.
  const sharedCurrentOrder = currentOrder.filter((id) => checkpointOrder.includes(id));
  const sharedCheckpointOrder = checkpointOrder.filter((id) => currentOrder.includes(id));
  if (!deepEqual(sharedCurrentOrder, sharedCheckpointOrder)) {
    entries.push({ scope: "order", page });
  }

  return entries;
}

export function diffConfigurations(
  current: StoreConfiguration,
  checkpoint: StoreConfiguration,
  currentProductTitle: string | null,
  checkpointProductTitle: string | null,
): ConfigDiffEntry[] {
  const entries: ConfigDiffEntry[] = PAGE_TEMPLATES.flatMap((page) =>
    diffSectionsForPage(page, current.templates[page], checkpoint.templates[page]),
  );

  for (const settingId of diffKeyedRecord(current.themeSettings, checkpoint.themeSettings)) {
    const inCurrent = settingId in current.themeSettings;
    const inCheckpoint = settingId in checkpoint.themeSettings;
    entries.push({
      scope: "theme",
      kind: !inCurrent ? "removed" : !inCheckpoint ? "added" : "modified",
      settingId,
      label: humanizeId(settingId),
    });
  }

  if (currentProductTitle !== checkpointProductTitle) {
    entries.push({ scope: "productTitle", before: currentProductTitle, after: checkpointProductTitle });
  }

  return entries;
}
