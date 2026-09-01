// Shopify's schema format has no dedicated "icon" setting type — every icon setting in this
// theme is a plain `text` setting whose value is a Material Symbols ligature name, following a
// naming convention (`icon`, or `icon_1`, `icon_2`, ...) rather than a declared type. Detection
// is therefore by id, not by `setting.type`.

const ICON_SETTING_ID = /^icon(?:_\d+)?$/;

/** True for `icon`, `icon_1`, `icon_12`, ... — false for unrelated ids like `collapse_icon` (a
 *  fixed carret/plus `select`, not a Material Symbols name) or `custom_icon` (an image override). */
export function isIconSettingId(id: string): boolean {
  return ICON_SETTING_ID.test(id);
}

/** "icon" -> "filled_icon", "icon_2" -> "filled_icon_2". A best-effort default for the
 *  Inspector's filled-aware glyph preview only — never written to, so an occasional miss (e.g.
 *  icon-with-text.liquid's actual companion is `icon_N_fill`) is harmless. */
export function filledIconSettingId(iconSettingId: string): string {
  return iconSettingId === "icon" ? "filled_icon" : `filled_${iconSettingId}`;
}
