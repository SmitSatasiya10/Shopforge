import { ShopifySettingDef } from "@/lib/preview/section-schema";

// Maps a bound text setting's schema onto the inline toolbar's typographic controls
// (docs/EDITOR-TOOLBARS.md). Everything is heuristic-by-id over the block's (or section's)
// own settings — a control renders only when the schema really has somewhere to write, so
// the toolbar can never invent a setting the Liquid doesn't read.

export interface SizeSetting {
  kind: "select" | "range";
  settingId: string;
  /** For selects: values in ascending visual size (schema order for this theme is h3→h0). */
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
}

export interface SizeControl extends SizeSetting {
  /**
   * The independent mobile-only size setting, when the schema declares one that really governs
   * the phone viewport on its own. Unlike alignment — one intent mirrored onto a second setting
   * — a size pair is two values the theme reads in *different* media queries:
   * `blocks/product_title.liquid` sizes its `<h1>` from `desktop_size`, then overrides that from
   * `mobile_size` under `max-width: 749px`. So while the preview is in mobile the desktop setting
   * is not the one on screen, and the toolbar has to write this one instead or the edit appears
   * to do nothing (see `sizeSettingFor`).
   */
  mobile?: SizeSetting;
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
/** Setting types that hold a section's own visible copy — used to find where one text field's settings end and the next one's begin (see `pick` below). */
const CONTENT_TYPES = new Set(["text", "textarea", "richtext", "inline_richtext"]);
/** The theme's canonical per-element text-color ids, matched exactly. */
const COLOR_IDS = new Set(["custom_color", "custom_text_color", "text_color", "color"]);
/**
 * The same idea one step wider: a theme names a sub-element's text color after the element it
 * paints (`content_text_color` for a tab panel's body, `tab_text_color` for its buttons).
 * Matching the shape rather than an exhaustive id list is what lets a block like `product_tabs`
 * — whose body copy is colored by `content_text_color` — offer a swatch at all; which of
 * several such colors belongs to the *selected* field is then settled by `pick` below.
 */
const TEXT_COLOR_ID = /_text_color$/;
/**
 * Decoration colors, which are never "the text color" however they are named: <strong>/<em>
 * treatments, highlighter marks, borders, dividers, active-state indicators. Checked before
 * the two matchers above so `bold_bg_text_color` cannot pass on its suffix alone.
 */
const DECORATION_COLOR_ID =
  /bold|italic|highlight|border|underline|strike|indicator|divider|shadow|hover|placeholder|_bg_/;
/**
 * Highlight colors applied to <strong>/<em> spans, which must track the picked text color.
 * The `_gradient` variants matter just as much as the solid ones: in gradient mode the
 * theme paints the text via `background: var(--hightlight-1--color)` + background-clip with
 * a TRANSPARENT text fill — the element's own `color` is invisible — and a flat hex is a
 * valid CSS background, so writing it there renders the picked color in that mode too.
 */
const COMPANION_COLOR_ID = /^title_highlight_\d+_(color|gradient)$|^(bold|italic)_(solid|gradient)_color$/;
const COMPANION_TYPES = new Set(["color", "color_background"]);

/**
 * Words that say what a setting *does* rather than which element it belongs to. Whatever is
 * left after these are removed is the setting's "qualifier" — the element it names.
 */
const GENERIC_TOKENS = new Set([
  "custom", "enable", "enabled", "show", "desktop", "mobile", "text", "texts", "color", "colour",
  "colors", "size", "sizes", "scale", "align", "alignment", "weight", "font", "style", "styles",
  "setting", "settings", "block", "section", "main", "value",
]);

/**
 * Words a theme uses interchangeably for the same element. Folding them together keeps a
 * section's `title` matched to its own `heading_size` — the pair the shared `section-title`
 * snippet actually renders — instead of treating "heading" as naming some other element.
 */
const SYNONYMS: Record<string, string> = { heading: "title", headline: "title", copy: "text" };

/**
 * Splits a setting id into comparable words: "tab_1_content" → ["tab", "content"]. Digits are
 * dropped (a repeated field's index says nothing about which element it is), plurals are folded
 * onto the singular — so `labels_desktop_text_size` still reads as belonging to `goal_1_label`,
 * the theme pluralising a setting shared by several numbered fields — and synonyms onto one
 * spelling.
 */
function tokens(id: string): string[] {
  return id
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .flatMap((part) => part.split(/(\d+)/))
    .filter((part) => part && !/^\d+$/.test(part))
    .map((part) => (part.length > 3 && part.endsWith("s") && !part.endsWith("ss") ? part.slice(0, -1) : part))
    .map((part) => SYNONYMS[part] ?? part);
}

/** The element a setting names: its tokens minus the ones that only describe the control. */
function qualifiers(id: string): string[] {
  return tokens(id).filter((token) => !GENERIC_TOKENS.has(token));
}

/**
 * How strongly a candidate setting's id claims to belong to the bound field. A field's
 * companion settings conventionally repeat the field's most specific word — `tab_1_content`
 * is served by `content_size` and `content_text_color`, not by `tab_text_size` — so the
 * owner's LAST qualifier counts double and its earlier ones count once.
 *
 * Scored over the owner's qualifiers rather than its raw tokens, so that a field whose name
 * merely ENDS in a generic word cannot be captured by the schema's most generic setting:
 * `caption_text` must keep pulling `caption_size`, not the block-wide `text_size` that shares
 * its trailing "text".
 */
function affinity(ownerQualifiers: string[], candidateId: string): number {
  if (!ownerQualifiers.length) return 0;
  const candidate = new Set(tokens(candidateId));
  let score = candidate.has(ownerQualifiers[ownerQualifiers.length - 1]) ? 2 : 0;
  for (const token of ownerQualifiers.slice(0, -1)) if (candidate.has(token)) score += 1;
  return score;
}

/**
 * Words naming a row of interactive controls — never the prose a merchant selects inline. A
 * setting qualified by one of these positions that row, so it must not be offered as the
 * alignment of body copy that merely sits near it (`product_tabs`' `button_alignment` moves the
 * tab BUTTON row). Deliberately tiny: unlike size and color, alignment in this theme is
 * overwhelmingly a *container* property — `vertical_items_align`, `icon_text_alignment`,
 * `content_text_alignment` are all named after a wrapper yet genuinely align the text inside
 * it, so rejecting every unshared qualifier here would strip ~147 working controls across the
 * base theme to fix one wrong one.
 */
const CONTROL_ROW_TOKENS = new Set(["button", "btn", "cta"]);

/**
 * Decides whether a candidate whose position does NOT vouch for it should still be rejected on
 * its name alone. Size and color settings are per-field by convention, so any unshared
 * qualifier disqualifies; alignment gets the narrow control-row rule above instead.
 */
type Guard = (candidateQualifiers: string[], owned: Set<string>) => boolean;

const REJECT_FOREIGN_QUALIFIER: Guard = (qualifiers, owned) => qualifiers.some((t) => !owned.has(t));
const REJECT_CONTROL_ROW: Guard = (qualifiers, owned) =>
  qualifiers.some((t) => CONTROL_ROW_TOKENS.has(t) && !owned.has(t));

interface Scope {
  settings: ShopifySettingDef[];
  /** Index of the bound field itself, or -1 when it is not a member of this settings list. */
  ownerIndex: number;
  /** Index of the next content field after the owner — where the owner's forward zone ends. */
  scopeEnd: number;
  /** Every word in the owner's id — what a candidate's qualifiers are checked against. */
  ownerTokens: string[];
  /** The owner's tokens with the generic control words removed — see `affinity`. */
  ownerQualifiers: string[];
}

/**
 * Resolves which setting a control should write to, out of every setting whose type and id
 * shape fit that control (docs/EDITOR-TOOLBARS.md).
 *
 * A section can hold more than one independently-bound text field (a heading plus a separate
 * eyebrow/kicker, say), each with its own size/align/color settings — so simply taking the
 * first match in schema order silently steers an edit on field A onto field B's setting. Two
 * signals separate them:
 *
 *   - **Position.** Schemas conventionally declare a field's companions directly after the
 *     field, so falling inside `[owner, next content field)` vouches for a candidate outright,
 *     whatever it is called — that is what keeps parallax-hero's `heading_prefix_size` bound to
 *     `heading_suffix`, which it really does style despite the "prefix" in its name.
 *   - **Naming.** Out of that zone, a candidate is kept only if every qualifier in its id is a
 *     word the owner's id also uses — so `content_size` still reaches `tab_1_content` from
 *     *above* its field, while `button_alignment` (the tab BUTTON row's alignment) is refused
 *     as the alignment of a tab's body copy. Among survivors, one that repeats the owner's own
 *     words wins over one that merely sits nearby.
 *
 * Position is a requirement for neither: requiring it would lose `content_size` and
 * `content_text_color` on `product_tabs`, which are declared *before* the `tab_1_content` field
 * they style; ignoring naming would let a lone far-away match bind to anything.
 *
 * With a single match whose naming raises no objection — the overwhelming majority of blocks,
 * which have exactly one text field — this returns exactly what a plain `.find()` would have.
 * When nothing survives it returns nothing rather than guessing: a missing control is
 * recoverable, a control that quietly edits a different field's setting is not.
 */
function pick<T extends ShopifySettingDef>(
  scope: Scope,
  predicate: (d: T) => boolean,
  reject: Guard = REJECT_FOREIGN_QUALIFIER,
): T | undefined {
  const settings = scope.settings as T[];
  const matches = settings.filter(predicate);
  // Nothing to compare against: a section-level binding, or a product-data pseudo-setting
  // (`__sf_product_title`) that is not a member of this settings list at all. The whole list
  // is then the field's zone, exactly as it was before owner-aware scoping existed.
  if (scope.ownerIndex < 0 || matches.length === 0) return matches[0];

  const owned = new Set(scope.ownerTokens);
  const viable = matches
    .map((d) => {
      const index = settings.indexOf(d);
      const own = qualifiers(d.id!);
      return {
        def: d,
        qualifiers: own,
        /** Element words the candidate names that the owner does not — lower is a better fit. */
        foreign: own.filter((token) => !owned.has(token)).length,
        distance: Math.abs(index - scope.ownerIndex),
        affinity: affinity(scope.ownerQualifiers, d.id!),
        inZone: index >= scope.ownerIndex && index < scope.scopeEnd,
      };
    })
    .filter((c) => c.inZone || !reject(c.qualifiers, owned));
  if (!viable.length) return undefined;

  // Position first: a setting declared under the field is the theme's own statement of intent,
  // and outranks a better-sounding name elsewhere (parallax-hero's `heading_prefix_size`, which
  // really does style `heading_suffix`). Within the same zone standing, prefer the candidate
  // that drags in no foreign element word — `heading_size` over `cards_desktop_title_size` for
  // a section's `title`, since "card" names the collection cards, not the section heading —
  // and only then the one that echoes the owner's own words most strongly.
  viable.sort(
    (a, b) =>
      Number(b.inZone) - Number(a.inZone) ||
      a.foreign - b.foreign ||
      b.affinity - a.affinity ||
      a.distance - b.distance,
  );
  return viable[0].def;
}

/** Which of the toolbar's two size shapes a schema setting has: a list of options, or a number. */
function sizeKind(def: ShopifySettingDef): "select" | "range" {
  return def.type === "select" ? "select" : "range";
}

/**
 * Whether a mobile-named size setting is the phone-side twin of the desktop one already chosen
 * — the pair a theme writes when the two viewports are sized independently (`desktop_size` /
 * `mobile_size`, `text_size` / `text_size_mobile`). Being in the same field's scope is not
 * enough on its own: `product_tabs` declares `tab_text_size_mobile` for its BUTTON labels and
 * nothing at all for a tab's body copy, so the body's `content_size` must not adopt it.
 *
 *   - Same element. Both ids must name the same thing once the words describing the control
 *     ("mobile", "size", …) are stripped — `tab` ≠ `content` above, while `cards_title_size`
 *     and `cards_mobile_title_size` agree.
 *   - Read the same way. A different KIND, or a different `visible_if`, means the theme reaches
 *     for the candidate under conditions that don't mirror this control: `blocks/heading.liquid`
 *     pairs an h0→h3 select with a `custom_mobile_size` NUMBER that applies only while
 *     `heading_size == "custom"`. In every other mode that select governs mobile as well (its
 *     classes are responsive in the theme's CSS), so the number is not its mobile half.
 */
function pairsWith(desktop: ShopifySettingDef, candidate: ShopifySettingDef): boolean {
  const element = (id: string) => qualifiers(id).slice().sort().join(" ");
  return (
    element(desktop.id!) === element(candidate.id!) &&
    sizeKind(desktop) === sizeKind(candidate) &&
    (desktop.visible_if ?? "") === (candidate.visible_if ?? "")
  );
}

/**
 * A matched size setting as the toolbar drives it. A select carrying no options is nothing the
 * −/+ can step through, so it yields no control at all rather than an inert one.
 */
function toSizeSetting(def: ShopifySettingDef | undefined): SizeSetting | undefined {
  if (!def) return undefined;
  if (def.type === "select") {
    // "custom" switches the block to freeform pixel settings — stepping skips it.
    const options = (def.options ?? []).map((o) => o.value).filter((v) => v !== "custom");
    return options.length ? { kind: "select", settingId: def.id!, options } : undefined;
  }
  return { kind: "range", settingId: def.id!, min: def.min ?? 8, max: def.max ?? 72, step: def.step ?? 1 };
}

export function findTextControls(defs: ShopifySettingDef[] | undefined, ownerId?: string): TextControls {
  const settings = (defs ?? []).filter((d) => d.id);
  const controls: TextControls = {};

  const ownerIndex = ownerId ? settings.findIndex((d) => d.id === ownerId) : -1;
  const nextFieldIndex =
    ownerIndex >= 0 ? settings.findIndex((d, i) => i > ownerIndex && CONTENT_TYPES.has(d.type)) : -1;
  const scope: Scope = {
    settings,
    ownerIndex,
    scopeEnd: nextFieldIndex >= 0 ? nextFieldIndex : settings.length,
    ownerTokens: ownerIndex >= 0 ? tokens(settings[ownerIndex].id!) : [],
    ownerQualifiers: ownerIndex >= 0 ? qualifiers(settings[ownerIndex].id!) : [],
  };

  // A select-type size setting (e.g. "custom" heading_size) and a range-type one (e.g. a
  // per-field font-size slider) are resolved as one combined pool, not two independent `pick()`
  // calls — otherwise a globally-unique select belonging to a *different* field (so it always
  // clears `pick()`'s own single-match shortcut) would unconditionally beat a range setting that
  // is genuinely in scope for the selected field, selects having been checked first.
  const isSize = (d: ShopifySettingDef) =>
    (d.type === "select" || d.type === "range" || d.type === "number") && SIZE_ID.test(d.id!);
  const sizeDef = pick(scope, (d) => isSize(d) && !MOBILE.test(d.id!));
  const size = toSizeSetting(sizeDef);
  if (sizeDef && size) {
    const mobile = toSizeSetting(pick(scope, (d) => MOBILE.test(d.id!) && isSize(d) && pairsWith(sizeDef, d)));
    controls.size = mobile ? { ...size, mobile } : size;
  }

  const weight = pick(scope, (d) => d.type === "select" && WEIGHT_ID.test(d.id!) && !!d.options?.length);
  if (weight) controls.weight = { settingId: weight.id!, options: weight.options!.map((o) => o.value) };

  const align = pick(
    scope,
    (d) => d.type === "select" && ALIGN_ID.test(d.id!) && !MOBILE.test(d.id!) && !!d.options?.length,
    REJECT_CONTROL_ROW,
  );
  if (align) {
    const mobile = pick(
      scope,
      (d) => d.type === "select" && ALIGN_ID.test(d.id!) && MOBILE.test(d.id!) && !!d.options?.length,
      REJECT_CONTROL_ROW,
    );
    controls.align = {
      settingId: align.id!,
      options: align.options!.map((o) => o.value),
      mobileId: mobile?.id,
      mobileOptions: mobile?.options?.map((o) => o.value),
    };
  }

  const color = pick(
    scope,
    (d) =>
      d.type === "color" &&
      !DECORATION_COLOR_ID.test(d.id!) &&
      (COLOR_IDS.has(d.id!) || TEXT_COLOR_ID.test(d.id!)),
  );
  if (color) {
    const enable = pick(scope, (d) => d.type === "checkbox" && /enable.*color/i.test(d.id!));
    const scopeStart = Math.max(ownerIndex, 0);
    const companions = settings
      .filter(
        (d, i) =>
          COMPANION_TYPES.has(d.type) && COMPANION_COLOR_ID.test(d.id!) && i >= scopeStart && i < scope.scopeEnd,
      )
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
 * The half of a size pair the previewed viewport actually renders. The −/+ has to read and write
 * whichever setting is on screen: in the mobile preview the theme's `max-width: 749px` rule wins,
 * so a step written to the desktop setting changes a declaration the media query is overriding and
 * the merchant sees nothing move (docs/EDITOR-TOOLBARS.md). Falls back to the desktop setting for
 * the many blocks that declare only one size — which then governs both viewports.
 */
export function sizeSettingFor(control: SizeControl, viewport: "desktop" | "mobile"): SizeSetting {
  return viewport === "mobile" && control.mobile ? control.mobile : control;
}

/**
 * Friendly display label for the toolbar's size control. For a `select`, schema options are
 * already documented as ascending visual size (see `SizeControl.options`), so position maps
 * directly onto the scale — this theme's actual heading-size options (Extra small/Small/
 * Medium/Large) land on exactly XS/S/M/L. For a `range`, there's no discrete step a theme
 * names, so the continuous min..max domain is bucketed into the same scale by where the
 * value falls. Falls back to the raw stored value when it can't be placed (unset, or more
 * discrete options than the scale covers).
 */
export function sizeLabel(control: SizeSetting, currentValue: unknown): string {
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
  control: SizeSetting,
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
