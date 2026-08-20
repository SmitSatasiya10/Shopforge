# DOM Metadata and Selection

How a rendered DOM element inside the [preview iframe](08-preview-iframe.md) maps back to a precise
[Store Configuration](03-store-configuration.md) path, and how hover and click selection resolve that mapping.

```
DOM Element
    |
data-sf-section / data-sf-block / data-sf-setting
    |
Section / Block / Setting
    |
Store Configuration
```

## 1. The `data-sf-*` attribute contract (Decided/Final)

Every rendered element the editor can select or edit carries one or more `data-sf-*` attributes. This
contract — the attribute names, where each is emitted, and what it maps to — is finalized:

| Attribute | Where it's emitted | Maps to |
|---|---|---|
| `data-sf-page` | Root wrapper of the rendered page (once per page) | `pages.{key}` — which page the click occurred within |
| `data-sf-section-id` | Root element of each rendered Section instance | `SectionInstance.id` |
| `data-sf-section-type` | Same element as `data-sf-section-id` | `SectionInstance.type` — which contract/inspector layout to use, without a lookup |
| `data-sf-block-id` | Root element of each rendered block instance (e.g. each testimonial card, each FAQ item) | `BlockInstance.id` |
| `data-sf-setting` | The specific DOM node rendering one editable field's value | `SettingDef.id` — the field-level click target |
| `data-sf-editable` | Same element as `data-sf-setting` | One of `text \| richtext \| image \| none` — which in-preview interaction applies, if any (see [contentEditable](11-contenteditable.md)) |

This is the current, complete attribute set the Section Library implements against for MVP. It is expected to
extend — new attributes for new interaction types — as the Section Library and editor grow, but the six
attributes above, their placement, and their meaning are not open questions.

## 2. Emission responsibility

`data-sf-*` attributes are emitted by each Section's own Liquid template, as part of authoring that Section —
they are not injected by the Preview Renderer after the fact, and not derived by inspecting rendered output.
A Section's Liquid is reviewed for correct `data-sf-*` emission the same way any other part of the Section is
reviewed. A Section that omits a required attribute is an authoring/QA defect in that Section, not a runtime
condition the editor needs to special-case.

## 3. Selection resolution: click

```
click on a DOM node
        |
        v
walk up from the clicked node to the nearest ancestor carrying:
  data-sf-setting        (field-level)      -- checked first
  else data-sf-block-id  (block-level)
  else data-sf-section-id (section-level)
        |
        v
map to Page -> Section id -> Block id -> Setting id
        |
        v
Inspector opens scoped to exactly that target
```

Resolution always walks **up** the DOM tree from the clicked node and takes the nearest match at each level. A
click directly on a heading resolves to that heading's `data-sf-setting` — field-level, and the Inspector opens
pre-scrolled to that field. A click on section whitespace with no `data-sf-setting` or `data-sf-block-id`
ancestor resolves only to `data-sf-section-id` — section-level, and the Inspector opens on that instance's
general tab.

### 3.1 Worked example

Rendered markup for a `hero` instance:

```html
<section class="hero" data-sf-section-id="sec_a1" data-sf-section-type="hero">
  <h1 data-sf-setting="heading" data-sf-editable="text">Everyday Carry, Elevated</h1>
  <p data-sf-setting="subheading" data-sf-editable="richtext">...</p>
  <a data-sf-setting="cta_label" href="/collections/all">Shop the Collection</a>
</section>
```

- Clicking the `<h1>` resolves to `data-sf-setting="heading"` — field-level selection of `sec_a1`'s `heading`
  setting.
- Clicking the `<a>` resolves to `data-sf-setting="cta_label"` — field-level, even though the element also has
  an `href`.
- Clicking blank space inside `<section>` but outside any child with `data-sf-setting` resolves to
  `data-sf-section-id="sec_a1"` — section-level.

## 4. Hover detection

Hovering over a rendered element draws an outline around the nearest `data-sf-*` ancestor, using the same
walk-up resolution as click (§3). This outline is a visual affordance only — editor chrome drawn by React,
positioned by reading the hovered element's bounding box via same-origin DOM access (see
[Preview iframe](08-preview-iframe.md) §2, §4). It does not itself select anything; only a click commits a
selection.

## 5. Selection state

A committed selection is one of exactly three levels — section, block, or field — resolved to:

```
Page -> Section id -> Block id (if applicable) -> Setting id (if applicable)
```

The Inspector reflects whichever level was resolved: a section-level selection opens the instance's general
settings, a block-level selection opens that block's fields, and a field-level selection opens the Inspector
pre-scrolled and focused on that one field.

## 6. Nested elements

Blocks nest inside Sections, and Setting-level nodes nest inside Blocks — the walk-up algorithm in §3 is what
lets a single click target resolve unambiguously to the *most specific* applicable level in the common case
(a field inside a block inside a section resolves to the field, not the block or section). This works cleanly
when each level's `data-sf-*` boundary is well-formed and non-overlapping.

## 7. Open Questions / TBD

| Item | Status | Blocking |
|---|---|---|
| Overlapping/ambiguous click-target disambiguation | Decision Required | A block nested inside another block-like structure, or a setting rendered inside a loop where the same `data-sf-setting` value legitimately appears more than once in the DOM (e.g. a price shown both in a gallery thumbnail overlay and in the main info panel), needs a precise disambiguation rule beyond "nearest ancestor." Not resolved. |
| Keyboard-accessible selection | Needs Investigation | The hover/click flow in §3–§4 is mouse-first; no keyboard-navigable equivalent for selecting a section, block, or field is specified. |
| Invalid/stale metadata beyond an authoring defect (§2) | Not addressed | Behavior when previously-valid `data-sf-*` metadata no longer matches the current `Store Configuration` (e.g. mid-rerender) is not specified beyond "rerender replaces the DOM wholesale" (see [Preview iframe](08-preview-iframe.md) §8). |
