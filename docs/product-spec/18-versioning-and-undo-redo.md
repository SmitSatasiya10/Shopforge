# Versioning and Undo/Redo

Every AI or manual change to a [Store Configuration](03-store-configuration.md) produces a `Diff`, is captured in
version history, and is undoable. This document specifies the `Diff` schema, the checkpoint/snapshot system behind
the Version History timeline, undo/redo, restore, single-operation revert, conflict handling, and how the version
system interacts with provenance-aware AI regeneration. See [decision 12](DECISIONS.md).

Every numbered "Version" a merchant sees is persisted as one `StoreConfigVersion` row — the entity fully defined
in [Data Model](19-data-model.md). This document uses `ConfigurationVersion` as the conceptual/behavioral name for
that same row when discussing it specifically *as a checkpoint* (as opposed to *as the currently-mutating draft*,
its other role — see §4.2). It is one entity, not two: `StoreConfigVersion` and `ConfigurationVersion` name the
same table from two angles, the way "the active row" and "a checkpoint" describe the same row at different points
in its lifecycle.

## 1. Where this sits in the product flow

```
AI Generation
      |
Version
      |
Manual Edit
      |
Version
      |
AI Edit
      |
Version
      |
Publish
```

Every step that changes the Store Configuration writes a `Diff`. Not every `Diff` produces a new numbered
`Version` — a `Version` (a `ConfigurationVersion` record) is a checkpoint taken at specific triggers (§4), not on
every single field change. Between checkpoints, `Diff`s accumulate and remain individually undoable and revertible.
`Publish` is a distinct, explicit user action that both stamps a `ConfigurationVersion` as the live one and pushes
it to Shopify (see [Shopify Publishing](14-shopify-publishing.md)) — it never happens implicitly as a side effect
of AI Generation or Manual Edit.

## 2. Core entities

| Entity | Role |
|---|---|
| `StoreConfigVersion` | A Project has exactly one row with `status: active` at a time — the working copy that `Diff`s accumulate against in place. At a checkpoint trigger (§4.1), the active row is superseded and a new `StoreConfigVersion` row (`parentStoreConfigVersionId`-linked) becomes the new active draft. Full persisted schema: [Data Model](19-data-model.md). |
| `Diff` | One atomic, reversible record of a single mutation (or one AI Operation Plan's worth of mutations — see §7). The unit of undo/redo. |
| `DiffEntry` | One field/path-level change within a `Diff`. |
| `ConfigurationVersion` | The same `StoreConfigVersion` row, referred to by its role once it has been checkpointed: a full-document, point-in-time snapshot — the "Version 1 / Version 2 / ..." a merchant sees in Version History. |
| `PublishRecord` / `PublishHistory` | The record of which `StoreConfigVersion` was pushed to the live Shopify store, and when. Full schema owned by [Shopify Publishing](14-shopify-publishing.md); this document specifies only how it relates to a checkpointed `StoreConfigVersion`. |

`Diff`s give surgical, field-level granularity. Checkpointed `StoreConfigVersion`s give cheap, bounded-cost
full-document recovery and back the human-scannable Version History timeline. Neither replaces the other — every
mutation produces a `Diff` regardless of whether a checkpoint is also taken at that moment.

## 3. The `Diff` schema

```
Diff {
  diffId: string
  storeConfigVersionId: string
  causedBy: {
    type: "ai_operation" | "editor_edit" | "restore" | "comparison",
    operationId?: string,      // set when type = "ai_operation"
    userId?: string,           // set when type = "editor_edit" or "restore"
    fromVersionId?: string,    // set when type = "comparison"
    toVersionId?: string       // set when type = "comparison"
  }
  entries: [DiffEntry]
  createdAt: timestamp
}

DiffEntry {
  kind: "added" | "removed" | "modified" | "moved" | "renamed"
  path: string
  before?: any
  after?: any
  humanSummary: string
}
```

### 3.1 Field semantics

**`diffId`** — globally unique, monotonically sortable within a `storeConfigVersionId` (e.g. ULID/KSUID, not a bare
auto-increment), so ordering survives the AI pipeline and the Visual Editor both writing `Diff`s against the same
draft in quick succession. This is the key used for undo-stack entries, revert targets, and compare-versions
inputs.

**`storeConfigVersionId`** — every `Diff` belongs to exactly one draft lineage and never spans two. If a draft is
forked (e.g. a merchant duplicates a draft to try an alternate layout), the fork's `Diff` history starts fresh,
anchored at the source `ConfigurationVersion`.

**`causedBy`** — the provenance envelope. This is what lets the UI and the AI regeneration system distinguish
"AI changed this" from "you changed this" from a single field, with no separate lookup (see §9):

| `type` | Meaning |
|---|---|
| `ai_operation` | Produced by executing an AI Operation. `operationId` is a foreign key into the `Operation` record owned by [AI Architecture](04-ai-architecture.md). |
| `editor_edit` | Produced by a direct Visual Editor mutation (drag-to-reorder, settings-panel field change, publish click) with no AI Operation behind it. |
| `restore` | Produced by a restore-to-a-previous-version action (§6). Kept distinct from `editor_edit` because it is a batch action over many paths at once and the UI renders it as "restored to Version N," not a list of field changes. |
| `comparison` | Synthetic. Never persisted as real history — produced only by compare-versions (§8). |

**`entries`** — an ordered list of `DiffEntry`. Order is meaningful for structural operations (e.g. removing a
section, then reordering the remainder — replaying entries out of order could target the wrong section). One AI
Operation Plan step can touch several paths at once (e.g. adding a section writes both the new section object and
the page's section order), so it is normal for one `Diff` to carry 2+ entries. One Operation Plan execution
produces exactly one `Diff` (§7), not one `Diff` per `DiffEntry` and not one `Diff` per Operation step.

**`createdAt`** — server timestamp at commit time, not client submit time (AI generation latency can separate "plan
approved" from "Diff applied"). Used for history ordering and as the axis for compare-versions time-range queries.

### 3.2 `DiffEntry.kind`

| `kind` | Meaning | `before` | `after` |
|---|---|---|---|
| `added` | Path did not exist before, exists now | absent | new value |
| `removed` | Path existed before, does not exist now | old value | absent |
| `modified` | Path exists in both, value changed | old value | new value |
| `moved` | Same value(s), different position — a section or block reordered within its parent array | old ordered list of ids | new ordered list of ids |
| `renamed` | Same entity, different `id` (rare — e.g. duplicating a section assigns a fresh `id` while expressing "same edit lineage as the source") | old `id` | new `id` |

`moved` and `renamed` are kept distinct from `modified` because reversal and `humanSummary` rendering differ (a
move restores position, a modification restores a value), and because compare-versions (§8) needs to say "sections
were reordered" separately from "settings changed."

### 3.3 `DiffEntry.path`

A dot-path into the Store Configuration, always rooted at a stable `id` for array entries (a section's or block's
`id`), never a bare array index — indices shift under reordering, `id`s don't. The one exception: when the change
*is* the order itself (an entry added, removed, or reordered within a `sections` or `blocks` array), the path
addresses the containing array as a whole, and `before`/`after` are the array's ordered list of `id`s.

Examples:
- `pages.home.sections[id=hero-1].settings.background_color`
- `pages.home.sections[id=hero-1].blocks[id=blk-42].settings.label`
- `pages.home.sections` — whole-array entry, used for a `moved` entry capturing insertion, removal, or reordering
- `pages.product.sections[id=faq-1].blocks[id=blk-7].settings.answer`

Path shape matches the Store Configuration's own addressing scheme ([Store Configuration](03-store-configuration.md))
so the two documents stay consistent without restating each other's schema. It is also what conflict detection
(§7.2) and the [Validation](17-validation-and-error-handling.md) pipeline use to determine whether two `Diff`s
touched the same thing.

### 3.4 `DiffEntry.before` / `DiffEntry.after`

Full values, never sub-diffs or patches — even for object-valued settings (a `blocks` array replacement, a
compound setting object). This is a deliberate simplicity-over-compactness tradeoff: every `DiffEntry` is
independently reversible (`apply(after)` / `apply(before)`) with no patch-merge library, and `humanSummary`
generation stays straightforward. This is affordable because Store Configuration values are inherently small —
settings and content strings, never files, rendered markup, or binary data. An asset-valued setting
(e.g. `settings.image`) stores a reference/URL, never bytes, so `before`/`after` stay small even there.

A `Diff` never embeds: the full Store Configuration document (that's what a `ConfigurationVersion` is for, §4);
Liquid, CSS, or JS source (there is none to carry — Section Library templates are fixed and AI/Diffs never modify
them); or rendered HTML from the preview (a `Diff` records configuration state, not render output).

### 3.5 `DiffEntry.humanSummary`

Pre-rendered at `Diff`-creation time, not at display time, so history stays stable and readable even if a
section's setting label is later relabeled in the Section Library. For an AI operation that rewrites several
fields at once as a single conceptual change (e.g. a content regeneration), the summary is generated from the
operation's stated intent, not a mechanical field-by-field enumeration — a merchant cares what the AI did more
than a raw list of string diffs.

### 3.6 Worked example — single-field change

```json
{
  "diffId": "diff_01J8X0000000000000007Q",
  "storeConfigVersionId": "scv_store42_draft",
  "causedBy": { "type": "ai_operation", "operationId": "op_9f3a" },
  "entries": [
    {
      "kind": "modified",
      "path": "pages.home.sections[id=hero-1].settings.background_color",
      "before": "#ffffff",
      "after": "#111827",
      "humanSummary": "Hero background changed from #ffffff to #111827"
    }
  ],
  "createdAt": "2026-08-19T14:02:11.340Z"
}
```

The same change made by dragging the color picker in the Visual Editor produces a structurally identical `Diff`,
with `causedBy: { "type": "editor_edit", "userId": "..." }` in place of the `ai_operation` envelope. The Visual
Editor and the AI Operation system write through the same mutation path into the Store Configuration, so undo/redo
and history treat both uniformly.

### 3.7 Worked example — multi-entry `Diff` from one operation

An AI Operation adds a "Featured Collection" section at position 3 of a 4-section Home page. One operation, two
changed paths: the new section object, and the page's section order.

```json
{
  "diffId": "diff_01J8X0000000000000009B",
  "storeConfigVersionId": "scv_store42_draft",
  "causedBy": { "type": "ai_operation", "operationId": "op_9f41" },
  "entries": [
    {
      "kind": "added",
      "path": "pages.home.sections[id=featured-collection-2]",
      "before": null,
      "after": {
        "id": "featured-collection-2",
        "type": "featured-collection",
        "settings": { "...": "..." },
        "blocks": []
      },
      "humanSummary": "Added 'Featured Collection' section to Home page"
    },
    {
      "kind": "moved",
      "path": "pages.home.sections",
      "before": ["hero-1", "rich-text-1", "product-grid-1", "footer-cta-1"],
      "after":  ["hero-1", "rich-text-1", "featured-collection-2", "product-grid-1", "footer-cta-1"],
      "humanSummary": "Inserted 'Featured Collection' at position 3 of 5 on Home page"
    }
  ],
  "createdAt": "2026-08-19T14:05:47.812Z"
}
```

Reversal walks `entries` in reverse: remove `pages.home.sections[id=featured-collection-2]`, then restore
`pages.home.sections` to `before`. Entry order is what makes this replay correct.

## 4. `ConfigurationVersion`: snapshots and the Version History timeline

Conceptually, a checkpoint carries this shape. The persisted columns living on the actual `StoreConfigVersion` row
are [Data Model](19-data-model.md)'s `id`, `label`, `status`, `configuration`, `producedByType`,
`producedByOperationId`/`producedByUserId`, `publishedAt`; `versionNumber` and `createdByDiffId` below are a
derived display convenience (sequential position in the Project's lineage, and the last `Diff` applied before the
checkpoint) rather than separate stored columns, and `reason` is this document's more granular refinement of the
persisted `producedByType` enum, used to drive Version History's human-facing labels:

```
ConfigurationVersion {                // = a StoreConfigVersion row, once checkpointed
  configurationVersionId: string      // = StoreConfigVersion.id
  storeConfigVersionId: string        // = parentStoreConfigVersionId (the draft lineage this continues)
  versionNumber: integer          // sequential, user-facing: "Version 1", "Version 2", ... (derived, not stored)
  reason: "ai_initial_generation" | "pre_ai_overwrite" | "manual_save" | "scheduled" | "pre_publish"
                                       // refines StoreConfigVersion.producedByType for Version History display
  storeConfiguration: object      // = StoreConfigVersion.configuration at this point
  status: "draft" | "published"       // maps onto StoreConfigVersion.status (active/archived collapse to "draft" here)
  createdAt: timestamp
  createdByDiffId: string | null  // last Diff applied before this checkpoint; null for the baseline
}
```

Not every `Diff` produces a new numbered `Version` — that would make Version History as noisy as the raw `Diff`
log. A checkpoint is taken only at the triggers below. `Diff`s between checkpoints still accumulate and remain
individually undoable/revertible, applied in place against the current active `StoreConfigVersion` row; the
numbered Version list is a view over the `Diff` history plus the chain of checkpointed `StoreConfigVersion` rows,
not a replacement for either.

### 4.1 When a `ConfigurationVersion` is taken

| Trigger | `reason` | Why |
|---|---|---|
| Initial AI Generation completes and produces the first Store Configuration for a draft | `ai_initial_generation` | The baseline every later `Diff`/`Version` builds on, and the point most often used to "start over from." |
| Before an AI Operation that overwrites existing settings/content on an already-configured section (regeneration, bulk reselection, removal of a section with merchant edits on it) | `pre_ai_overwrite` | The one category of AI action that can destroy merchant edits with no single-`Diff` reversal (a full section regeneration touches many settings at once). Guarantees a one-click rollback point exists before it runs. Purely additive AI operations (add a section, reorder) don't need this — their own `Diff` is already self-reversing. |
| Explicit user "Save" in the editor | `manual_save` | A user-declared checkpoint the merchant will recognize by name/timestamp. |
| Rolling cadence (every N applied `Diff`s or every T minutes of active editing, whichever comes first) | `scheduled` | Bounds the maximum `Diff`-replay distance for any reconstruction, and covers sessions with many small edits and no explicit save or AI-overwrite trigger. Exact N/T values are an operational tuning parameter, not an architectural one. |
| Immediately before Publish writes the configuration to the live Shopify store | `pre_publish` | "What did the live store look like right before this went out" must always be a one-step restore. This is the checkpoint that flips `status` to `published`. |

Snapshots are never taken *instead of* `Diff`s — every mutation still produces a `Diff` regardless of whether a
checkpoint was also taken at that moment.

### 4.2 Draft state vs. published state

A Project has exactly one `StoreConfigVersion` row with `status: active` at a time, accumulating `Diff`s against
it in place, and at most one row in its lineage marked `status: published` — the Version currently reflected on
the live Shopify store. Publishing is the only action that moves that mark; editing never does, even when the
merchant is editing "on top of" a published state.

- The Visual Editor always works against the current draft, never against what's live, so mid-edit states are
  never accidentally visible on the real storefront.
- "What's different between my draft and what's live" is always answerable as a compare-versions call (§8) between
  the current draft and the `ConfigurationVersion` currently marked `published` — this is the basis for an
  "unpublished changes" indicator in the editor.
- Draft state and published state coexist across time: after a `ConfigurationVersion` is marked `published`, the
  draft continues accumulating `Diff`s toward the *next* checkpoint, which is `draft` status until the merchant
  publishes again. At that point a new `ConfigurationVersion` is stamped `published` and the previous one becomes
  a historical (still restorable) entry.

### 4.3 Publish history

`PublishRecord`/`PublishHistory` is the ordered record of every `ConfigurationVersion` that was ever marked
`published`, with timestamps — retained indefinitely regardless of snapshot retention rules (§4.4), since it is
the audit trail [Shopify Publishing](14-shopify-publishing.md) needs for "what has actually been live, and when."
Rollback republishes a prior `PublishRecord`'s referenced `ConfigurationVersion`; full publish/rollback mechanics
are owned by that document.

### 4.4 Snapshot retention

Retention is governed by the applicable subscription tier, out of scope here. `pre_publish` and `manual_save`
`ConfigurationVersion`s are never subject to automatic garbage collection. Only `scheduled` and superseded
`pre_ai_overwrite` snapshots (ones with no `Diff` referencing them as a restore target within the retention
window) are eligible for pruning, and pruning always keeps at least one snapshot per calendar day for the life of
the retention window, so "restore to roughly last week" never has gaps.

### 4.5 Worked example — version history for a new store build

| Version | What happened | `causedBy` | Diff summary | `reason` | `status` |
|---|---|---|---|---|---|
| 1 | Initial AI Generation completes: Section Selection, Ordering, Settings/Content produce a full Home + Product page configuration from imported Product Data | `ai_operation` (initial generation's Operation Plan) | Home: 5 sections added, fully configured. Product: 4 sections added, fully configured. | `ai_initial_generation` | draft |
| 2 | User edits the Hero heading and background color in the Visual Editor | `editor_edit` | 2 settings changed on `pages.home.sections[id=hero-1]` | `manual_save` | draft |
| 3 | User drags Testimonials above Features on the Home page | `editor_edit` | `pages.home.sections` reordered (1 `moved` entry) | `scheduled` | draft |
| 4 | User asks the AI to "make the FAQ answers punchier"; AI regenerates the FAQ section's block content | `ai_operation` | 4 settings changed across `pages.home.sections[id=faq-1].blocks[*].settings.answer` | `pre_ai_overwrite` (taken before the regeneration applies, since it replaces existing content) | draft |
| 5 | User clicks Publish | `editor_edit` (Publish is always a deliberate user action, never AI-initiated) | none — configuration unchanged from Version 4; this checkpoint marks the publish event and flips `status` | `pre_publish` | **published** |

## 5. Undo / redo (in-session)

Undo/redo operates on the `Diff` stack for the current editing session — not a separate mechanism from persisted
`Diff` history, a cursor into it.

```
UndoState {
  storeConfigVersionId: string
  cursor: number          // index into the session's ordered Diff list; points at "last applied"
  diffs: [diffId]          // ordered, session-scoped view
}
```

- **Undo** — reverse-apply the `Diff` at `cursor` (walk `entries` in reverse order, set each `path` to `before`),
  decrement `cursor`. The `Diff` row is not deleted — it stays in persisted history, so history remains an honest
  audit log.
- **Redo** — re-apply the `Diff` at `cursor + 1` forward (`entries` in original order, set each `path` to `after`),
  increment `cursor`.
- **New edit after undo** — if the user undoes 2 steps and then makes a new edit, the redo tail (undone-but-not-
  yet-overwritten `Diff`s) is invalidated for redo purposes but not deleted from the persisted `Diff` table; it
  simply falls off the redo stack. The new edit is appended after `cursor`.

Undo/redo is **not** "restore the previous `ConfigurationVersion`" — that would lose granularity (undoing one
setting change shouldn't roll back everything since the last checkpoint). It is in-place reverse-application of
one `Diff`'s entries, which only works because every `DiffEntry.before` is a complete value (§3.4) — reversal never
needs to consult anything outside the `Diff` itself. Undo/redo is available uniformly for editor edits and AI
operations, because both produce the same `Diff` shape (§3.6).

## 6. Restore to a previous version

Restore makes the current draft's Store Configuration match a target `ConfigurationVersion` exactly, discarding —
never deleting — everything in between.

```
Restore flow:
1. User selects a target: a numbered Version directly (from the Version History list — reason, timestamp,
   human summary of nearby Diffs), or a point in time (resolved to the nearest Version at or before that
   time).
2. System takes a NEW ConfigurationVersion of the current draft state first, reason: "manual_save"
   (a safety net — restoring is itself reversible; you can undo a restore).
3. The draft's Store Configuration is replaced wholesale with the target's storeConfiguration.
4. A new Diff is generated representing the restore itself:
     causedBy = { type: "restore", userId }
     entries  = one DiffEntry per top-level path that differs between pre- and post-restore state,
                humanSummary: "Restored to Version 2 (Aug 19, 2:15pm)" as a batch label, with per-entry
                detail available on expand
5. Every AI Operation executed after the target Version is marked status: "superseded" (not deleted —
   the audit trail is preserved).
6. The restored draft passes through Configuration/Section/Settings validation (see
   Validation and Error Handling) as a sanity check — restoring from a Version that was itself valid
   should always pass, but this guards against a restore target referencing a section type since
   removed from the Section Library, surfacing that as a clear warning rather than a silent gap.
7. An audit entry is recorded: actor, target Version, timestamp, reason if supplied.
```

Restoring only affects the draft. If the target being restored to was itself the currently `published` Version (or
an earlier one), the live Shopify store is not touched until the merchant explicitly publishes again — restore is
a draft-only, always-safe action; Publish is the separate, deliberate action that pushes the draft to Shopify and
goes through the full validation pipeline at that time.

Restoring targets a whole numbered Version, not an arbitrary `Diff`. Restoring to an arbitrary point between two
Versions is offered in the UI as "restore to this exact change," implemented internally as: restore to the nearest
prior Version, then forward-replay the remaining `Diff`s up to that point. This keeps the restore mechanism
single-pathed (always snapshot-based underneath) while exposing `Diff`-level precision to the user.

## 7. Revert a single AI operation

The hardest case: undoing one AI operation from a few steps ago without losing what happened after it.

### 7.1 Mechanism

Reverting Operation X means applying the inverse of its `Diff`'s entries (`after → before`, same reversal logic as
undo, §5) directly to the **current** Store Configuration, not to the state at the time X was applied.

### 7.2 Conflict detection

If a later operation Y (or a later editor edit) also touched a `path` X's entries cover, naive reversal is unsafe —
it could silently discard Y's change or produce a combination Y never intended (e.g. X set a hero's background
color, Y later set the heading color to stay readable against that exact background; reverting only the background
leaves a bad-contrast combination Y's author never chose).

**Decision: detect the conflict and block with a clear warning; do not attempt an automatic merge.** A correct
automatic merge over structured settings (color vs. enum vs. array-of-blocks vs. nested object) has no obviously
safe general resolution, and an incorrect auto-merge is a new bug introduced by the revert feature itself — worse
than refusing. Blocking with a specific warning keeps the behavior easy to reason about and explain in the UI.
Merge-on-conflict is a candidate future direction once real usage data shows how often this occurs.

```
revertOperation(storeConfigVersionId, operationId):
  targetOp   = lookup Operation by operationId
  targetDiff = lookup Diff by targetOp.diffId
  targetPaths = set of targetDiff.entries[*].path

  laterDiffs = all Diffs for storeConfigVersionId where createdAt > targetDiff.createdAt
                 AND causedBy is not this same revert lineage (avoid self-conflict on repeated reverts)

  conflictingDiffs = laterDiffs where any entry.path intersects targetPaths
                      // intersection includes prefix containment: a later "removed" of
                      // pages.home.sections[id=hero-1] conflicts with an earlier entry at
                      // pages.home.sections[id=hero-1].settings.background_color

  if conflictingDiffs is empty:
    apply inverse of targetDiff.entries to the current Store Configuration
    create new Diff, causedBy: { type: "editor_edit", userId },
      entries reflecting the reversal, humanSummary: "Reverted: <original humanSummary>"
    mark targetOp.status = "reverted"
    return SUCCESS

  else:
    return BLOCKED {
      reason: "later_operation_touched_same_target",
      conflictingOperations: [ { operationId, humanSummary, executedAt } for each conflicting op ],
      options:
        - "Cancel"
        - "Revert anyway" -> re-run with an explicit override flag; force-reverts targetDiff's
          entries only (still does not touch conflicting later Diffs' non-overlapping entries),
          requires explicit confirmation naming which later operations are affected, logged to
          the audit trail with the override noted
    }
```

"Revert anyway" never silently rewrites a later operation's own `Diff` record — it overwrites the live value at the
conflicting path(s) and records a new forward `Diff` for that override, so the full sequence (X happened, Y later
touched the same field, the user explicitly force-reverted X) stays legible in both AI operation history and `Diff`
history. Nothing is deleted or rewritten in place.

## 8. Compare versions (diff-of-diffs)

Comparing two points in history (two numbered Versions, or two timestamps resolved to nearest Version + replay per
§6) computes a structural diff between two Store Configuration states, reusing the same entry-producing logic used
to create a `Diff` from a mutation — as a pure comparison, not a mutation side effect.

```
compareVersions(storeConfigurationA, storeConfigurationB) -> Diff-shaped result:
  {
    diffId: null,                     // synthetic — not persisted unless the user explicitly saves it
    storeConfigVersionId: <B's storeConfigVersionId>,
    causedBy: { type: "comparison", fromVersionId: A.configurationVersionId, toVersionId: B.configurationVersionId },
    entries: [DiffEntry],             // same kind/path/before/after/humanSummary shape as always
    createdAt: <computed at query time>
  }
```

Compare-versions recomputes a clean structural diff directly between two Store Configuration states rather than
algebraically combining intervening `Diff` records (intervening `Diff`s may include reverted/superseded ones that
shouldn't double-count). This guarantees it always reflects actual net difference, immune to history noise like an
edit-then-immediate-undo that produced two `Diff` rows but zero net change.

The comparator also supports a grouped/aggregated view for UI presentation — grouping consecutive entries by
page/section (e.g. "Home page: 1 section added, 4 settings changed across 2 sections; Product page: no changes")
— while the flat `entries` list stays available for full detail or export. This grouped view also backs the
"summary of changes since the previous Version" text in the Version History list (§4.5).

Compare-versions is read-only and side-effect-free: it never creates real `Diff`/Operation rows unless the user
takes an explicit follow-up action (e.g. "bring B's value for this field into my current draft"), which then goes
through the normal path as a fresh `editor_edit`.

## 9. AI regeneration protection

Two distinct pieces of provenance state work together here, at two different moments:

- **Field-level provenance tag** (`ai` or `user`, owned by [AI Architecture](04-ai-architecture.md)) — lives on
  each `Setting` in the Store Configuration itself. It governs what happens *next*: when an AI regeneration
  operation is resolved, only `ai`-tagged fields are eligible for regeneration by default, so a regeneration
  operation never constructs a payload that touches a field a merchant manually edited unless explicitly
  overridden. See [decision 5](DECISIONS.md).
- **`Diff.causedBy`** (§3.1) — lives on the mutation event, not the field. It records what already happened:
  `ai_operation` vs. `editor_edit` vs. `restore`, with the responsible `operationId` or `userId`. This is what lets
  Version History and the AI operation history render "AI changed this" vs. "you changed this" for any given
  `DiffEntry`, without re-deriving it from field tags.

Because regeneration is provenance-aware at the field-tag level, an AI regeneration's resulting `Diff` only
contains entries for fields that were AI-authored going in — the same `causedBy.type: "ai_operation"` marker that
distinguishes it from a manual edit also implies (by construction, in the common case) that its entries didn't
overwrite a `user`-tagged field. This is a default, not a hard guarantee independent of the checkpoint system: any
AI operation that **overwrites** existing settings/content on an already-configured section (a full regeneration,
a bulk reselection) still triggers a `pre_ai_overwrite` `ConfigurationVersion` checkpoint (§4.1) before it applies,
regardless of how carefully the field-tag filter scoped the operation. The checkpoint is the versioning system's
independent safety net beneath the provenance filter — if a regeneration ever touches more than the merchant
expected, a one-click full rollback point already exists.

An AI operation that writes a field also updates that field's provenance tag to `ai` in the same transaction as
its `Diff` (a Store Configuration-level effect, owned by [AI Architecture](04-ai-architecture.md) and
[Store Configuration](03-store-configuration.md)) — so the next regeneration's eligibility check sees current
authorship, not the authorship at generation time.

**Deferred (post-MVP):** an override variant that lets a regeneration explicitly overwrite `user`-tagged fields on
request is out of scope for MVP; only the default (AI-authored-fields-only) regeneration path ships.

## 10. Is each AI request one atomic transaction?

**Yes: one Operation Plan execution = one transaction = one `Diff` = one undo unit.**

When the user approves an Operation Plan (owned by [AI Architecture](04-ai-architecture.md)) containing one or more
Operations — e.g. "add a hero, change the accent color, and add an FAQ section" plans to three Operations — the
executor:

1. Opens one database transaction scoped to the whole plan.
2. Runs all validation ([Validation and Error Handling](17-validation-and-error-handling.md)) for every step
   against the tentative post-apply Store Configuration before committing any of them.
3. Applies every Operation to the Store Configuration in sequence within that transaction.
4. Persists one `Diff` whose `entries` is the concatenation, in execution order, of every Operation's resulting
   entries — not one `Diff` per Operation.
5. Persists one `Operation` record per step (per-operation history/audit stays granular), each pointing at the
   same shared `diffId`.
6. Commits only if the whole plan validated and applied cleanly; otherwise rolls back entirely — no partial
   application of a multi-step plan ever reaches the Store Configuration.

Rationale: the user approved one request, not N independent ones — a partial application on step-2-of-3 failure
would produce a configuration never asked for or approved. Undo granularity matches request granularity: one undo
press undoes "the thing I just asked the AI to do." A `pre_ai_overwrite` checkpoint (§4.1) is evaluated once per
plan boundary, matching the transaction boundary. Reverting one step of a multi-step plan (§7) still works at the
`DiffEntry`/path level even though several steps share a `diffId` — the UI surfaces undo at the whole-plan grain by
default and offers "revert just this one step" as a more surgical, explicitly-chosen action.

The one exception: interactive Visual Editor edits (`causedBy.type: "editor_edit"`) are not grouped this way — each
drag/drop or settings-panel commit is its own `Diff`, since these are already atomic, single-intent actions with no
planning step in front of them. Grouping into one transaction is specifically an AI Operation Plan concern.

## 11. Open questions

- **Rolling-cadence tuning (N `Diff`s / T minutes for `scheduled` checkpoints)** — Decision Required: an
  operational tuning parameter, not an architectural one; needs a concrete default before launch.
- **Snapshot retention policy per plan tier** — Decision Required: retention windows are billing-tier-dependent;
  exact tiers/windows are not finalized here.
