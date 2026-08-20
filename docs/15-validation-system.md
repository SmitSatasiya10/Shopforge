# 15. Validation System

Status: proposed design
Depends on: architecture-core §3 (Operation), §4 (Diff), doc 14 (Diff & Versioning)
Owned by: this doc is the canonical source of truth for the validation pipeline every `Operation`/`Diff` passes through before reaching real theme files.

---

## 1. Purpose and position in the pipeline

No `Operation` (architecture-core §3) — structural or generative — reaches the Theme Serializer (which writes real Liquid/JSON files and, on publish, calls the Shopify Admin API) without passing this pipeline. This is the enforcement mechanism behind Principle 6 (everything is reversible) and Principle 8 (Shopify compatibility first): reversibility is only meaningful if what gets applied was actually valid, and "the theme remains a valid Shopify theme at every step" is a claim this pipeline exists to make true rather than assumed.

```
   OperationPlan (Operation[])
          │
          ▼
   ┌────────────────────────────────────────────────────────────┐
   │  For each Operation, in plan order, against the tentative    │
   │  post-apply ThemeModel:                                       │
   │                                                                │
   │  1. Schema validation        (is the Operation well-formed)   │
   │  2. Theme-model validation   (is the resulting ThemeModel      │
   │                                structurally valid)             │
   │  3. Shopify validation       (will Admin API / theme rules     │
   │                                accept it)                       │
   │  4. Liquid syntax validation (only if requiresNewCode)         │
   │  5. JSON validation          (templates / settings_data)       │
   │  6. Asset-reference validation (no dangling refs)              │
   │  7. Runtime/rendering validation (render preview, check errors)│
   │  8. Responsive validation    (automatable subset + flag rest)  │
   │  9. Regression validation    (Diff entries stayed in scope)    │
   └───────────────────────────┬────────────────────────────────┘
                                │  any hard block anywhere → whole
                                │  plan transaction rolled back
                                │  (doc 14 §8: one plan = one transaction)
                                ▼
                     ValidationSummary { perLayer results, overall: "pass"|"warn"|"blocked" }
                                │
                     pass/warn ──────────────▶ commit transaction, produce Diff (doc 14)
                     blocked   ──────────────▶ Clarification / re-plan flow, NOT auto-retry
```

Layers run in the order above because each layer is cheaper and more decisive than the next — cheap structural checks (layers 1–2) fail fast before spending time/cost on layers that require actually rendering or calling out to Shopify (layers 3, 7). Layers 4–6 only run when relevant to the `Operation.type` (e.g. Liquid syntax validation is skipped entirely for `update_setting`, which never touches Liquid).

Every layer's result is recorded into `ValidationSummary` and persisted on the `ThemeOperation` record (doc 14 §4: `validationResult` field) — validation outcomes are themselves part of the permanent audit trail, not a transient check that's discarded once it passes.

---

## 2. Hard block vs. warning — the general rule

Two outcome classes recur at every layer:

- **Hard block**: the `Operation` cannot be applied. The transaction for the whole `OperationPlan` is rolled back (doc 14 §8 — no partial application). The user never sees a broken theme state as a result. The failure is routed back into the AI Clarification/Operation-Plan flow (doc 11/13), never silently retried.
- **Warning**: the `Operation` *can* be applied, but the system flags something the user should know before or after doing so — shown inline in the plan-review UI before execution, and/or attached to the `ThemeOperation`/`Diff` history entry afterward for anything that can only be checked post-apply (e.g. rendering/responsive checks that need the applied state to inspect).

The general dividing line used throughout this doc: **if applying the operation would leave the theme in a state that violates a Shopify-enforced constraint, breaks page rendering, or silently escapes the operation's declared scope, it's a hard block. If it's a quality/appearance concern that a human is better positioned to judge than an automated check, it's a warning.**

---

## 3. Layer 1 — Schema validation

**Question:** is the `Operation` itself well-formed, independent of theme content?

Checks:
- `Operation.type` is one of the defined `OperationType` values (architecture-core §3).
- `Operation.target` contains the fields required for that `type` (e.g. `update_block_setting` requires `instanceId` + `blockInstanceId` + `settingId`; `add_section` requires none of those but requires a valid `payload.sectionType`).
- `Operation.payload` matches the documented shape for `type` (e.g. `update_setting` payload has exactly `{ value }`; `modify_liquid` payload has exactly `{ file, unifiedDiff }`).
- `riskLevel` is one of `"safe"|"review"|"destructive"` and is internally consistent with `type` (e.g. `create_section_file`/`modify_liquid`/`modify_css`/`modify_js` must never be tagged `"safe"` — this is a schema-level cross-field invariant, not just a type check).
- `requiresNewCode` is `true` iff `type` is one of the four generative types — mismatches here are treated as a planner bug, not a user-facing warning.

**Hard block:** malformed `Operation` (missing required target field, unknown type, payload shape mismatch, risk/type mismatch). This should be rare in practice — it indicates a bug in the Operation Planner (doc 11), not a user-caused problem — so a schema validation failure logs at higher severity internally (paging/alerting territory) in addition to blocking, and surfaces to the user as a generic "couldn't build a safe plan for that request, please rephrase" rather than exposing internal schema details.

**Warning:** none at this layer — a malformed Operation has no partially-safe interpretation.

**Example — fail:** `Operation.type = "update_block_setting"` with `target = { instanceId: "hero-1", settingId: "background" }` (missing `blockInstanceId`) → hard block, "operation planner produced an incomplete target."

**Example — pass:** `Operation.type = "add_block"`, `target = { instanceId: "hero-1" }`, `payload = { blockType: "testimonial", position: 2 }` → well-formed, proceeds to layer 2.

---

## 4. Layer 2 — Theme-model validation

**Question:** applied against a tentative copy of the `ThemeModel` (architecture-core §2), does the result stay structurally valid per the Theme Manifest's (architecture-core §1) known constraints?

Checks:
- Every `SectionInstance` referenced by a `TemplateNode.sectionInstances`/`sectionGroups` actually exists in `ThemeModel.sections` (no orphaned reference left behind by `remove_section` forgetting to also update template ordering — this guards the Operation implementation itself, not just AI intent).
- Conversely, a section removal doesn't leave the section unreferenced-but-still-present in a way that silently orphans it forever (it should be fully removed or explicitly left as an unused-but-valid section, a deliberate choice surfaced to the user, not an accident).
- Block count for a `SectionInstance` after `add_block`/`duplicate_section` stays within `maxBlocks` from the corresponding `ThemeManifest.sections[].maxBlocks` — this is a Shopify-schema-declared limit (the section's own `schema.blocks` max), and exceeding it would produce a section that the Shopify theme editor itself would reject blocks into.
- `settingId` referenced by `update_setting`/`update_block_setting`/`update_theme_setting` actually exists in the relevant `SettingDef` list from the Manifest (no writing values for settings the section/theme schema doesn't declare).
- `blockType` referenced by `add_block` exists in the section's `BlockDef` list.
- `sectionType` referenced by `add_section` exists in `ThemeManifest.sections` (i.e. references a real section file) or, for `create_section_file`, does not collide with an existing `sectionId`.
- Enum/option-constrained settings (`SettingDef.options`) receive a value from the allowed option set; range-constrained settings (`min`/`max`/`step`) receive an in-range, step-aligned value.
- `move_section`/`reorder_block` target indices are within bounds of the resulting array.

**Hard block:** any of the above structural invariants would be violated — these are all cases where the resulting `ThemeModel` would itself be internally inconsistent, independent of whether Shopify would additionally reject it. E.g. exceeding `maxBlocks`, referencing a nonexistent `settingId`, or a dangling section reference.

**Warning:** none typically at this layer — structural invalidity at the model level is inherently a correctness bug, not a judgment call, so it blocks rather than warns.

**Example — fail:** section `hero-1`'s manifest declares `maxBlocks: 4`, it currently has 4 blocks, `Operation` is `add_block` targeting it → hard block, "hero-1 already has the maximum number of blocks (4) allowed by its schema."

**Example — pass:** `update_setting` targeting `settingId: "heading_size"` where the manifest's `SettingDef` is `{ id: "heading_size", type: "range", min: 12, max: 48, step: 2, default: 24 }` and the payload value is `28` → valid, in range, step-aligned.

---

## 5. Layer 3 — Shopify validation

**Question:** independent of our own model's internal consistency, will Shopify's own theme rules (theme check / Admin API) actually accept this?

This layer targets constraints Shopify enforces that aren't necessarily encoded in our Manifest — platform-level limits and rules such as: total section count per template limits (if any apply to the shop's plan/theme), asset file size/type limits, settings_data.json size limits, theme file count limits, reserved file name collisions, and Admin API — specific rejections (e.g. attempting to write to a locked/system template, permission scope issues from `ShopifyInstallation`).

Mechanically, this layer is implemented as a combination of:
- Static rule checks mirroring known Shopify platform limits (cheap, fast, run first).
- For anything not staticly knowable, a live low-cost Admin API dry-run/validation call where Shopify itself exposes one, before attempting the real write.

**Hard block:** Shopify would reject the write outright (file size over platform limit, invalid resource type, permission/scope denial, reserved-name collision).

**Warning:** Shopify would accept it but flags a deprecation or soft-limit concern (e.g. approaching a section count that's technically allowed but discouraged, use of a legacy schema field Shopify still accepts but recommends migrating away from).

**Example — fail:** `update_asset` payload swaps in a new image asset that's 45MB, over Shopify's per-asset size limit → hard block, "generated image exceeds Shopify's asset size limit; try a lower resolution."

**Example — pass:** `add_section` referencing a valid existing `sectionType`, no scope/permission issues on the connected `ShopifyInstallation` → proceeds.

---

## 6. Layer 4 — Liquid syntax validation

**Question:** for generative operations that produce or modify Liquid source (`create_section_file`, `modify_liquid`, and any snippet-touching payloads), is the resulting Liquid file syntactically valid, before it's ever uploaded?

Only runs when `Operation.requiresNewCode === true` and the operation's payload contains Liquid source (`create_section_file.payload.liquidSource`, or the file resulting from applying `modify_liquid.payload.unifiedDiff`).

Mechanism: run Shopify's own `theme-check` tooling (or an equivalent embedded Liquid parser/linter) against the resulting file **locally/server-side, pre-upload** — this is the concrete answer to "how do we check this pre-upload": we don't upload-and-see, we parse and lint with the same rule set Shopify's tooling uses, offline, as part of the validation pipeline, so a syntax error never reaches a real theme file or costs an Admin API round-trip to discover.

Checks: balanced `{% %}`/`{{ }}` tags, valid tag names and required arguments, valid filter names, no use of object/tag features outside the theme's declared Liquid feature set, schema `{% schema %}` block is itself valid JSON and conforms to the section-schema shape (settings/blocks/presets structure) — this sub-check overlaps with Layer 5 but is checked here first since a malformed schema block is really a Liquid-file-level syntax concern.

**Hard block:** any syntax error, unbalanced tag, unknown tag/filter, or malformed `{% schema %}` JSON. Generated code that fails this layer is never shown to the user as "applied" — see §11 for what happens next (bounded regeneration, not silent unlimited retry).

**Warning:** theme-check "style"/best-practice level findings that aren't hard errors (e.g. an unused variable, a slightly inefficient loop) — surfaced to the user as an FYI on generative operations but don't block.

**Example — fail:** `modify_liquid` payload's unified diff, when applied, produces `{% if section.settings.show_badge %}...{% endunless %}` (mismatched block tags) → hard block, theme-check reports "unclosed if tag" style error at the specific line.

**Example — pass:** generated section file parses cleanly, `{% schema %}` block is valid JSON matching the expected section-schema shape → proceeds to layer 5 for the schema JSON specifically, and layer 7 for actual render behavior.

---

## 7. Layer 5 — JSON validation

**Question:** do JSON-shaped artifacts — `templates/*.json`, `config/settings_data.json`, and a section's `{% schema %}` JSON block — conform to Shopify's expected schema for that file type?

Checks:
- `templates/*.json` conforms to Shopify's template JSON shape: valid `sections` object keyed by section id, valid `order` array whose entries all exist as keys in `sections`, valid `type` per section entry referencing a real section file.
- `config/settings_data.json` conforms to the theme's own `settings_schema.json` — every key in `current` matches a declared `SettingDef.id` from `ThemeManifest.themeSettings.schema`, value types match declared `SettingDef.type`.
- A section's `{% schema %}` JSON: valid `name`, `settings` array of well-formed `SettingDef`-shaped entries, `blocks` array of well-formed `BlockDef`-shaped entries (including valid `limit` if present), `presets` array of well-formed `PresetDef`-shaped entries whose `blocks[].type` values reference block types declared in the same schema.
- No duplicate setting `id`s within one schema, no duplicate block `type`s within one schema.

**Hard block:** any conformance failure above — these all produce a file Shopify's own editor or Admin API would reject or silently mis-render.

**Warning:** valid-but-questionable shapes, e.g. a preset referencing block settings that will fall back to block-level defaults rather than being wrong — technically valid, not necessarily what the AI intended, worth a note in the summary.

**Example — fail:** generated section's `{% schema %}` has a `blocks` array with two entries both `type: "testimonial"` → hard block, "duplicate block type 'testimonial' in section schema."

**Example — pass:** `templates/index.json`'s `order` array and `sections` object keys match exactly after an `add_section` operation → proceeds.

---

## 8. Layer 6 — Asset-reference validation

**Question:** does the resulting theme have any dangling reference — a Liquid/JSON file pointing at an asset, section, snippet, or block type that no longer exists?

Checks:
- Every `{{ 'file' | asset_url }}` / `asset_img_tag` style reference in touched Liquid resolves to an entry in `ThemeModel.assets` (or the underlying Manifest `assets` list for untouched files).
- Every `{% render 'snippet' %}` in touched Liquid resolves to an existing snippet file.
- Every `{% section 'x' %}`/section-group reference resolves to an existing section file.
- After `remove_section`, no `templates/*.json` still lists that section id in `sections`/`order` (cross-checks with layer 5, run here specifically for the removal-leaves-a-dangling-pointer case).
- After `update_asset` swaps an asset file, nothing else in the theme still references the *old* file path if the operation was a rename-style swap rather than an in-place content replace.
- `GeneratedAsset`/`Asset` (architecture-core §5) records referenced by `sourceGeneratedAssetId` on an `AssetRef` correspond to an asset that actually exists in storage.

**Hard block:** any dangling reference — this is precisely the class of bug that "theme still parses/uploads fine but breaks at render time or shows a broken image" comes from, so it's treated as strictly as a structural error.

**Warning:** none — a dangling reference has no acceptable "partial" outcome; it's either resolvable or it's a bug.

**Example — fail:** `remove_section` on `hero-1`, but `templates/index.json`'s `order` array still contains `"hero-1"` (operation implementation forgot to also touch the template) → hard block, caught before this ever reaches Shopify. Note: this exact case is also technically catchable at layer 2 (theme-model validation) since the `ThemeModel` itself would already reflect the dangling reference — asset-reference validation exists as a defense-in-depth second pass specifically because it runs against the *serialized files*, not just the in-memory model, catching serializer bugs that layer 2 (model-only) cannot see.

**Example — pass:** `create_section_file` references `{{ 'star-icon.svg' | asset_url }}` and `star-icon.svg` is included in the same operation's asset payload / already exists in `ThemeModel.assets` → proceeds.

---

## 9. Layer 7 — Runtime / rendering validation

**Question:** does the theme actually render without errors once the change is applied?

Mechanism: apply the tentative change to an isolated preview copy of the theme (a preview-token-scoped, unpublished rendering context — ties to the `/theme/*` preview-token surface in architecture-core §6), then request a render of every `TemplateNode` that the operation's `target` touches (and, for global changes like `update_global_style`/`update_theme_setting`, a representative sample across template types — home, product, collection, cart, at minimum) via Shopify's rendering (either a live unpublished-theme preview render or a local Liquid render engine matching Shopify's semantics), and inspect the response for:
- Liquid runtime errors (undefined method/filter applied to unexpected type, division by zero, infinite render loop guard trips) — these can exist even in syntactically valid Liquid (layer 4 only catches parse-time issues, not runtime type errors that only manifest with real data).
- HTTP-level render failure (500 from the render endpoint).
- Obviously broken output signals available cheaply: empty response body where content was expected, presence of Shopify's own error-boundary markup in the response.

**Hard block:** a render error or failure on any touched template. This is the layer that most concretely protects "generated output always remains a valid Shopify theme" — a theme that parses and uploads but throws on render is not actually a valid, usable theme in the sense the product promises.

**Warning:** render succeeds but produces console warnings (e.g. a JS asset warning surfaced during a headless render check) that don't prevent the page from working — logged, shown as an FYI, not blocking.

**Example — fail:** `modify_liquid` introduces `{{ product.metafields.custom.foo.value | upcase }}` where `foo` metafield is unset for the product used in preview, and the resulting nil-filter interaction throws → hard block if it's a genuine render-halting error (vs. Liquid's normal nil-tolerant behavior, which usually degrades gracefully — the check specifically looks for actual render failure, not just "value ended up blank").

**Example — pass:** preview render of the product template with the new hero background color returns 200 with expected markup present → proceeds.

---

## 10. Layer 8 — Responsive validation

**Question:** does the change break the mobile/tablet presentation?

This is the layer where automatable checks and required-human-review checks are explicitly split, because responsive/visual breakage is fundamentally a rendering-appearance judgment that current automated tooling can only partially make.

**What can be checked automatically (hard block or warning as noted):**
- `SectionInstance.visibility` (architecture-core §2) consistency — if an operation disables a section on `mobile` while it remains the *only* instance of critical content (e.g. the only nav/cart-access section) with no equivalent shown on mobile, flag structurally — **warning**, since "hide on mobile" can be intentional but is worth confirming.
- CSS output sanity checks against the theme's declared breakpoints: does a changed `GlobalStyles`/CSS custom property produce values that are structurally nonsensical at defined breakpoints (e.g. a container width setting change that would compute to a negative or zero value once combined with existing responsive CSS custom properties) — **hard block**, this is a computable structural failure, not a taste judgment.
- Automated multi-viewport preview capture: render the touched template(s) at defined breakpoint widths (mobile ~375px, tablet ~768px, desktop ~1440px, matching common Shopify theme breakpoints) as part of the same preview render from layer 7, and run basic automatable visual checks: horizontal overflow / content clipping detection (an element's bounding box exceeding the viewport width, which is mechanically detectable via the rendered DOM/CSSOM, not subjective) — **warning** (flagged for review, not blocked, since a detected overflow is sometimes intentional, e.g. an intentionally scrollable carousel).
- Text/element overlap detection at small viewport widths where computable from rendered box geometry — **warning**.

**What explicitly requires human/visual review (never auto-passed or auto-blocked):**
- Actual visual quality/aesthetics at each breakpoint (spacing feels right, image crops look good, font sizes read comfortably) — genuinely subjective, no automated check is claimed here.
- Whether a mobile-hidden section was *intentionally* hidden by the request vs. an unintended side effect — the automated check above can only flag the structural fact, not the intent.
- Any change delivered via `modify_css`/`modify_js` with responsive-media-query implications too complex for the structural checks above to model exhaustively.

Mechanically, layer 8's automated portion piggybacks on the same preview-render infrastructure as layer 7 (same render call, additional viewport widths and DOM-geometry checks against the same response), so it does not require a second round-trip.

**Hard block:** only the structurally-computable failure case above (CSS producing nonsensical/broken values at a breakpoint).

**Warning:** everything else in this layer — overflow/clipping detection, visibility-consistency flags, and a standing "review recommended" banner attached to the operation's history entry whenever the operation touched anything with responsive implications, prompting the user to check the live preview at mobile/tablet sizes themselves before publishing.

**Example — fail (hard block):** `update_global_style` sets `spacing.containerWidth` to a value that, combined with the theme's existing responsive padding custom properties, computes to a negative content width at the mobile breakpoint → hard block, "this container width produces an invalid (negative) content area on mobile."

**Example — warning:** preview render at 375px shows a newly added testimonial block's text bounding box extending 40px past the viewport edge → warning, "content may overflow on mobile — please review the preview," operation still allowed to apply.

---

## 11. Layer 9 — Regression validation (ties to the Diff system)

**Question:** can we prove that everything *outside* what this operation claimed to touch was actually left untouched?

This is the layer that most directly ties doc 14's `Diff` schema back into validation, and it is the system's core anti-regression guarantee.

Mechanism: every `Operation.target` declares its intended scope (architecture-core §3: `templateKey`/`instanceId`/`blockInstanceId`/`settingId`/`assetFile`). After the operation is tentatively applied and its `Diff` (doc 14 §2) is computed, **every `DiffEntry.path` in that Diff is checked against the declared target scope.** A path is in-scope if it is the target path itself, a sub-path of it (e.g. target `instanceId: "hero-1"` legitimately covers `sections.hero-1.settings.*` and, for structural ops like `add_section`/`remove_section`/`move_section`, the containing template's `sectionInstances` ordering array — this is an explicitly allow-listed side effect per `OperationType`, not an open-ended exception), or an explicitly declared secondary-effect path for that `OperationType` (documented per type — e.g. `remove_section` is allowed to also touch the template's section-group array).

**Any `DiffEntry` whose `path` falls outside the declared target scope and its allow-listed secondary effects is treated as a validation failure — a hard block.** This is stated explicitly per the design brief: it is not a warning, because an operation that changes something it didn't declare it would change is either an implementation bug in the operation/serializer, or (for generative operations) a sign the generated code has an unintended side effect (e.g. AI-modified Liquid accidentally alters a shared snippet used by other sections) — both cases must never reach a real theme file silently.

```
regressionCheck(operation, tentativeDiff):
  allowedPaths = scopeFor(operation.type, operation.target)   // target path + documented allow-listed secondary effects
  offendingEntries = tentativeDiff.entries.filter(e => !pathWithin(e.path, allowedPaths))
  if offendingEntries is empty:
    return PASS
  else:
    return BLOCK {
      reason: "operation modified paths outside its declared scope",
      offendingEntries,     // shown to the user/dev verbatim — this is diagnosable, not vague
      declaredTarget: operation.target
    }
```

For generative operations specifically, this is the layer most likely to catch the dangerous class of bug where an AI-modified `theme.liquid` or shared snippet edit, made in service of one section's requested change, incidentally alters markup rendered by unrelated sections — the exact "prove unrelated sections/settings were untouched" guarantee the product promises.

**Hard block:** any out-of-scope `DiffEntry`, always — no severity tiering within this layer, because there is no safe subset of "slightly out of scope."

**Warning:** none.

**Example — fail:** user asks the AI to "make the Add to Cart button rounder" → planned as `modify_css` scoped to `target: { assetFile: "assets/theme.css" }` with a narrow intended change to `.btn` border-radius, but the generated CSS diff also changes a `.card` class's border-radius used by the product grid → the resulting `Diff` includes a `DiffEntry` at a path effectively touching product-grid card rendering, which is outside the declared target's allow-listed scope → hard block, "this change affects the product grid card styling in addition to the button, which wasn't requested — please review or narrow the request."

**Example — pass:** `add_section` targeting `templateKey: "index"` produces a `Diff` with entries at `sections.<new-instance>` (the target itself) and `templates.index.sectionInstances` (the documented allow-listed secondary effect for `add_section`) — both in scope → passes.

---

## 12. Failure feedback into the Clarification / Operation-Plan flow

A validation hard block is never handled by silently regenerating and retrying without limit — this is stated explicitly per the design brief and is a direct application of Principle 4 (ask instead of guessing) and Principle 9 (cost-aware AI: unbounded regeneration burns AI credits with no guaranteed convergence).

```
On hard block at any layer:
  1. The failing Operation (and, per doc 14 §8, its whole OperationPlan transaction) is rolled back —
     nothing partial is ever left applied to the ThemeModel.
  2. ValidationSummary detail (which layer, which specific check, the offending entries/paths/messages)
     is attached to the OperationPlan record and made available to the Planner/Clarification logic
     (doc 11/13), NOT just logged for developers.
  3. Bounded regeneration for generative operations specifically:
     - The Planner is allowed ONE automatic re-generation attempt per failed generative Operation,
       informed by the specific validation failure detail (e.g. "the generated Liquid had an unclosed
       tag at line 12" fed back as context, not a bare "try again").
     - If the re-generation attempt ALSO fails validation, auto-retry stops. The system surfaces a
       Clarification to the user: what was attempted, why it failed in plain language, and options
       (rephrase the request narrower, proceed with a structural-only alternative if one exists, or
       cancel) — this is a hard cap, not a soft suggestion, precisely to satisfy Principle 9.
     - This retry budget (one automatic attempt) is a per-Operation counter tracked on the
       OperationPlan record, so a multi-step plan with two generative steps gets one retry budget
       EACH, not one shared across the whole plan.
  4. For structural operations (never requiresNewCode), there is no "regeneration" concept at all —
     a structural-operation validation failure always means the Planner chose an unsafe or
     out-of-bounds structural change (e.g. planned a setting value outside its declared range), which
     routes straight to re-planning against the corrected constraint (the Planner already has the
     Manifest's SettingDef bounds available — this should be self-correcting on replan without
     needing a user round-trip) rather than to user-facing Clarification, UNLESS the replanned
     alternative itself is ambiguous, in which case normal Clarification (doc 13) applies.
  5. Warnings (any layer) never block the transaction and never trigger regeneration — they are
     attached to the ValidationSummary and surfaced in the plan-review UI / history entry for the
     user's awareness, and the operation proceeds.
```

This distinction — one bounded automatic retry for generative failures, no retry loop at all, immediate user Clarification once the budget is spent — is the concrete mechanism that prevents the failure mode the design brief calls out: validation failure on a generative operation must never silently retry with more AI generation without limit.

---

## 13. Summary table

| Layer | Checks | Typical hard block | Typical warning |
|---|---|---|---|
| 1. Schema | Operation well-formed | Missing target field, unknown type | none |
| 2. Theme-model | ThemeModel stays structurally valid | Exceeds `maxBlocks`, dangling section ref, unknown `settingId` | none |
| 3. Shopify | Admin API / platform limits | Asset over size limit, permission denial | Deprecated field, soft limit approach |
| 4. Liquid syntax | Pre-upload parse via theme-check-equivalent | Unclosed tag, unknown filter, malformed `{% schema %}` | Style/best-practice lint findings |
| 5. JSON | template/settings_data/schema conformance | Dangling `order` entry, duplicate block type | Unused preset block reference |
| 6. Asset-reference | No dangling references | Removed section still listed in template | none |
| 7. Runtime/rendering | Actual render succeeds | Liquid runtime error, 500 on preview render | Non-fatal render warnings |
| 8. Responsive | Automatable subset only | Structurally negative/invalid computed width | Overflow/clipping detected, visibility flag |
| 9. Regression | Diff entries stay within declared target scope | Any out-of-scope `DiffEntry` | none |

All hard blocks roll back the entire `OperationPlan` transaction (doc 14 §8) and route to Clarification/re-plan with a bounded, per-operation single-retry budget for generative operations only (§12). All warnings are non-blocking, persisted on `ThemeOperation.validationResult`, and surfaced to the user for awareness at plan-review time and in AI operation history (doc 14 §4).
