# 14. Diff & Versioning System

Status: proposed design
Depends on: architecture-core §3 (Operation), §4 (Diff), §5 (DB entities)
Owned by: this doc is the canonical source of truth for the Diff schema's full field docs and for all undo/redo, history, snapshot, restore, revert, and compare semantics. Other docs reference this one; they do not redefine these terms.

---

## 1. Purpose

Shopforge's core promise is that every AI or editor change is **safe, traceable, and reversible**, and that the theme remains a **valid Shopify theme** at every step. This document specifies the mechanism that makes that promise real:

- Every mutation to a `ThemeModel` (Principle 7: visual editor and AI use the same model, the same mutation path) produces a `Diff`.
- Diffs are the atomic unit of history. They are reversible by construction — every `DiffEntry` carries enough information to undo itself.
- `ThemeSnapshot`s are periodic full-tree backups that bound how far a Diff-by-Diff replay ever has to reach back.
- `ThemeOperation` records (the persisted form of `Operation`, architecture-core §3) give AI history a queryable, per-`ThemeVersion` audit trail independent of the Diff stack.

Everything below builds on the canonical `Diff` / `DiffEntry` shape from architecture-core §4. That shape is not changed here — it is expanded with full field semantics and worked examples.

---

## 2. The Diff schema, in full

```
Diff {
  diffId: string
  themeVersionId: string
  causedBy: { type: "ai_operation"|"editor_edit", operationId?: string, userId?: string }
  entries: [DiffEntry]
  createdAt: timestamp
}

DiffEntry {
  kind: "added" | "removed" | "modified" | "moved" | "renamed"
  path: string            // model path, e.g. "sections.hero-1.settings.background"
  before?: any
  after?: any
  humanSummary: string    // "hero background changed from #ffffff to #111827"
}
```

### 2.1 Field-by-field semantics

**`Diff.diffId`**
Globally unique, monotonically sortable within a `themeVersionId` (e.g. ULID/KSUID, not a bare auto-increment, so ordering survives distributed writers). This is the primary key used everywhere a diff needs to be addressed individually: undo stack entries, revert targets, compare-versions inputs.

**`Diff.themeVersionId`**
Every Diff belongs to exactly one `ThemeVersion` (the working copy being edited). A Diff never spans two `ThemeVersion`s. When a `ThemeVersion` is forked (e.g. "try this on a duplicate"), its Diff history starts fresh, anchored at the source snapshot — see §5.

**`Diff.causedBy`**
The provenance envelope. Exactly one of two shapes:
- `{ type: "ai_operation", operationId }` — this Diff resulted from executing one `ThemeOperation`. `operationId` is a foreign key to the persisted `ThemeOperation` (architecture-core §5), which is how AI Operation History (§4 below) and Diff history cross-reference.
- `{ type: "editor_edit", userId }` — this Diff resulted from a direct visual-editor mutation (drag/drop, inspector field change) with no `ThemeOperation` behind it.

This field is what lets the UI render "AI changed this" vs "you changed this" without a separate lookup, and is what the revert-conflict logic (§7) uses to decide whose intent is being reverted.

**`Diff.entries`**
An ordered list of `DiffEntry`. Order matters for structural operations where sequencing is semantically meaningful (e.g. `remove_block` at index 2 followed by `reorder_block` — replaying entries out of order could target the wrong block). One `Operation` (architecture-core §3) may touch several model paths — e.g. `add_section` writes both the new `SectionInstance` and the `sectionInstances` ordering array on the `TemplateNode` — so it is normal for one `Operation` to produce a `Diff` with 2+ entries. This is exactly why **one Operation Plan step = one Diff**, not one DiffEntry (see §8).

**`Diff.createdAt`**
Server timestamp at commit time (not client submit time — for AI operations there can be seconds of generation latency between "user approved the plan" and "diff was actually applied"). Used for ordering in history views and as the natural axis for compare-versions time-range queries.

**`DiffEntry.kind`**
| kind | meaning | `before` | `after` |
|---|---|---|---|
| `added` | path did not exist before, exists now | absent/undefined | the new value |
| `removed` | path existed before, does not exist now | the old value | absent/undefined |
| `modified` | path exists in both, value changed | old value | new value |
| `moved` | same value, different position (e.g. section reordered within `sectionInstances`) | old position descriptor | new position descriptor |
| `renamed` | same entity, different key/id (rare — e.g. a duplicated section gets a fresh `instanceId` but the operation wants to express "this is conceptually the same edit lineage") | old identifier | new identifier |

`moved` and `renamed` are kept distinct from `modified` because their reversal and their `humanSummary` rendering are different (a mover restores position; a modifier restores value), and because "compare versions" (§9) should be able to say "3 sections were reordered" separately from "3 settings changed."

**`DiffEntry.path`**
A dot/bracket path into the `ThemeModel` (architecture-core §2), always rooted at a stable identifier, never at an array index alone — because array indices shift under concurrent edits but `instanceId`s don't. Examples:
- `sections.hero-1.settings.background`
- `sections.hero-1.blocks.blk-42.settings.label`
- `templates.product.sectionInstances` (whole-array entry, used for `add_section`/`move_section`/`remove_section` position changes)
- `globalStyles.colors.accent`
- `themeSettings.social_instagram_url`
- `assets.assets/hero-bg.jpg`

Path is what §7 (revert-conflict detection) and the regression-validation layer in doc 15 use to determine whether two Diffs touched the same thing.

**`DiffEntry.before` / `DiffEntry.after`**
Full values, not sub-diffs — even for object-valued settings, we store the complete before/after object rather than a nested patch. This is a deliberate simplicity-over-compactness tradeoff: it makes every `DiffEntry` independently reversible (`apply(after)` / `apply(before)`) without needing a patch-merge library, and it makes `humanSummary` generation straightforward. The cost (larger stored payloads for big objects like a full `blocks` array replacement) is accepted because theme model values are small (individual settings, not full files) — the actual Liquid/JSON files are never inlined into a Diff; see §2.2.

**`DiffEntry.humanSummary`**
A pre-rendered, human-readable one-liner, generated at Diff-creation time (not at display time) so that history remains stable and readable even if the underlying setting schema later changes (e.g. a section's setting label is renamed in a theme update — old history should still read the way it did when it happened). Examples:
- `"hero background changed from #ffffff to #111827"`
- `"added section 'Featured Collection' to Home page (position 3)"`
- `"removed block 'Star rating' from Product Reviews"`
- `"moved section 'Newsletter' from position 5 to position 2"`
- `"updated theme.liquid via AI code edit (12 lines changed)"` — for `modify_liquid`/`modify_css`/`modify_js`, since raw unified diffs are not human-friendly, the summary is AI-generated from the operation's rationale, not derived mechanically from the patch.

### 2.2 What a Diff does NOT contain

A Diff never embeds full Liquid/JSON file contents. For `create_section_file`/`modify_liquid`/`modify_css`/`modify_js` operations, the `DiffEntry.before`/`after` for the affected `assets`/section-file path store the **unified diff text** (the same `unifiedDiff` the `Operation.payload` carried) plus a reference — not a duplicated full-file blob. Full file contents live in the `ThemeSnapshot` (§5) and in the theme's version-controlled file store; the Diff only needs enough to reverse and to render history. This keeps Diffs small and keeps "restore full version" and "revert one operation" using two different, appropriately-sized data paths.

### 2.3 Worked example: hero background color change (structural op)

User asks the AI to "make the hero background darker." Planner emits a one-step Operation Plan:

```
Operation {
  opId: "op_9f3a"
  type: "update_setting"
  target: { instanceId: "hero-1", settingId: "background" }
  payload: { value: "#111827" }
  requiresNewCode: false
  riskLevel: "safe"
  estimatedCreditCost: 0
}
```

Executing it against the `ThemeModel` produces:

```
Diff {
  diffId: "diff_01J8X...7Q"
  themeVersionId: "tv_shop42_draft3"
  causedBy: { type: "ai_operation", operationId: "op_9f3a" }
  entries: [
    {
      kind: "modified",
      path: "sections.hero-1.settings.background",
      before: "#ffffff",
      after: "#111827",
      humanSummary: "hero background changed from #ffffff to #111827"
    }
  ]
  createdAt: "2026-08-19T14:02:11.340Z"
}
```

### 2.4 Worked example: add + reorder (multi-entry Diff from one Operation)

`add_section` with `position: 2` on a template that currently has 4 sections. This is one `Operation`, but two model paths change: the new `SectionInstance` object appears, and the `sectionInstances` order array on the `TemplateNode` changes.

```
Diff {
  diffId: "diff_01J8X...9B"
  themeVersionId: "tv_shop42_draft3"
  causedBy: { type: "ai_operation", operationId: "op_9f41" }
  entries: [
    {
      kind: "added",
      path: "sections.featured-collection-2",
      before: undefined,
      after: { instanceId: "featured-collection-2", sectionType: "featured-collection", settings: { ... }, blocks: [], visibility: {...}, disabled: false },
      humanSummary: "added section 'Featured Collection' to Home page"
    },
    {
      kind: "moved",
      path: "templates.index.sectionInstances",
      before: ["hero-1", "rich-text-1", "product-grid-1", "footer-cta-1"],
      after:  ["hero-1", "rich-text-1", "featured-collection-2", "product-grid-1", "footer-cta-1"],
      humanSummary: "inserted 'Featured Collection' at position 3 of 5 on Home page"
    }
  ]
  createdAt: "2026-08-19T14:05:47.812Z"
}
```

Reversal of this Diff is: remove `sections.featured-collection-2`, then restore `templates.index.sectionInstances` to `before`. Order of reversal is the reverse of entry order — this is why entry order is meaningful (§2.1).

---

## 3. Undo / redo (in-session)

Undo/redo operates purely on the **Diff stack** for the current editing session — it is not a separate mechanism from the persisted Diff history, it's a cursor into it.

```
UndoState {
  themeVersionId: string
  cursor: number          // index into the session's ordered Diff list; points at "last applied"
  diffs: [diffId]         // ordered, session-scoped view (could span further back — see below)
}
```

- **Undo**: reverse-apply the `Diff` at `cursor` to the `ThemeModel` (walk `entries` in reverse order, set each `path` to `before`), decrement `cursor`. Does not delete the `Diff` row — it stays in persisted history (§4), marked logically superseded by a new "undo" marker Diff (see below) rather than erased, so history remains an honest audit log (Principle 10: security first, and general auditability).
- **Redo**: re-apply the `Diff` at `cursor + 1` forward (`entries` in original order, set each `path` to `after`), increment `cursor`.
- **New edit after undo**: if the user undoes 2 steps and then makes a new edit, the redo tail (the undone-but-not-yet-overwritten Diffs) is invalidated for redo purposes but, per the audit principle above, **not deleted** from the persisted `Diff` table — it simply falls off the redo stack. The new edit gets appended after `cursor`.

Undo/redo is **not** implemented as "restore the previous `ThemeSnapshot`" — that would be correct but wasteful and would lose granularity (undoing one setting change shouldn't roll back everything since the last snapshot). It's an in-place reverse-application of one `Diff`'s entries. This only works because every `DiffEntry.before` is a complete value (§2.1), so reversal never needs to consult anything outside the Diff itself.

Undo/redo is scoped to the current editing session's `ThemeVersion` working copy and is available for both editor edits and AI operations uniformly, because both produce the same `Diff` shape (Principle 7).

---

## 4. AI operation history (persisted, queryable per ThemeVersion)

`ThemeOperation` (architecture-core §5) is the persisted form of `Operation` (architecture-core §3), one row per operation actually executed (not per plan step proposed-then-rejected — rejected plan steps are never persisted as `ThemeOperation`, only as part of the `OperationPlan` record for audit-of-what-was-suggested purposes).

```
ThemeOperation record (persisted fields, extending Operation):
  opId, type, target, payload, requiresNewCode, riskLevel, estimatedCreditCost   // from Operation, architecture-core §3
  themeVersionId: string
  operationPlanId: string          // the OperationPlan this step belonged to
  diffId: string                   // the Diff this operation produced (1:1)
  status: "applied" | "reverted" | "superseded"
  executedAt: timestamp
  executedBy: userId               // who approved execution (AI acts on behalf of a user, never autonomously against Principle 4/5)
  validationResult: ValidationSummary   // see doc 15 — pass/warn detail, retained for audit
```

This gives two independent, complementary views over the same underlying facts:
- **Diff history** (§2–3): "what changed, in what order, how do I reverse it" — optimized for undo/redo and restore.
- **AI operation history**: "what did the AI do, when, as part of which plan, at what validation/risk outcome, at what cost" — optimized for the History panel UI, cost auditing (doc 22 billing ties `estimatedCreditCost` to this), and `AuditLog` (architecture-core §5) correlation.

Queryable per `ThemeVersion`, filterable by `status`, `riskLevel`, `type`, date range, and `operationPlanId` (to see "everything this one AI request did" as a group — see §8).

---

## 5. Version snapshots

`ThemeSnapshot` (architecture-core §5) is a full-file-tree backup. Snapshots exist so that (a) undo/Diff-reversal never has to replay an unbounded history to reconstruct state, and (b) "restore to an earlier point" and "compare two versions" have a cheap, correct ground truth to diff against, instead of replaying the entire Diff log from theme creation.

```
ThemeSnapshot {
  snapshotId: string
  themeVersionId: string
  reason: "pre_destructive_op" | "pre_generative_op" | "manual_save" | "scheduled" | "pre_publish"
  fileTree: object            // full serialized theme file contents at this point (content-addressed storage; see note below)
  themeModelState: object     // full ThemeModel JSON at this point, so restore doesn't require re-parsing files
  createdAt: timestamp
  createdByDiffId: string | null   // the last Diff applied before this snapshot was taken, null if this is the baseline import snapshot
}
```

`fileTree` is stored content-addressed (each file blob hashed and deduplicated across snapshots) so that taking frequent snapshots is cheap — consecutive snapshots typically share the vast majority of file blobs.

### 5.1 When is a snapshot taken

| Trigger | Reason value | Rationale |
|---|---|---|
| Before executing any `Operation` with `riskLevel: "destructive"` | `pre_destructive_op` | Guarantees a one-click full rollback point exists before anything that can't be cleanly reversed by a single Diff reversal (e.g. bulk section removal, large-scale restructuring plans). |
| Before executing any `Operation` where `requiresNewCode: true` (i.e. `create_section_file`/`modify_liquid`/`modify_css`/`modify_js`) | `pre_generative_op` | Generative ops carry the highest scrutiny per Principle 3/8 — even if `riskLevel` is only `"review"`, generated code is the category most likely to need a clean full-file rollback if validation (doc 15) is bypassed or a subtle issue surfaces after the fact (e.g. renders fine but breaks on a template the preview didn't cover). |
| On explicit user "Save"/publish-prep action | `manual_save` | User-declared checkpoints the user will recognize and want to return to by name/timestamp, independent of what the AI was doing. |
| On a rolling cadence (e.g. every N applied Diffs or every T minutes of active editing, whichever comes first — exact N/T are an operational tuning parameter, not an architectural one) | `scheduled` | Bounds the maximum Diff-replay distance for any reconstruction path, and protects against the case where a session has many small structural edits with no single destructive/generative trigger. |
| Immediately before a theme is published to the live Shopify store | `pre_publish` | The single most important rollback point operationally — "what did the live site look like right before this went out" must always be a one-step restore, tying into `PublishHistory` (architecture-core §5). |

Snapshots are never taken *instead of* Diffs — every mutation still produces a Diff regardless of whether a snapshot was also taken at that moment. Snapshots and Diffs are complementary: Diffs give granularity, Snapshots give bounded-cost full recovery.

### 5.2 Snapshot retention

Snapshots are retained per plan tier (doc 22 concern), but `pre_publish` and `manual_save` snapshots are never subject to automatic garbage collection — only `scheduled` and superseded `pre_destructive_op`/`pre_generative_op` snapshots (ones with no Diffs referencing them as a restore target within the retention window) are eligible for pruning, and pruning always keeps at least one snapshot per calendar day for the lifetime of the retention window to avoid ever creating gaps that make "restore to roughly last week" impossible.

---

## 6. Restore-previous-version flow

"Restore" means: make the `ThemeModel` (and, on publish, the live theme files) match a target `ThemeSnapshot` exactly, discarding — but not deleting — everything in between.

```
Restore flow:
1. User selects a target: either a ThemeSnapshot directly (from a "Version History" list showing reason + timestamp + human summary of nearby Diffs), or a point in time (resolved to the nearest ThemeSnapshot at or before that time).
2. System takes a NEW ThemeSnapshot of current state first, reason: "manual_save" (safety net — restoring is itself reversible; you can "undo an undo of everything").
3. ThemeModel is replaced wholesale with target.themeModelState.
4. A new Diff is generated representing the restore itself:
   Diff.causedBy = { type: "editor_edit", userId }   // restore is always a deliberate user action, never silently AI-initiated
   Diff.entries = [ one DiffEntry per top-level path that differs between the pre-restore and post-restore ThemeModel, kind derived per-path, humanSummary: "restored theme to version from <timestamp>" as a batch label plus per-entry detail ]
5. All ThemeOperations executed after the target snapshot are marked status: "superseded" (not deleted — audit trail (Principle 10) is preserved).
6. Files are re-serialized from the restored ThemeModel via the Theme Serializer, validated (doc 15 full pipeline — a restore still must produce a valid theme), then written.
7. AuditLog entry recorded: actor, target snapshot, timestamp, reason if user supplied one.
```

Restoring targets a **whole `ThemeSnapshot`**, not an arbitrary `Diff` — arbitrary-Diff-point restore is achievable by picking the nearest snapshot before that Diff and then forward-replaying the remaining Diffs up to that point, which the UI can offer as "restore to this exact change" while internally implementing it as snapshot + replay. This keeps the restore mechanism single-pathed (always snapshot-based under the hood) while still exposing Diff-level precision to the user.

---

## 7. Revert a single AI operation (even with later operations on top)

This is the hardest case in the system: the user wants to undo *one* AI operation from three steps ago, without losing the two operations that happened after it.

### 7.1 Mechanism

Reverting `ThemeOperation` X means: apply the inverse of `Diff` X's entries (`after → before`, same reversal logic as undo, §3) directly to the **current** `ThemeModel`, not to the state at the time X was applied.

### 7.2 The conflict case

If a later operation Y (or a later editor edit) also touched a `path` that X's Diff entries cover, naive reversal is unsafe: setting that path back to X's `before` could silently discard Y's change, or produce a value Y never intended to sit alongside (e.g. X set `hero-1.settings.background`, Y later set `hero-1.settings.text_color` to complement that exact background — reverting only `background` leaves a bad-contrast combination Y's author never chose).

**Decision for v1: detect the conflict and block with a clear warning; do not attempt an automatic 3-way merge.**

Rationale:
- A correct 3-way merge over structured theme-model values (not text) requires per-field-type merge semantics (numeric vs. color vs. array-of-blocks vs. nested object) that don't have an obviously "safe" resolution in the general case — unlike text-file 3-way merge, there's no line-based fallback that's defensible for e.g. merging two different `blocks` array edits.
- A silent or semi-automatic merge that gets it wrong directly violates the core promise ("safe, traceable, reversible") worse than simply refusing — an incorrect auto-merge is a new bug introduced by the revert feature itself, and the user may not notice until much later.
- Blocking with a clear, specific warning keeps the system's behavior easy to reason about and easy to explain in the UI ("Section X was changed again after this, by operation Y — revert anyway and lose that later change too? / Cancel"), which is consistent with Principle 4 (ask instead of guessing) applied to the revert action itself.
- 3-way merge remains a viable v2 direction once there's real usage data on how often this conflict actually occurs and what shapes of conflicting edits are common enough to justify hand-written per-type merge rules.

### 7.3 Conflict detection algorithm

```
revertOperation(themeVersionId, operationId):
  targetOp = lookup ThemeOperation by operationId
  targetDiff = lookup Diff by targetOp.diffId
  targetPaths = set of targetDiff.entries[*].path

  laterDiffs = all Diffs for themeVersionId where createdAt > targetDiff.createdAt
                 AND causedBy != this same revert lineage (avoid self-conflict on repeated reverts)

  conflictingDiffs = laterDiffs where any entry.path intersects targetPaths
                      // path intersection includes prefix containment, e.g. a later "removed" of
                      // sections.hero-1 (whole section) conflicts with an earlier entry at
                      // sections.hero-1.settings.background (a sub-path)

  if conflictingDiffs is empty:
    apply inverse of targetDiff.entries to current ThemeModel
    create new Diff, causedBy: { type: "editor_edit", userId }, entries reflecting the reversal,
      humanSummary per entry: "reverted: <original humanSummary>"
    mark targetOp.status = "reverted"
    return SUCCESS

  else:
    return BLOCKED {
      reason: "later_operation_touched_same_target",
      conflictingOperations: [ { operationId, humanSummary, executedAt } for each conflicting op ],
      options offered to user:
        - "Cancel"
        - "Revert anyway" -> re-run with an explicit override flag; this force-reverts targetDiff's
          entries only (still does NOT touch the conflicting later Diffs' other, non-overlapping
          entries), and requires an explicit confirmation click naming exactly which later
          operations will be affected, logged to AuditLog with the override explicitly noted
```

"Revert anyway" still never silently rewrites the later operation's own Diff record — it only overwrites the live `ThemeModel` value at the conflicting path(s) and records a new forward Diff for that override, so the full history (X happened, then Y happened and touched the same field, then the user explicitly chose to force-revert X anyway) remains completely legible in the AI operation history and Diff history. Nothing is deleted or rewritten in place, per Principle 10.

---

## 8. Is each AI request one atomic transaction?

**Yes — recommended and specified as: one Operation Plan execution = one transaction = one Diff = one undo unit.**

Concretely: when the user approves an `OperationPlan` (architecture-core §3) containing `Operation[]` (possibly several steps — e.g. "add a hero, change the accent color, and add an FAQ section" might plan to three `Operation`s), the Executor:

1. Opens one database transaction scoped to the whole plan.
2. Runs all validation (doc 15) for all steps before committing any of them.
3. Applies all `Operation`s to the `ThemeModel` in sequence within that transaction.
4. Persists **one `Diff`** whose `entries` is the concatenation, in execution order, of every individual `Operation`'s resulting entries (not one Diff per Operation).
5. Persists one `ThemeOperation` row per `Operation` (so per-operation history/audit stays granular — §4), each pointing at the same shared `diffId`.
6. Commits the transaction only if the whole plan validated and applied cleanly; otherwise rolls back entirely — no partial application of a multi-step plan ever reaches the `ThemeModel`.

### Justification

- **Atomicity matches user intent.** The user approved one request ("do these three things"), not three independent requests. If step 2 of 3 fails validation, applying steps 1 and 3 anyway produces a theme state the user never asked for and never approved — a silent partial success is more dangerous than a clean full failure, especially for generative operations (Principle 8, Shopify compatibility first).
- **Undo granularity matches request granularity.** One undo press should undo "the thing I just asked the AI to do," not require three separate undo presses to fully back out one AI request, and should not risk landing on a half-executed intermediate state that was never a real, user-approved theme state.
- **It composes correctly with §5 snapshotting.** "Before any destructive/generative operation" (§5.1) is evaluated once per plan (at the plan boundary), not per individual `Operation` inside the plan — so a single snapshot brackets the whole atomic unit, matching the transaction boundary.
- **It composes correctly with §7 revert.** Reverting "operation X" where X was one step of a multi-step plan reverts only that step's entries within the shared Diff, via the same path-based mechanism — the shared `diffId` doesn't prevent per-`ThemeOperation` reversal because conflict detection and inversion both operate at the `DiffEntry`/path level, not at the whole-Diff level. (The UI, however, always surfaces undo at the whole-plan/whole-Diff grain by default, and offers "revert just this one step" as the more surgical, explicitly-chosen action from AI operation history — this is a UX default, not a system limitation.)
- **Failure handling stays simple and matches Principle 4/5.** A validation failure mid-plan (doc 15) triggers the plan's Clarification/re-plan flow — the AI proposes a revised plan or asks the user a clarifying question — rather than the system needing to explain "2 of your 3 requested changes were applied, 1 wasn't."

The one deliberate exception: interactive, incremental editor edits (`causedBy.type: "editor_edit"`) are **not** grouped this way — each individual drag/drop or inspector field commit is its own `Diff`, because those are already atomic, single-intent user actions with no planning step in front of them. Grouping-into-one-transaction is specifically an AI-Operation-Plan concern.

---

## 9. Compare versions (diff-of-diffs)

Comparing two points in history (two `ThemeSnapshot`s, or two arbitrary timestamps resolved to nearest snapshot + replay as in §6) means computing a **structural diff between two `ThemeModel` states**, which is exactly the same entry-producing logic used to create a `Diff` from a mutation — reused here as a pure comparison function rather than a mutation side-effect.

```
compareVersions(themeModelStateA, themeModelStateB) -> Diff-shaped result:
  {
    diffId: null,                  // synthetic — not persisted as a real history Diff unless the user explicitly saves the comparison
    themeVersionId: <B's themeVersionId>,
    causedBy: { type: "comparison", fromSnapshotId: A.snapshotId, toSnapshotId: B.snapshotId },
    entries: [DiffEntry],          // same kind/path/before/after/humanSummary shape as always
    createdAt: <computed at query time>
  }
```

This is literally "diff-of-diffs" in the practical sense the product needs: rather than trying to algebraically combine the intervening `Diff` records (which is unnecessary complexity — intervening Diffs may include reverted/superseded ones, per §3/§6/§7, that shouldn't double-count), compare-versions recomputes a clean structural diff directly between the two `ThemeModel` snapshots' states, using the identical `DiffEntry`-producing comparator that normal mutations use. This guarantees compare-versions always reflects *actual net difference*, immune to history noise like an edit-then-immediate-undo that produced two Diff rows but zero net change.

The comparator additionally supports a **grouped/aggregated view** for UI presentation — grouping consecutive `entries` by section/template for a human-scannable summary (e.g. "Home page: 2 sections added, 1 removed, 4 settings changed across 3 sections; Product page: no changes") — but the underlying flat `entries` list is always available for full detail or export.

Compare-versions is read-only and side-effect-free: it never creates real `Diff`/`ThemeOperation` rows unless the user takes an explicit follow-up action (e.g. "restore B's value for this one field into my current draft," which then goes through the normal Operation → Diff path as a fresh `editor_edit`).

---

## 10. Summary diagram

```
                         ┌─────────────────────────────┐
                         │        Operation Plan         │
                         │   Operation[] (1..N steps)     │
                         └───────────────┬───────────────┘
                                         │  doc 15 validation (ALL steps)
                                         ▼
                         ┌─────────────────────────────┐
   pre_generative_op /   │      ONE transaction:         │
   pre_destructive_op ──▶│  apply Operation[] to ThemeModel│
   ThemeSnapshot taken   │  → ONE Diff (concatenated entries)│
   before this begins    │  → N ThemeOperation rows        │
                         └───────────────┬───────────────┘
                                         │
                     ┌───────────────────┼───────────────────┐
                     ▼                   ▼                   ▼
              Undo/Redo stack      AI Operation History   Diff/version history
              (session cursor       (queryable per          (Diff table,
               over Diff list)      ThemeVersion, per        ThemeSnapshot table)
                                     OperationPlan)                │
                                                                   │
                        ┌──────────────────────────────────────────┤
                        ▼                        ▼                 ▼
                Restore (snapshot +      Revert single op    Compare versions
                replay to a point)       (conflict check →    (structural diff
                                          block+warn if        between two
                                          later op overlaps)   ThemeModel states)
```
