# 11 — AI Operation System

## 1. Purpose

This document defines the end-to-end pipeline that turns a natural-language merchant request into one or more `Operation`s applied to the `ThemeModel`, using the exact `Operation` schema defined in the architecture core (§3):

```
request → intent understanding → capability lookup (Manifest/Model) →
reuse-vs-generate decision → emit Operation(s) → Operation Plan (if multi-step) →
execution → validation handoff (doc 15) → diff (doc 14)
```

This is the system that makes Shopforge's core differentiator real: Dropmagic-style competitors regenerate a store from scratch; Shopforge looks at what the *actual* theme can already do and changes only what's needed — **Principle 1 (preserve the existing theme)**, **Principle 2 (reuse existing capabilities)**, **Principle 3 (minimal AI generation)**.

## 2. Pipeline overview

| Stage | Responsibility | Output |
|---|---|---|
| 1. Intent understanding | Classify what the user wants: which entity (section/template/global style), which attribute, which action | Structured intent object |
| 2. Capability lookup | Query the Theme Manifest/Model (context assembled per doc 12) for whether the target section/setting exists | Candidate `SettingDef`(s)/`sectionId`(s), or "not found" |
| 3. Reuse-vs-generate decision | Apply the decision rules in §4 | `requiresNewCode: true/false` per candidate operation |
| 4. Operation emission | Emit one or more `Operation` objects per architecture-core §3 | `Operation[]` |
| 5. Plan assembly (if multi-step) | Wrap ordered `Operation[]` with rationale + risk summary | `OperationPlan` |
| 6. Confirmation | User-facing checkpoint — see §7 | User approval / edit / rejection |
| 7. Execution | Apply approved `Operation`(s) to the `ThemeModel` via the same mutation path the visual editor uses (Principle 7) | Mutated `ThemeModel` |
| 8. Validation handoff | Every `Operation` and its resulting change is checked by the Validation Pipeline (doc 15) before it's considered final | Pass/fail + any auto-fix |
| 9. Diff | The Theme Model mutation produces a `Diff` (doc 14 owns the full schema) shown to the user and stored for undo | `Diff` |

Stages 1–3 happen inside the **Operation Planner**; stage 2 is executed against context assembled by the **Context Selector** (doc 12) — the Planner never receives the full Manifest, only the relevant slice.

## 3. Worked example A — simple, single-operation request

**User request:** *"make the hero section background dark blue"*

### 3.1 Intent understanding
The Planner (via a `fast`-tier structured-output call, doc 10 §4) extracts:

```
{
  targetHint: "hero section",
  attributeHint: "background color",
  actionHint: "set",
  valueHint: "dark blue"
}
```

### 3.2 Capability lookup
The Context Selector (doc 12) resolves `targetHint: "hero section"` against `ThemeManifest.capabilities.hasHeroSection` and the section capability index, returning the matching `SectionInstance` (from `ThemeModel.sections`) plus its `ThemeManifest.sections[].settings: [SettingDef]` list — nothing else from the theme is sent to the model.

The Planner finds within that section's `SettingDef` list:

```
{ id: "background_color", type: "color", label: "Background color", default: "#ffffff" }
```

### 3.3 Reuse-vs-generate decision
A `color`-typed `SettingDef` whose label semantically matches "background" exists → this is satisfiable with an existing capability. No new code needed. (Full rule set in §4.)

### 3.4 Value resolution
`"dark blue"` is not a hex value — the Planner resolves it to a concrete color (e.g. against a small fixed palette-naming table, or the model's own color-name knowledge) before emitting the operation. This resolution is itself a `fast`-tier call, not a separate user-facing step, because it's unambiguous enough to act on directly (see doc 13 outcome "execute immediately").

### 3.5 Operation emission

```json
{
  "opId": "op_8f2a...",
  "type": "update_setting",
  "target": {
    "templateKey": "index",
    "instanceId": "hero-1",
    "settingId": "background_color"
  },
  "payload": { "value": "#0B1F4D" },
  "requiresNewCode": false,
  "riskLevel": "safe",
  "estimatedCreditCost": 0
}
```

### 3.6 Plan assembly
Single-operation, `riskLevel: "safe"` requests skip full `OperationPlan` presentation — see §7, outcome "execute immediately." The Planner still logs the single `Operation` as a trivially-sized plan internally (an `OperationPlan` with one entry) for audit/undo consistency, but the UI does not force a confirmation screen.

### 3.7 Execution → validation → diff
The `Operation` is applied through the same `ThemeModel` mutation function the visual editor's inspector panel would call for an equivalent manual edit (Principle 7). Validation (doc 15) confirms `#0B1F4D` is a legal value for a `color` setting type. A `Diff` (doc 14) is produced:

```
{ kind: "modified", path: "sections.hero-1.settings.background_color", before: "#ffffff", after: "#0B1F4D", humanSummary: "Hero background changed from white to dark blue" }
```

## 4. Worked example B — complex, multi-step request

**User request:** *"create a premium product page with reviews, benefits, FAQ, upsells"*

### 4.1 Intent understanding
This does not map to one attribute change — it decomposes into multiple target entities, each independently resolvable against the Manifest:

```
{
  templateHint: "product",
  requestedCapabilities: ["reviews", "benefits/features list", "faq", "upsells/recommendations"],
  styleHint: "premium"
}
```

### 4.2 Capability lookup (per requested capability)
The Context Selector pulls `ThemeManifest.capabilities` plus the `product` template's current `sectionsUsed`/`sectionOrder`:

| Requested capability | Manifest signal checked | Result |
|---|---|---|
| Reviews | `capabilities.hasReviewsSection` | **Found** — theme has a `product-reviews` section, not currently used on `product` template |
| Benefits/features list | Section capability index + embedding match on section schema labels (doc 12) against "benefits", "features", "icons row" | **Found** — a generic `icon-columns` section matches semantically |
| FAQ | `capabilities.hasFaqSection` | **Found** — `faq-accordion` section exists in the theme, unused |
| Upsells | `capabilities.hasUpsellCapability` | **Not found** — theme has no upsell/cross-sell section and no app-block slot suited to it |
| "Premium" styling | N/A — not a capability lookup, a `GlobalStyles`/section-setting sweep (§4.4) | Partially satisfiable via existing settings |

### 4.3 Reuse-vs-generate decision (per capability)
Applying the rules in §5:

- Reviews, Benefits, FAQ → sections **already exist** in the theme but are **not placed** on the `product` template → `add_section` operations. Zero new code.
- Upsells → **no matching section type anywhere in the Manifest**, and no `isAppBlockCompatible` slot that could substitute → falls back to `create_section_file`. This is new code and gets `riskLevel: "review"`.
- "Premium" styling → resolved partly via `update_global_style`/`update_setting` (spacing, typography scale, button style — all present as `SettingDef`s or `GlobalStyles` fields) and partly by choosing more generous `PresetDef`s when adding the new sections, rather than any code change.

### 4.4 Operation Plan

```json
{
  "planId": "plan_c91e...",
  "themeVersionId": "tv_44a1...",
  "steps": [
    {
      "opId": "op_01",
      "type": "add_section",
      "target": { "templateKey": "product" },
      "payload": { "sectionType": "icon-columns", "presetName": "Benefits (3-up)", "position": "after:main-product" },
      "requiresNewCode": false,
      "riskLevel": "safe",
      "estimatedCreditCost": 0,
      "rationale": "Theme already has an icon-columns section usable as a benefits row; not currently placed on the product page."
    },
    {
      "opId": "op_02",
      "type": "add_section",
      "target": { "templateKey": "product" },
      "payload": { "sectionType": "product-reviews", "position": "after:op_01" },
      "requiresNewCode": false,
      "riskLevel": "safe",
      "estimatedCreditCost": 0,
      "rationale": "Theme ships a product-reviews section; adding it directly reuses existing review-app integration."
    },
    {
      "opId": "op_03",
      "type": "add_section",
      "target": { "templateKey": "product" },
      "payload": { "sectionType": "faq-accordion", "position": "after:op_02" },
      "requiresNewCode": false,
      "riskLevel": "safe",
      "estimatedCreditCost": 0,
      "rationale": "Theme includes an unused FAQ accordion section; content will need to be filled in but the section itself is native."
    },
    {
      "opId": "op_04",
      "type": "create_section_file",
      "target": { "templateKey": "product" },
      "payload": { "sectionType": "product-upsell", "liquidSource": "<generated>", "schema": "<generated>" },
      "requiresNewCode": true,
      "riskLevel": "review",
      "estimatedCreditCost": 42,
      "rationale": "No upsell/cross-sell section or compatible app block exists in this theme. Generating a new section scoped narrowly to upsell display."
    },
    {
      "opId": "op_05",
      "type": "update_global_style",
      "target": {},
      "payload": { "path": "spacing.sectionSpacing", "value": "loose" },
      "requiresNewCode": false,
      "riskLevel": "safe",
      "estimatedCreditCost": 0,
      "rationale": "Increases whitespace between sections to support the 'premium' feel without touching code."
    }
  ],
  "overallRiskSummary": "4 of 5 steps are zero-risk structural changes reusing existing theme sections. 1 step (op_04) generates a new section file for upsells, since the theme has no equivalent, and requires review before it's applied.",
  "totalEstimatedCreditCost": 42
}
```

### 4.5 Confirmation → execution → validation → diff
Because this plan mixes `safe` and `review`-risk steps and includes `requiresNewCode: true`, it is always shown to the user as a full plan before anything executes (§7 outcome "show proposed plan" → "require explicit confirmation" for `op_04` specifically). On approval, steps execute in order; `op_04`'s generated Liquid/schema goes through the Validation Pipeline (doc 15) before being accepted, and the whole plan produces one aggregate `Diff` with five `DiffEntry` records (doc 14).

## 5. Decision logic — does an existing setting/section satisfy this request?

This is the single most important piece of Shopforge's differentiation and deserves explicit rules, not vibes.

### 5.1 Attribute-level matching (does a `SettingDef` satisfy a requested change?)

Given a requested `(targetHint, attributeHint, valueHint)`, the Planner scores every `SettingDef` on the resolved section/theme-settings scope:

| Check | Rule |
|---|---|
| **Type compatibility** | The `SettingDef.type` must structurally accept the requested value class. A `color` request only matches `type: "color"`. A "make it bigger" request targeting spacing only matches `type: "range"`/`"number"` with plausible `min`/`max`. A "change the text" request only matches `type: "text"`/`"richtext"`/`"textarea"`/`"inline_richtext"`. |
| **Label semantics** | `SettingDef.label` (and `id` as a fallback signal) is compared against `attributeHint` via keyword match first, embedding similarity second (doc 12). "background" must match "Background color," "Backdrop colour," etc. above a similarity threshold — not merely any color-typed setting on the section. |
| **Options containment (enum settings)** | For `type: "select"`/`"radio"`, the requested value must map onto one of `SettingDef.options` (again via label semantics, not exact string match — "rounded corners" → an option literally labeled "Pill"). If no option is a plausible match, this setting does not satisfy the request even though type+label matched. |
| **Range plausibility** | For `type: "range"`/`"number"`, the requested qualitative value ("bigger", "a bit more spacing") must be resolvable to a value within `[min, max]` respecting `step`; if the current value is already at/near the bound in the requested direction, this does **not** silently satisfy the request — it's flagged for clarification (doc 13) since a purely-structural op wouldn't actually change anything meaningfully. |
| **Uniqueness** | If more than one `SettingDef` on the resolved scope clears the above thresholds with comparable confidence (e.g., a section with both `heading_color` and `background_color`, and the request just said "make it dark blue" without specifying which), this is an **ambiguous target** → clarification (doc 13), not a guess. |

If and only if exactly one `SettingDef` clears all applicable checks with high confidence: emit `update_setting`/`update_block_setting`/`update_theme_setting`/`update_global_style` — `requiresNewCode: false`, `riskLevel: "safe"`.

### 5.2 Section-level matching (does an existing section satisfy a requested capability?)

| Check | Rule |
|---|---|
| **Direct capability flag** | `ThemeManifest.capabilities.*` (e.g. `hasReviewsSection`, `hasFaqSection`) gives an O(1) yes/no for common capability requests. |
| **Section index / embedding match** | For capabilities without a dedicated flag (e.g. "benefits row"), match the requested capability's semantic description against `sectionId`/`schemaName`/block type labels across the Manifest's section index (doc 12's semantic search). |
| **Placement vs existence** | A section can *exist in the theme* (in `ThemeManifest.sections`) but not be *placed* on the relevant template (`sectionsUsed`). If it exists but isn't placed → `add_section` (still zero new code). If it's placed but hidden/disabled → prefer toggling `SectionInstance.disabled`/`visibility` over adding a duplicate. |
| **Block-level substitution** | If no matching section exists but the target section supports a `BlockDef` that covers the request (e.g., adding a "review" block type to a generic content section) → `add_block`, still zero new code. |
| **App-block slot** | If `isAppBlockCompatible: true` on a section and the requested capability is something normally satisfied by a Shopify app (e.g., real review collection/display), prefer flagging this as an app-integration question over generating bespoke code — generating a fake reviews UI with no real review data is explicitly the kind of thing Shopforge should avoid; see doc 13 "missing Shopify capability." |

### 5.3 Fallback to generative operations

Only once **5.1 and 5.2 both come back empty** — no setting, no existing section, no block, no app-block slot can satisfy the request — does the Planner fall back to a generative `OperationType`:

| Situation | Operation | Notes |
|---|---|---|
| Entirely new section needed | `create_section_file` | Always `riskLevel: "review"`, always costs credits, always validated (doc 15) before offer |
| Existing section's Liquid needs structural change beyond its schema (e.g. new nested markup, not just a setting) | `modify_liquid` | Same scrutiny level |
| Styling need exceeds what `GlobalStyles`/CSS custom properties can express | `modify_css` | Same scrutiny level |
| Interactive behavior not covered by theme's existing JS | `modify_js` | Same scrutiny level |

This ordering — always attempt 5.1, then 5.2, then only 5.3 — **is** Principle 2 (reuse existing capabilities) and Principle 3 (minimal AI generation) expressed as an algorithm, not a slogan.

## 6. Operation Plan structure (reference)

An `Operation Plan` — as defined in architecture core §3 — is:

```
OperationPlan {
  planId: string
  themeVersionId: string
  steps: [Operation & { rationale: string }]   // ordered
  overallRiskSummary: string
  totalEstimatedCreditCost: number
}
```

Plans are generated for **any** non-trivial request (Principle 5), where "non-trivial" is operationalized as: more than one `Operation`, OR any single `Operation` with `requiresNewCode: true`, OR any single `Operation` with `riskLevel` other than `"safe"`. A single safe structural operation (§3) is executed without a full plan screen, though it is still logged as a one-step plan for audit/undo symmetry.

## 7. Confirmation UX hook points

The Operation System exposes four distinct hook points the frontend/UX layer attaches to (full outcome logic lives in doc 13 — this is the mechanical wiring, not the decision rules):

| Hook point | Fires when | UI behavior |
|---|---|---|
| **Inline apply** | Single `Operation`, `riskLevel: "safe"`, `requiresNewCode: false` | Applied immediately; UI shows a lightweight toast/diff summary, undoable via standard undo (doc 14), no blocking confirmation |
| **Plan preview** | `OperationPlan` with ≥2 steps, all `riskLevel: "safe"`/`"review"` | Full plan rendered step-by-step (rationale per step, per §4.4 JSON shape) with an explicit "Apply plan" action; user can deselect individual steps before applying |
| **Explicit confirmation** | Any step with `riskLevel: "destructive"`, or `requiresNewCode: true` | That specific step is visually flagged (e.g. a warning affordance) and requires its own separate acknowledgment even within an otherwise-approved plan; a `ThemeSnapshot` is guaranteed to exist before execution (Principle 6) |
| **Post-generation review** | Any `requiresNewCode: true` step, after validation (doc 15) but before the diff is considered final | User sees the generated Liquid/CSS/JS diff explicitly (not just "a new section was added") before it's accepted into the `ThemeModel` |

`/ai/plan` produces the `OperationPlan` for hook points 2–4; `/ai/execute-plan` (both from architecture core §6 API surface) is the single entry point that actually applies approved steps, regardless of which hook point triggered approval.

## 8. Execution semantics

- Steps within an approved `OperationPlan` execute **in the declared order**, sequentially, because later steps may depend on earlier ones (e.g. `position: "after:op_01"` in §4.4).
- Execution is atomic per plan: if any step fails validation (doc 15) after the user has approved the plan, the entire plan's already-applied steps are rolled back (enabled by every `Diff` entry storing `before`, doc 14) and the user is shown what failed rather than left with a half-applied page.
- Every applied `Operation`, successful or rolled back, is persisted as a `ThemeOperation` (doc 17) — this is the audit trail and what undo/redo operates over.
- Execution always goes through the same `ThemeModel` mutation functions used by the visual editor (`/editor/*` endpoints) — there is no separate "AI write path" that bypasses model invariants (Principle 7).

## 9. Handoff to validation and diff (not owned by this document)

Every `Operation`'s effect on the `ThemeModel`, and especially every `requiresNewCode: true` operation's generated content, is checked by the Validation Pipeline before being considered final — see doc 15 for the full rule set (schema conformance, Liquid syntax validity, Shopify OS 2.0 compatibility, etc.). The resulting change is expressed as a `Diff` per architecture core §4 — see doc 14 for the full versioning/undo/snapshot model. This document's responsibility ends at "operation executed against the model and handed to validation."
