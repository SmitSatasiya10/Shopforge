import { PRESENTATIONAL_TYPES, ShopifySettingDef } from "@/lib/preview/section-schema";

// The Design panel's 7 categories, each backed by real groups/settings from the Base Theme's
// own config/settings_schema.json — no parallel/fake settings are invented here. Where a
// schema group mixes in settings that don't belong (e.g. Typography's RTL toggles), the
// category is curated to an explicit id allowlist instead of rendering the whole group.

export interface SchemaGroup {
  name?: string;
  settings?: ShopifySettingDef[];
}

export type DesignCategoryKey = "colors" | "typography" | "buttons" | "media" | "cards" | "icons" | "borderRadius";

export const DESIGN_CATEGORIES: { key: DesignCategoryKey; label: string }[] = [
  { key: "colors", label: "Colors" },
  { key: "typography", label: "Typography" },
  { key: "buttons", label: "Buttons" },
  { key: "media", label: "Images" },
  { key: "cards", label: "Cards" },
  { key: "icons", label: "Icons" },
  { key: "borderRadius", label: "Border Radius" },
];

/** One row the Design panel renders: a real setting, an optional subheading, and an optional
 *  label that overrides the schema's own (used only where the schema's own label is ambiguous,
 *  e.g. every "*_radius" setting resolves to the same "Corner radius" string). */
export interface DesignSettingRow {
  setting: ShopifySettingDef;
  sectionLabel?: string;
  labelOverride?: string;
}

/**
 * The Colors category's grouping/friendly-label layer — same 7 real ids as before, just
 * organized into visual sections and given merchant-friendly names instead of raw schema
 * labels ("colors_accent_1" -> "Primary"). The schema only has two accent-role colors
 * (colors_accent_1/2), so the palette group has two rows, not three — nothing invented to
 * round it out to a third "Accent" slot.
 */
const COLOR_GROUPS: { sectionLabel: string; ids: string[] }[] = [
  { sectionLabel: "Color Palette", ids: ["colors_accent_1", "colors_accent_2"] },
  { sectionLabel: "Background", ids: ["colors_background_1", "colors_background_2"] },
  { sectionLabel: "Text / Buttons", ids: ["colors_text", "colors_solid_button_labels", "colors_outline_button_labels"] },
];

const COLOR_FRIENDLY_LABELS: Record<string, string> = {
  colors_accent_1: "Primary",
  colors_accent_2: "Secondary",
  colors_text: "Text",
  colors_solid_button_labels: "Solid button label",
  colors_outline_button_labels: "Outline button labels",
  colors_background_1: "Background 1",
  colors_background_2: "Background 2",
};

/** The Typography category's two primary controls — everything else in TYPOGRAPHY_IDS below
 *  is scale/weight/custom-font detail, shown only under the panel's collapsed "Advanced". */
export const TYPOGRAPHY_PRIMARY_IDS = ["type_header_font", "type_body_font"];

const TYPOGRAPHY_IDS = [
  "type_header_font",
  "custom_header_font_link",
  "custom_header_font_name",
  "custom_header_italic_font_link",
  "heading_scale",
  "heading_line_height",
  "type_body_font",
  "custom_body_font_link",
  "custom_body_font_name",
  "custom_body_font_weight",
  "custom_body_bold_font_link",
  "custom_body_italic_font_link",
  "body_scale",
  "body_line_height",
  "body_letter_spacing",
];

/** Every "*_radius"/"*_corner_radius" setting across the whole schema, in a curated display
 *  order, with a friendly label — most of them share the literal schema label "Corner radius",
 *  so resolveSchemaLabel() alone would render 15 indistinguishable rows. */
const RADIUS_LABELS: Record<string, string> = {
  buttons_radius: "Buttons",
  badge_corner_radius: "Badges",
  slider_arrow_border_radius: "Slider arrows",
  pagination_dot_radius: "Pagination dots",
  swatches_border_radius: "Color swatches",
  variant_pills_radius: "Variant pills",
  pickers_radius: "Variant pickers",
  quantity_radius: "Quantity selector",
  inputs_radius: "Inputs",
  card_corner_radius: "Product cards",
  collection_card_corner_radius: "Collection cards",
  blog_card_corner_radius: "Blog cards",
  text_boxes_radius: "Content boxes",
  media_radius: "Media",
  popup_corner_radius: "Popups",
};

/** Same 15 real radius ids as RADIUS_LABELS, organized into visual groups — presentation only,
 *  no ids added, removed, or renamed. */
const RADIUS_GROUPS: { sectionLabel: string; ids: string[] }[] = [
  { sectionLabel: "Buttons", ids: ["buttons_radius"] },
  { sectionLabel: "Badges", ids: ["badge_corner_radius"] },
  {
    sectionLabel: "Controls",
    ids: [
      "slider_arrow_border_radius",
      "pagination_dot_radius",
      "swatches_border_radius",
      "variant_pills_radius",
      "pickers_radius",
      "quantity_radius",
      "inputs_radius",
    ],
  },
  {
    sectionLabel: "Cards",
    ids: ["card_corner_radius", "collection_card_corner_radius", "blog_card_corner_radius", "text_boxes_radius"],
  },
  { sectionLabel: "Media", ids: ["media_radius", "popup_corner_radius"] },
];

export interface StylePreset {
  key: string;
  label: string;
  /** Real config/settings_schema.json ids -> values, all within their declared min/max/step. */
  values: Record<string, number>;
}

/**
 * The Buttons category's "Styles" cards. config/settings_schema.json has no dedicated
 * "style/preset" field — no Classic/Brick/Bubble/Gradient/Soft/Ghost/Solid anywhere in it — and
 * two of the seven names a merchant might expect (Gradient, Ghost) need button capabilities
 * that don't exist in this theme AT ALL: no setting (global or otherwise) controls a gradient
 * fill or a solid/outline toggle for buttons (public/base-theme/assets/base.css's `.button`
 * only ever gets a flat `background-color`). Wiring those two to any existing setting would be
 * a no-op in the rendered store, so they're left out rather than faked.
 *
 * The other five are real: each is a curated bundle of the theme's own buttons_radius,
 * buttons_border_thickness/opacity, and buttons_shadow_* settings — genuinely rendered,
 * already-real values — applied together in one click/one undo step, the same way many editors
 * offer a "style preset" as a bundle of underlying values rather than a single stored token.
 */
export const BUTTON_STYLE_PRESETS: StylePreset[] = [
  {
    key: "classic",
    label: "Classic",
    values: {
      buttons_radius: 10,
      buttons_border_thickness: 1,
      buttons_border_opacity: 15,
      buttons_shadow_opacity: 0,
      buttons_shadow_horizontal_offset: 0,
      buttons_shadow_vertical_offset: 0,
      buttons_shadow_blur: 0,
    },
  },
  {
    key: "brick",
    label: "Brick",
    values: {
      buttons_radius: 0,
      buttons_border_thickness: 3,
      buttons_border_opacity: 100,
      buttons_shadow_opacity: 0,
      buttons_shadow_horizontal_offset: 0,
      buttons_shadow_vertical_offset: 0,
      buttons_shadow_blur: 0,
    },
  },
  {
    key: "bubble",
    label: "Bubble",
    values: {
      buttons_radius: 40,
      buttons_border_thickness: 0,
      buttons_border_opacity: 0,
      buttons_shadow_opacity: 20,
      buttons_shadow_horizontal_offset: 0,
      buttons_shadow_vertical_offset: 4,
      buttons_shadow_blur: 10,
    },
  },
  {
    key: "soft",
    label: "Soft",
    values: {
      buttons_radius: 20,
      buttons_border_thickness: 0,
      buttons_border_opacity: 0,
      buttons_shadow_opacity: 10,
      buttons_shadow_horizontal_offset: 0,
      buttons_shadow_vertical_offset: 2,
      buttons_shadow_blur: 15,
    },
  },
  {
    key: "solid",
    label: "Solid",
    values: {
      buttons_radius: 4,
      buttons_border_thickness: 0,
      buttons_border_opacity: 0,
      buttons_shadow_opacity: 0,
      buttons_shadow_horizontal_offset: 0,
      buttons_shadow_vertical_offset: 0,
      buttons_shadow_blur: 0,
    },
  },
];

/**
 * Design → Images → Styles. Unlike Buttons, every one of the theme's real Media settings
 * (media_border_thickness/opacity, media_radius, media_shadow_*) maps cleanly onto these six —
 * nothing in the reference (None/Brick/Light/Solid/Polaroid/Shadow) needs a capability the
 * schema doesn't have, so all six are real presets, not a partial set. Border color and shadow
 * color are the theme's existing --color-foreground/--color-shadow tokens (base.css), not
 * merchant-chosen per preset — only the real border/radius/shadow knobs vary.
 */
export const IMAGE_STYLE_PRESETS: StylePreset[] = [
  {
    key: "none",
    label: "None",
    values: {
      media_border_thickness: 0,
      media_border_opacity: 0,
      media_radius: 0,
      media_shadow_opacity: 0,
      media_shadow_horizontal_offset: 0,
      media_shadow_vertical_offset: 0,
      media_shadow_blur: 0,
    },
  },
  {
    key: "brick",
    label: "Brick",
    values: {
      media_border_thickness: 4,
      media_border_opacity: 100,
      media_radius: 0,
      media_shadow_opacity: 0,
      media_shadow_horizontal_offset: 0,
      media_shadow_vertical_offset: 0,
      media_shadow_blur: 0,
    },
  },
  {
    key: "light",
    label: "Light",
    values: {
      media_border_thickness: 1,
      media_border_opacity: 15,
      media_radius: 8,
      media_shadow_opacity: 10,
      media_shadow_horizontal_offset: 0,
      media_shadow_vertical_offset: 4,
      media_shadow_blur: 10,
    },
  },
  {
    key: "solid",
    label: "Solid",
    values: {
      media_border_thickness: 0,
      media_border_opacity: 0,
      media_radius: 4,
      media_shadow_opacity: 0,
      media_shadow_horizontal_offset: 0,
      media_shadow_vertical_offset: 0,
      media_shadow_blur: 0,
    },
  },
  {
    key: "polaroid",
    label: "Polaroid",
    values: {
      media_border_thickness: 16,
      media_border_opacity: 100,
      media_radius: 0,
      media_shadow_opacity: 10,
      media_shadow_horizontal_offset: 0,
      media_shadow_vertical_offset: 6,
      media_shadow_blur: 10,
    },
  },
  {
    key: "shadow",
    label: "Shadow",
    values: {
      media_border_thickness: 0,
      media_border_opacity: 0,
      media_radius: 8,
      media_shadow_opacity: 30,
      media_shadow_horizontal_offset: 0,
      media_shadow_vertical_offset: 14,
      media_shadow_blur: 25,
    },
  },
];

/**
 * Design → Cards → Styles. The schema does have a real "Style" setting (`card_style`:
 * standard/card — t:settings_schema.cards.settings.style.*), but only 2 values, not 4, and its
 * meaning (list-item vs. boxed layout) is a different concern from a border/shadow "look" — so
 * it isn't part of these presets. Default/Brick/Solid/Shadow instead bundle the theme's own
 * card_border_thickness/opacity, card_corner_radius, and card_shadow_* settings, the same real
 * geometry cluster Buttons and Images use. "Default" is literally the theme's own out-of-box
 * values. This is the Cards category's entire UI — no other Card settings are exposed here.
 */
export const CARD_STYLE_PRESETS: StylePreset[] = [
  {
    key: "default",
    label: "Default",
    values: {
      card_border_thickness: 0,
      card_border_opacity: 10,
      card_corner_radius: 12,
      card_shadow_opacity: 5,
      card_shadow_horizontal_offset: 10,
      card_shadow_vertical_offset: 10,
      card_shadow_blur: 35,
    },
  },
  {
    key: "brick",
    label: "Brick",
    values: {
      card_border_thickness: 3,
      card_border_opacity: 100,
      card_corner_radius: 0,
      card_shadow_opacity: 0,
      card_shadow_horizontal_offset: 0,
      card_shadow_vertical_offset: 0,
      card_shadow_blur: 0,
    },
  },
  {
    key: "solid",
    label: "Solid",
    values: {
      card_border_thickness: 0,
      card_border_opacity: 0,
      card_corner_radius: 4,
      card_shadow_opacity: 0,
      card_shadow_horizontal_offset: 0,
      card_shadow_vertical_offset: 0,
      card_shadow_blur: 0,
    },
  },
  {
    key: "shadow",
    label: "Shadow",
    values: {
      card_border_thickness: 0,
      card_border_opacity: 0,
      card_corner_radius: 12,
      card_shadow_opacity: 25,
      card_shadow_horizontal_offset: 0,
      card_shadow_vertical_offset: 14,
      card_shadow_blur: 30,
    },
  },
];

/** Which preset (if any) the current values already match — undefined means a custom
 *  combination, which is an honest state (no card shown as selected) rather than a bug. */
export function matchStylePreset(presets: StylePreset[], values: Record<string, unknown>): string | undefined {
  return presets.find((preset) =>
    Object.entries(preset.values).every(([id, expected]) => Number(values[id]) === expected),
  )?.key;
}

function findGroup(schemaGroups: SchemaGroup[], name: string): ShopifySettingDef[] {
  return schemaGroups.find((g) => g.name === name)?.settings ?? [];
}

function editableSettings(settings: ShopifySettingDef[]): ShopifySettingDef[] {
  return settings.filter((s) => s.id && !PRESENTATIONAL_TYPES.has(s.type));
}

function byIdAllowlist(settings: ShopifySettingDef[], ids: string[]): ShopifySettingDef[] {
  const byId = new Map(settings.filter((s) => s.id).map((s) => [s.id as string, s]));
  return ids.map((id) => byId.get(id)).filter((s): s is ShopifySettingDef => Boolean(s));
}

export function settingsForCategory(key: DesignCategoryKey, schemaGroups: SchemaGroup[]): DesignSettingRow[] {
  switch (key) {
    case "colors": {
      const settings = findGroup(schemaGroups, "t:settings_schema.colors.name");
      const byId = new Map(settings.filter((s) => s.id).map((s) => [s.id as string, s]));
      const rows: DesignSettingRow[] = [];
      for (const { sectionLabel, ids } of COLOR_GROUPS) {
        for (const id of ids) {
          const setting = byId.get(id);
          if (setting) rows.push({ setting, sectionLabel, labelOverride: COLOR_FRIENDLY_LABELS[id] });
        }
      }
      return rows;
    }

    case "typography":
      return byIdAllowlist(findGroup(schemaGroups, "t:settings_schema.typography.name"), TYPOGRAPHY_IDS).map(
        (setting) => ({ setting }),
      );

    case "buttons":
      return editableSettings(findGroup(schemaGroups, "t:settings_schema.buttons.name")).map((setting) => ({
        setting,
      }));

    case "media":
      return editableSettings(findGroup(schemaGroups, "t:settings_schema.media.name")).map((setting) => ({
        setting,
      }));

    case "cards":
      return [
        ...editableSettings(findGroup(schemaGroups, "t:settings_schema.cards.name")).map((setting) => ({
          setting,
          sectionLabel: "Product cards",
        })),
        ...editableSettings(findGroup(schemaGroups, "t:settings_schema.collection_cards.name")).map((setting) => ({
          setting,
          sectionLabel: "Collection cards",
        })),
        ...editableSettings(findGroup(schemaGroups, "t:settings_schema.blog_cards.name")).map((setting) => ({
          setting,
          sectionLabel: "Blog cards",
        })),
      ];

    case "icons":
      return editableSettings(findGroup(schemaGroups, "t:settings_schema.styles.name")).map((setting) => ({
        setting,
      }));

    case "borderRadius": {
      const all = schemaGroups.flatMap((g) => g.settings ?? []);
      const byId = new Map(all.filter((s) => s.id).map((s) => [s.id as string, s]));
      const rows: DesignSettingRow[] = [];
      for (const { sectionLabel, ids } of RADIUS_GROUPS) {
        for (const id of ids) {
          const setting = byId.get(id);
          if (setting) rows.push({ setting, sectionLabel, labelOverride: RADIUS_LABELS[id] });
        }
      }
      return rows;
    }
  }
}
