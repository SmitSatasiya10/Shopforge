import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

// The curated capability catalog the AI is allowed to choose from. It is deliberately a
// narrower list than the theme's 86 sections: the model picks only from sections whose
// schema has been reviewed and whose settings are described, which is what keeps generated
// output renderable (docs/product-spec/02-base-theme-and-section-library.md §2).

export interface SectionSchema {
  id: string;
  label: string;
  purpose?: string;
  category?: string;
  tags?: string[];
  allowed_on?: string[];
  settings?: Record<string, unknown>;
  allowed_blocks?: string[];
  max_blocks?: number;
  /** Marks which setting on this section (or its blocks) holds a generatable image. */
  _image_generation?: { enabled?: boolean; field_name?: string; prompt?: string };
  /**
   * Curated authoring guidance (typical block order, essential vs. optional blocks, naming
   * gotchas) written by whoever reviewed this section into the catalog. Present on most
   * sections/blocks but, until this was wired into describeSectionBody, never actually reached
   * the model — surfacing it is what pushes generation toward the richer, more consistent
   * block sets these notes already describe instead of leaving it to chance.
   */
  _notes?: string;
}

export interface BlockSchema {
  id: string;
  label?: string;
  settings?: Record<string, unknown>;
  allowed_blocks?: string[];
  _image_generation?: { enabled?: boolean; field_name?: string };
  /** See SectionSchema._notes — the same curated guidance, at the block level. */
  _notes?: string;
}

const CATALOG_ROOT = path.join(process.cwd(), "lib", "ai", "catalog");

async function loadDir<T>(dir: string): Promise<T[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  return Promise.all(
    files.map(async (file) => JSON.parse(await readFile(path.join(dir, file), "utf-8")) as T),
  );
}

let cached: { sections: SectionSchema[]; blocks: BlockSchema[] } | null = null;

export async function loadCatalog() {
  if (!cached) {
    const [sections, blocks] = await Promise.all([
      loadDir<SectionSchema>(path.join(CATALOG_ROOT, "sections")),
      loadDir<BlockSchema>(path.join(CATALOG_ROOT, "blocks")),
    ]);
    cached = { sections, blocks };
  }
  return cached;
}

/** Sections allowed on a given Shopify template (`index`, `product`, ...). */
export function sectionsForTemplate(sections: SectionSchema[], template: string): SectionSchema[] {
  return sections.filter((s) => !s.allowed_on || s.allowed_on.includes(template));
}

/**
 * Renders one setting's spec for the model. A catalog file writes a setting as either a bare
 * type string ("text"), a list of allowed values (["a", "b"]), or an object carrying more
 * detail ({ type: "range", min: 0, max: 50, default: 10 }) — the third form must be unpacked
 * field-by-field here, since `String(anObject)` silently collapses it to the useless literal
 * "[object Object]" and the model would see that string as if it were the actual value.
 */
function describeSpec(spec: unknown): string {
  if (Array.isArray(spec)) return `one of [${spec.join(" | ")}]`;
  if (spec && typeof spec === "object") {
    const { type, default: def, min, max, ...rest } = spec as Record<string, unknown>;
    const parts = [typeof type === "string" ? type : "unknown"];
    if (min !== undefined || max !== undefined) parts.push(`range ${min ?? "?"}-${max ?? "?"}`);
    for (const [k, v] of Object.entries(rest)) parts.push(`${k}: ${JSON.stringify(v)}`);
    if (def !== undefined) parts.push(`default: ${JSON.stringify(def)}`);
    return parts.join(", ");
  }
  return String(spec);
}

function describeSettings(settings: Record<string, unknown> | undefined): string {
  if (!settings || Object.keys(settings).length === 0) return "    (no settings)";
  return Object.entries(settings)
    .map(([key, spec]) => `    ${key}: ${describeSpec(spec)}`)
    .join("\n");
}

/**
 * Renders one section's settings and allowed blocks — the part of a catalog entry shared by
 * `describeCatalog` (a browsable menu) and `describeFixedSections` (a fixed list of ids to
 * fill), so the two prompt shapes never drift on how a section's shape is described. Includes
 * each block's own `_notes` (e.g. "typical order: ... essential blocks: ...") right under it,
 * since that's exactly the guidance that should shape which blocks the model reaches for.
 */
export function describeSectionBody(
  schema: Pick<SectionSchema, "settings" | "allowed_blocks" | "_notes">,
  blocks: BlockSchema[],
): string {
  const blockById = new Map(blocks.map((b) => [b.id, b]));
  const settings = describeSettings(schema.settings);
  const allowed = schema.allowed_blocks?.length
    ? schema.allowed_blocks
        .map((id) => {
          const block = blockById.get(id);
          const notes = block?._notes ? `\n        note: ${block._notes}` : "";
          return `    * ${id}\n${describeSettings(block?.settings).replace(/^ {4}/gm, "        ")}${notes}`;
        })
        .join("\n")
    : "    (no blocks)";
  const notes = schema._notes ? `\n  note: ${schema._notes}` : "";
  return `  settings:\n${settings}\n  allowed blocks:\n${allowed}${notes}`;
}

/**
 * The catalog as the model sees it. Settings are rendered as `id: type-or-allowed-values`
 * so the model can only produce values the section's schema accepts — the constraint that
 * makes generated JSON valid without a repair pass.
 */
export function describeCatalog(sections: SectionSchema[], blocks: BlockSchema[]): string {
  return sections
    .map((section) => {
      const head = `- ${section.id} — ${section.label}${section.purpose ? `: ${section.purpose}` : ""}`;
      return `${head}\n${describeSectionBody(section, blocks)}`;
    })
    .join("\n\n");
}
