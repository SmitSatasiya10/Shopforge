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
}

export interface BlockSchema {
  id: string;
  label?: string;
  settings?: Record<string, unknown>;
  allowed_blocks?: string[];
  _image_generation?: { enabled?: boolean; field_name?: string };
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
 * The catalog as the model sees it. Settings are rendered as `id: type-or-allowed-values`
 * so the model can only produce values the section's schema accepts — the constraint that
 * makes generated JSON valid without a repair pass.
 */
export function describeCatalog(sections: SectionSchema[], blocks: BlockSchema[]): string {
  const describeSettings = (settings: Record<string, unknown> | undefined) => {
    if (!settings || Object.keys(settings).length === 0) return "    (no settings)";
    return Object.entries(settings)
      .map(([key, spec]) => {
        const value = Array.isArray(spec) ? `one of [${spec.join(" | ")}]` : String(spec);
        return `    ${key}: ${value}`;
      })
      .join("\n");
  };

  const blockById = new Map(blocks.map((b) => [b.id, b]));

  const sectionLines = sections.map((section) => {
    const head = `- ${section.id} — ${section.label}${section.purpose ? `: ${section.purpose}` : ""}`;
    const settings = describeSettings(section.settings);
    const allowed = section.allowed_blocks?.length
      ? section.allowed_blocks
          .map((id) => {
            const block = blockById.get(id);
            return `    * ${id}\n${describeSettings(block?.settings).replace(/^ {4}/gm, "        ")}`;
          })
          .join("\n")
      : "    (no blocks)";
    return `${head}\n  settings:\n${settings}\n  allowed blocks:\n${allowed}`;
  });

  return sectionLines.join("\n\n");
}
