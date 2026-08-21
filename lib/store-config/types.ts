// Shared Settings Contract shapes (docs/product-spec/12-shared-section-contract.md),
// narrowed to what the prototype's 6 sections need — no `content_for 'blocks'` support,
// no PresetDef (sections aren't user-addable yet), no font_picker/collection/blog/page pickers.

export type SettingType =
  | "text"
  | "richtext"
  | "textarea"
  | "image_picker"
  | "color"
  | "url"
  | "checkbox";

export interface SettingDef {
  id: string;
  type: SettingType;
  label: string;
  default?: string | boolean;
}

export interface SectionDefinition {
  type: string;
  name: string;
  liquidPath: string; // path under /base-theme, e.g. "sections/header.liquid"
  settings: SettingDef[];
}

// Store Configuration shape (docs/product-spec/03-store-configuration.md §SectionInstance),
// narrowed: no blocks/visibility/disabled — none of the 6 prototype sections use blocks.
export interface SectionInstance {
  id: string;
  type: string;
  settings: Record<string, string | boolean>;
}

export interface PageConfig {
  pageType: "product";
  sections: SectionInstance[];
}

export interface StoreConfiguration {
  version: 1;
  pages: {
    product: PageConfig;
  };
}
