# 14. Diff & Versioning System

Status: proposed design
Depends on: doc 08 (Store Configuration Schema), doc 11 (AI Generation & Editing Operation System), doc 15 (Validation System), doc 16 (Shopify Integration/Publishing)
Owned by: this doc is the canonical source of truth for the Diff schema's full field docs and for all undo/redo, history, snapshot, restore, revert, and compare semantics. Other docs reference this one; they do not redefine these terms.

---

## 1. Purpose

Shopforge's core promise is that every AI or editor change to a merchant's store is **safe, traceable, and reversible**. This document specifies the mechanism that makes that promise real, for the one artifact the whole product revolves around: the **Store Configuration** — the JSON document (doc 08) shaped `pages` → keyed by page → `sections`: an ordered array of `{ id, type, settings, blocks? }`, produced by AI Generation (doc 11), edited in the Visual Editor, rendered by the LiquidJS Preview Renderer (doc 09), and ultimately published (doc 16) onto the merchant's real Shopify store using our fixed Base Theme and Section Library (doc 07).

- Every mutation to the Store Configuration — whether it comes from an AI Operation (doc 11) or a direct Visual Editor edit — produces a `Diff`.
- Diffs are the atomic unit of history. They are reversible by construction — every `DiffEntry` carries enough information to undo itself.
- `ConfigurationSnapshot`s are periodic full-document backups that bound how far a Diff-by-Diff replay ever has to reach back, and that back the user-facing "Version History" timeline described in §5.
- Persisted `Operation` records (doc 11) give AI history a queryable, per-draft audit trail independent of the Diff stack.

Because the Store Configuration is *data* — a JSON document describing which fixed sections appear, in what order, with what settings — rather than arbitrary theme files, everything in this document is simpler than an equivalent system for arbitrary Liquid/CSS/JS would need to be: a `DiffEntry` never has to represent "12 lines of a Liquid file changed," only "this settings key changed from X to Y" or "this section moved from position 3 to position 1."

---

## 2. The Diff schema, in full

```
Diff {
  diffId: string
  configurationVersionId: string
  causedBy: { type: "ai_operation"|"editor_edit"|"restore"|"comparison", operationId?: string, userId?: string }
  entries: [DiffEntry]
  createdAt: timestamp
}

DiffEntry {
  kind: "added" | "removed" | "modified" | "moved" | "renamed"
  path: string            // path into the Store Configuration, e.g. "pages.home.sections[id=hero-1].settings.background_color"
  before?: any
  after?: any
  humanSummary: string    // "Hero background changed from #ffffff to #111827"
}
```

### 2.1 Field-by-field semantics

**`Diff.diffId`**
Globally unique, monotonically sortable within a `configurationVersionId` (e.g. ULID/KSUID, not a bare auto-increment, so ordering survives concurrent writers — the AI pipeline and the Visual Editor can both be producing Diffs against the same draft in quick succession). This is the primary key used everywhere a diff needs to be addressed individually: undo stack entries, revert targets, compare-versions inputs.

**`Diff.configurationVersionId`**
Every Diff belongs to exactly one **draft lineage** of the Store Configuration — the ongoing working copy a merchant is building up for their store (or for one page, if drafts are scoped per-page; see doc 08 for the authoritative scoping). A Diff never spans two draft lineages. If a draft is forked (e.g. "try an alternate layout as a duplicate"), its Diff history starts fresh, anchored at the source `ConfigurationSnapshot` — see §5.

**`Diff.causedBy`**
The provenance envelope:
- `{ type: "ai_operation", operationId }` — this Diff resulted from executing one `Operation` (doc 11). `operationId` is a foreign key to the persisted `Operation` record, which is how AI Operation History (§4) and Diff history cross-reference.
- `{ type: "editor_edit", userId }` — this Diff resulted from a direct Visual Editor mutation (drag-to-reorder, settings-panel field change, publish click) with no `Operation` behind it.
- `{ type: "restore", userId }` — this Diff represents a restore-to-a-previous-version action (§6). Kept distinct from a plain `editor_edit` because it's a batch action over many paths at once, not a single field edit, and the UI/history should render it distinctly ("restored to Version 2" rather than a list of individual field changes).
- `{ type: "comparison", fromSnapshotId, toSnapshotId }` — synthetic, never persisted as real history; produced only by compare-versions (§9).

This field is what lets the UI render "AI changed this" vs. "you changed this" vs. "this was a restore" without a separate lookup, and is what the revert-conflict logic (§7) uses to decide whose intent is being reverted.

**`Diff.entries`**
An ordered list of `DiffEntry`. Order matters for structural operations where sequencing is semantically meaningful (e.g. removing a section at index 2 and then the reorder of the remaining array — replaying entries out of order could target the wrong section). One `Operation` (doc 11) may touch several paths in the Store Configuration — e.g. adding a section writes both the new section object and the page's `sections` order — so it is normal for one `Operation` to produce a `Diff` with 2+ entries. This is exactly why **one Operation Plan step = one Diff**, not one `DiffEntry` (see §8).

**`Diff.createdAt`**
Server timestamp at commit time (not client submit time — for AI operations there can be real generation latency between "user approved the plan" and "the Diff was actually applied"). Used for ordering in history views and as the natural axis for compare-versions time-range queries.

**`DiffEntry.kind`**

| kind | meaning | `before` | `after` |
|---|---|---|---|
| `added` | path did not exist before, exists now | absent/undefined | the new value |
| `removed` | path existed before, does not exist now | the old value | absent/undefined |
| `modified` | path exists in both, value changed | old value | new value |
| `moved` | same value(s), different position — a section or block reordered within its parent array | old ordered list of ids | new ordered list of ids |
| `renamed` | same entity, different `id` (rare — e.g. duplicating a section assigns it a fresh `id`, but the operation wants to express "this is conceptually the same edit lineage as the source section") | old `id` | new `id` |

`moved` and `renamed` are kept distinct from `modified` because their reversal and their `humanSummary` rendering differ (a move restores position; a modification restores value), and because "compare versions" (§9) should be able to say "sections were reordered" separately from "settings changed."

**`DiffEntry.path`**
A dot-path into the Store Configuration (doc 08), always rooted at a stable identifier for array entries — a section's or block's `id` field, never a bare array index — because array indices shift under reordering but `id`s don't. The one exception is the array itself as a whole: when the change being recorded *is* the order (an entry added, removed, or reordered within a `sections` or `blocks` array), the path addresses the containing array, and `before`/`after` are the array's ordered list of `id`s.

Path examples:
- `pages.home.sections[id=hero-1].settings.background_color`
- `pages.home.sections[id=hero-1].blocks[id=blk-42].settings.label`
- `pages.home.sections` (whole-array entry, used for the `kind: "moved"` entry that captures a section being inserted, removed, or reordered — see §2.4)
- `pages.product.sections[id=faq-1].blocks[id=blk-7].settings.answer`
- `pages.home.sections[id=hero-1].type` (rare — only ever appears in a `renamed`-adjacent scenario or a validation-driven correction; sections normally never change `type` in place, since changing what a slot renders is modeled as remove-and-add, not a type mutation)

Path is what §7 (revert-conflict detection) and doc 15's data-contract checks use to determine whether two Diffs touched the same thing, and it is deliberately shaped to match doc 08's own addressing scheme so the two docs stay consistent without restating each other's schema.

**`DiffEntry.before` / `DiffEntry.after`**
Full values, not sub-diffs — even for object-valued settings (e.g. a `blocks` array replacement, or a compound setting object), we store the complete before/after value rather than a nested patch. This is a deliberate simplicity-over-compactness tradeoff: it makes every `DiffEntry` independently reversible (`apply(after)` / `apply(before)`) without a patch-merge library, and it makes `humanSummary` generation straightforward. The cost (larger stored payloads for a full `blocks` array replacement) is accepted because Store Configuration values are inherently small — individual settings and content strings, never files, never rendered markup, never binary data. See §2.2 for what is explicitly kept out of a Diff to keep this true.

**`DiffEntry.humanSummary`**
A pre-rendered, human-readable one-liner, generated at Diff-creation time (not at display time) so history stays stable and readable even if the underlying section's setting label is later relabeled in the Section Library (doc 07) — old history should still read the way it did when it happened. Examples:
- `"Hero background changed from #ffffff to #111827"`
- `"Added 'Featured Collection' section to Home page (position 3)"`
- `"Removed 'Star Rating' block from Product Reviews section"`
- `"Moved 'Newsletter' section from position 5 to position 2 on Home page"`
- `"AI regenerated FAQ answers (4 blocks updated)"` — for AI content-regeneration operations that rewrite several settings/content values at once, the summary is generated from the operation's stated intent, not mechanically enumerated field-by-field, since a merchant cares about "what did the AI do" more than a raw list of four string diffs.

### 2.2 What a Diff does NOT contain

A Diff never embeds:
- The full Store Configuration document. Full document state lives in a `ConfigurationSnapshot` (§5); a Diff only carries the paths that actually changed.
- Any Liquid, CSS, or JS source. There is none to carry — Section Library templates (doc 07) are fixed, hand-authored source code, never generated or modified by an AI Operation or a Diff. A Diff can change *which* fixed section a slot uses and *what settings/content* it's given, never the section's own template code.
- Rendered HTML/output from the Preview Renderer (doc 09). The Diff records configuration state, not render results; if you need to see what a change looked like, you re-render the configuration at that point, you don't replay a cached render.
- Binary asset bytes. An asset-valued setting (e.g. `settings.image`) stores a reference/URL to an entry in the store's asset or Product Data store, never the image bytes themselves — so `before`/`after` for an image-setting `DiffEntry` are small reference strings, not files.

This keeps every Diff small and uniform regardless of what kind of setting changed, and keeps "restore full version" (§6) and "revert one operation" (§7) using two appropriately-sized data paths: Snapshots for full-document recovery, Diffs for surgical, field-level reversal.

### 2.3 Worked example: hero background color change

User asks the AI to "make the hero background darker," or drags the same color picker themselves in the Visual Editor's settings panel. Either path produces a structurally identical Diff — this is deliberate: the Visual Editor and the AI Operation system write through the exact same mutation path into the Store Configuration, so undo/redo and history treat them uniformly (§3).

If it came from an AI Operation, the (doc 11-owned) Operation looks something like:

```
Operation {
  opId: "op_9f3a"
  type: "update_setting"
  target: { pageKey: "home", sectionId: "hero-1", settingKey: "background_color" }
  payload: { value: "#111827" }
}
```

Executing it against the Store Configuration produces:

```
Diff {
  diffId: "diff_01J8X...7Q"
  configurationVersionId: "cfg_store42_draft"
  causedBy: { type: "ai_operation", operationId: "op_9f3a" }
  entries: [
    {
      kind: "modified",
      path: "pages.home.sections[id=hero-1].settings.background_color",
      before: "#ffffff",
      after: "#111827",
      humanSummary: "Hero background changed from #ffffff to #111827"
    }
  ]
  createdAt: "2026-08-19T14:02:11.340Z"
}
```

### 2.4 Worked example: add + reorder (multi-entry Diff from one Operation)

An AI Operation adds a "Featured Collection" section at position 3 on the Home page, which currently has 4 sections. This is one `Operation`, but two paths in the Store Configuration change: the new section object appears, and the Home page's `sections` order changes to include it.

```
Diff {
  diffId: "diff_01J8X...9B"
  configurationVersionId: "cfg_store42_draft"
  causedBy: { type: "ai_operation", operationId: "op_9f41" }
  entries: [
    {
      kind: "added",
      path: "pages.home.sections[id=featured-collection-2]",
      before: undefined,
      after: { id: "featured-collection-2", type: "featured-collection", settings: { ... }, blocks: [] },
      humanSummary: "Added 'Featured Collection' section to Home page"
    },
    {
      kind: "moved",
      path: "pages.home.sections",
      before: ["hero-1", "rich-text-1", "product-grid-1", "footer-cta-1"],
      after:  ["hero-1", "rich-text-1", "featured-collection-2", "product-grid-1", "footer-cta-1"],
      humanSummary: "Inserted 'Featured Collection' at position 3 of 5 on Home page"
    }
  ]
  createdAt: "2026-08-19T14:05:47.812Z"
}
```

Reversal of this Diff is: remove `pages.home.sections[id=featured-collection-2]`, then restore `pages.home.sections` to `before`. Reversal walks entries in reverse order — this is why entry order is meaningful (§2.1).

---

## 3. Undo / redo (in-session)

Undo/redo operates purely on the **Diff stack** for the current editing session — it is not a separate mechanism from the persisted Diff history, it's a cursor into it.

```
UndoState {
  configurationVersionId: string
  cursor: number          // index into the session's ordered Diff list; points at "last applied"
  diffs: [diffId]         // ordered, session-scoped view
}
```

- **Undo**: reverse-apply the `Diff` at `cursor` to the Store Configuration (walk `entries` in reverse order, set each `path` to `before`), decrement `cursor`. Does not delete the `Diff` row — it stays in persisted history (§4), so history remains an honest audit log.
- **Redo**: re-apply the `Diff` at `cursor + 1` forward (`entries` in original order, set each `path` to `after`), increment `cursor`.
- **New edit after undo**: if the user undoes 2 steps and then makes a new edit, the redo tail (the undone-but-not-yet-overwritten Diffs) is invalidated for redo purposes but **not deleted** from the persisted `Diff` table — it simply falls off the redo stack. The new edit gets appended after `cursor`.

Undo/redo is **not** implemented as "restore the previous `ConfigurationSnapshot`" — that would be correct but wasteful and would lose granularity (undoing one setting change shouldn't roll back everything since the last snapshot). It's an in-place reverse-application of one `Diff`'s entries. This only works because every `DiffEntry.before` is a complete value (§2.1), so reversal never needs to consult anything outside the Diff itself.

Undo/redo is scoped to the current draft's working copy and is available uniformly for both editor edits and AI operations, because both produce the same `Diff` shape (§2.3).

---

## 4. AI operation history (persisted, queryable per draft)

The persisted `Operation` record (doc 11 owns its full schema) is the durable form of one AI Operation actually executed — not of every plan step proposed then rejected; rejected plan steps are never persisted as an executed `Operation`, only as part of the Operation Plan record for audit-of-what-was-suggested purposes. The fields Diff/Version history depends on:

```
Operation record (persisted, fields relevant to this doc — full schema owned by doc 11):
  opId, type, target, payload            // doc 11
  configurationVersionId: string
  operationPlanId: string          // the Operation Plan this step belonged to
  diffId: string                   // the Diff this operation produced (1:1)
  status: "applied" | "reverted" | "superseded"
  executedAt: timestamp
  executedBy: userId               // who approved execution — AI acts on behalf of a user, never autonomously
  validationResult: ValidationSummary   // doc 15 — pass/warn detail, retained for audit
```

This gives two independent, complementary views over the same underlying facts:
- **Diff history** (§2–3): "what changed, in what order, how do I reverse it" — optimized for undo/redo and restore.
- **AI operation history**: "what did the AI do, when, as part of which plan, at what validation outcome" — optimized for the History panel UI and audit correlation.

Queryable per draft, filterable by `status`, `type`, date range, and `operationPlanId` (to see "everything this one AI request did" as a group — see §8).

---

## 5. Configuration Versions & Snapshots

A `ConfigurationSnapshot` is a full-document backup of the Store Configuration at a point in time. Snapshots exist so that (a) undo/Diff-reversal never has to replay an unbounded history to reconstruct state, and (b) "restore to an earlier point" and "compare two versions" have a cheap, correct ground truth to diff against, instead of replaying the entire Diff log from the draft's creation. Snapshots are also what backs the user-facing **Version History** timeline — the numbered "Version 1 / Version 2 / ..." list a merchant sees when they open history for their store.

```
ConfigurationSnapshot {
  snapshotId: string
  configurationVersionId: string
  versionNumber: integer          // sequential, user-facing: "Version 1", "Version 2", ...
  reason: "ai_initial_generation" | "pre_ai_overwrite" | "manual_save" | "scheduled" | "pre_publish"
  storeConfiguration: object      // full Store Configuration JSON at this point (doc 08 shape)
  status: "draft" | "published"
  createdAt: timestamp
  createdByDiffId: string | null  // the last Diff applied before this snapshot was taken, null if this is the baseline (first AI generation)
}
```

### 5.1 What "Version N" means

Not every Diff produces a new numbered Version — that would make the history list as noisy as the raw Diff log, defeating its purpose as a human-scannable timeline. A new `ConfigurationSnapshot` (and therefore a new "Version N") is taken at the checkpoints in §5.2: on the initial AI generation, before an AI operation that overwrites existing settings/content, on explicit user save, on a rolling schedule, and immediately before publish. Diffs between checkpoints still accumulate and are still individually undoable/revertible (§3, §7) — the numbered Version list is a *view* over the Diff+Snapshot history, not a replacement for it. The "Version History" UI shows each numbered Version's timestamp, `reason`, and a rolled-up human summary of the Diffs since the previous Version (using the same grouped-summary logic as compare-versions, §9).

### 5.2 Worked example: version history for a new store build

A merchant imports a product, and the system runs Product Import → AI Generation → Section Selection → Ordering → Settings, producing an initial Store Configuration. The merchant then makes a couple of edits, asks the AI for one more change, and publishes.

| Version | What happened | `causedBy` | Diff summary | Snapshot `reason` | `status` |
|---|---|---|---|---|---|
| 1 | Initial AI Generation completes: Section Selection, Ordering, and Settings/Content generation produce a full Home + Product page configuration from the imported Product Data | `ai_operation` (the initial generation's Operation Plan) | Home page: 5 sections added, fully configured. Product page: 4 sections added, fully configured. | `ai_initial_generation` | draft |
| 2 | User edits the Hero heading text and background color in the Visual Editor | `editor_edit` | 2 settings changed on `pages.home.sections[id=hero-1]` | `manual_save` (user explicitly saved after editing) | draft |
| 3 | User drags the Testimonials section above Features on the Home page | `editor_edit` | `pages.home.sections` reordered (1 `moved` entry) | `scheduled` (rolling checkpoint, no explicit save) | draft |
| 4 | User asks the AI to "make the FAQ answers punchier"; the AI regenerates the FAQ section's block content | `ai_operation` | 4 settings changed across `pages.home.sections[id=faq-1].blocks[*].settings.answer` | `pre_ai_overwrite` (taken before the regeneration applied, since it replaces existing content) | draft |
| 5 | User clicks Publish | `editor_edit` (publish is always a deliberate user action, never silently AI-initiated) | none — the Store Configuration content is unchanged from Version 4; this checkpoint marks the publish event and flips `status` | `pre_publish` | **published** |

After Version 5, the draft continues: any further edits accumulate as new Diffs against the same `configurationVersionId`, and the *next* checkpoint (e.g. the merchant's next save) becomes Version 6, still `draft` status, while Version 5 remains the record of what is currently live. This is how draft state and published state coexist: `status: "published"` marks the specific Version currently reflected on the real Shopify store; every later Version is draft until the merchant publishes again, at which point a new Version is stamped `published` and the previous published Version simply becomes a historical entry (still restorable, per §6).

### 5.3 When is a snapshot taken

| Trigger | Reason value | Rationale |
|---|---|---|
| Initial AI Generation completes and produces the first Store Configuration for a draft | `ai_initial_generation` | This is the baseline every later Diff/Snapshot builds on, and the point a merchant most often wants to "start over from" if later edits go sideways. |
| Before executing an AI Operation that **overwrites** existing settings/content on an already-configured section (a regeneration, a bulk reselection, or removal of a section that already has merchant edits on it) | `pre_ai_overwrite` | This is the one category of AI action that can destroy merchant-made edits the AI has no way to individually reverse via a single Diff (e.g. a full section regeneration touches many settings at once) — guarantees a one-click full rollback point exists before it runs. Purely additive AI operations (add a section, reorder sections) don't need this, since their own Diff is already fully self-reversing. |
| On explicit user "Save" action in the editor | `manual_save` | User-declared checkpoints the merchant will recognize and want to return to by name/timestamp, independent of what the AI was doing. |
| On a rolling cadence (e.g. every N applied Diffs or every T minutes of active editing, whichever comes first — exact N/T are an operational tuning parameter, not an architectural one) | `scheduled` | Bounds the maximum Diff-replay distance for any reconstruction path, and covers sessions with many small edits and no explicit save or AI-overwrite trigger. |
| Immediately before a Publish operation (doc 16) writes the configuration to the live Shopify store | `pre_publish` | The single most important rollback point operationally — "what did the live store look like right before this went out" must always be a one-step restore, and this is the checkpoint that flips `status` to `published` (§5.2). |

Snapshots are never taken *instead of* Diffs — every mutation still produces a Diff regardless of whether a snapshot was also taken at that moment. Snapshots and Diffs are complementary: Diffs give granularity, Snapshots give bounded-cost full recovery and back the numbered Version timeline.

### 5.4 Draft state vs. published state

At any time, a store has exactly one Store Configuration draft lineage (`configurationVersionId`) actively accumulating Diffs, and at most one `ConfigurationSnapshot` within it marked `status: "published"` — the Version currently reflected on the live Shopify store. Publishing (doc 16) is the only action that changes which Version holds that mark; editing never does, even if the merchant is editing "on top of" a published state. This means:

- The Visual Editor always works against the current draft, never directly against what's live — so mid-edit states are never accidentally visible on the merchant's real storefront.
- "What's different between my draft and what's actually live" is always answerable as a compare-versions call (§9) between the current draft state and the Version currently marked `published`, and is the basis for a "you have unpublished changes" indicator in the editor.
- Publish history — every Version that was ever marked `published`, in order, with timestamps — is retained indefinitely regardless of snapshot retention rules (§5.5), since it is the audit trail doc 16 needs for "what has actually been live, and when."

### 5.5 Snapshot retention

Snapshots are retained per plan tier (a billing/doc 22 concern), but `pre_publish` and `manual_save` snapshots are never subject to automatic garbage collection — only `scheduled` and superseded `pre_ai_overwrite` snapshots (ones with no Diffs referencing them as a restore target within the retention window) are eligible for pruning, and pruning always keeps at least one snapshot per calendar day for the lifetime of the retention window, so "restore to roughly last week" never has gaps.

---

## 6. Restore-previous-version flow

"Restore" means: make the current draft's Store Configuration match a target `ConfigurationSnapshot` (i.e. a specific numbered Version, §5.1) exactly, discarding — but not deleting — everything in between.

```
Restore flow:
1. User selects a target: either a numbered Version directly (from the Version History list — reason,
   timestamp, and human summary of nearby Diffs), or a point in time (resolved to the nearest Version
   at or before that time).
2. System takes a NEW ConfigurationSnapshot of the current draft state first, reason: "manual_save"
   (safety net — restoring is itself reversible; you can "undo an undo of everything").
3. The draft's Store Configuration is replaced wholesale with target.storeConfiguration.
4. A new Diff is generated representing the restore itself:
   Diff.causedBy = { type: "restore", userId }
   Diff.entries = [ one DiffEntry per top-level path that differs between the pre-restore and
     post-restore Store Configuration, kind derived per-path, humanSummary: "Restored to Version 2
     (Aug 19, 2:15pm)" as a batch label plus per-entry detail available on expand ]
5. All Operation records executed after the target Version are marked status: "superseded" (not
   deleted — the audit trail is preserved).
6. The restored draft passes through Configuration/Section/Settings validation (doc 15 layers 1-3) as
   a sanity check — restoring from a Version that was itself valid when created should always pass,
   but this guards against a restore target referencing a section type that has since been removed
   from the Section Library (doc 07), surfacing that as a clear warning rather than a silent gap.
7. Audit entry recorded: actor, target Version, timestamp, reason if user supplied one.
```

Restoring only affects the **draft**. If the target Version being restored to was itself the currently `published` one (or an earlier one), the live Shopify store is *not* touched until the merchant explicitly publishes again — restore is a draft-only, always-safe action; publish is the separate, deliberate action that pushes the draft (restored or not) to Shopify, and goes through the full doc 15 pipeline including Shopify and Publish validation at that time.

Restoring targets a **whole numbered Version**, not an arbitrary `Diff` — arbitrary-Diff-point restore is achievable by picking the nearest Version before that Diff and then forward-replaying the remaining Diffs up to that point, which the UI can offer as "restore to this exact change" while internally implementing it as snapshot + replay. This keeps the restore mechanism single-pathed (always snapshot-based under the hood) while still exposing Diff-level precision to the user.

---

## 7. Revert a single AI operation (even with later operations on top)

This is the hardest case in the system: the user wants to undo *one* AI operation from a few steps ago, without losing what happened after it.

### 7.1 Mechanism

Reverting `Operation` X means: apply the inverse of `Diff` X's entries (`after → before`, same reversal logic as undo, §3) directly to the **current** Store Configuration, not to the state at the time X was applied.

### 7.2 The conflict case

If a later operation Y (or a later editor edit) also touched a `path` that X's Diff entries cover, naive reversal is unsafe: setting that path back to X's `before` could silently discard Y's change, or produce a value Y never intended to sit alongside (e.g. X set `hero-1.settings.background_color`, Y later set `hero-1.settings.heading_color` to stay readable against that exact background — reverting only the background leaves a bad-contrast combination Y's author never chose).

**Decision: detect the conflict and block with a clear warning; do not attempt an automatic merge.**

Rationale:
- A correct automatic merge over structured settings values (not text) requires per-field-type merge semantics (color vs. enum vs. array-of-blocks vs. nested object) that don't have an obviously "safe" resolution in the general case.
- A silent or semi-automatic merge that gets it wrong directly violates the core promise ("safe, traceable, reversible") worse than simply refusing — an incorrect auto-merge is a new bug introduced by the revert feature itself, and the user may not notice until much later.
- Blocking with a clear, specific warning keeps the system's behavior easy to reason about and easy to explain in the UI ("The hero was changed again after this, by a later edit — revert anyway and lose that later change too? / Cancel").
- Merge-on-conflict remains a viable future direction once there's real usage data on how often this conflict actually occurs and what shapes of conflicting edits are common enough to justify hand-written per-type merge rules.

### 7.3 Conflict detection algorithm

```
revertOperation(configurationVersionId, operationId):
  targetOp = lookup Operation record by operationId
  targetDiff = lookup Diff by targetOp.diffId
  targetPaths = set of targetDiff.entries[*].path

  laterDiffs = all Diffs for configurationVersionId where createdAt > targetDiff.createdAt
                 AND causedBy != this same revert lineage (avoid self-conflict on repeated reverts)

  conflictingDiffs = laterDiffs where any entry.path intersects targetPaths
                      // path intersection includes prefix containment, e.g. a later "removed" of
                      // pages.home.sections[id=hero-1] (whole section) conflicts with an earlier
                      // entry at pages.home.sections[id=hero-1].settings.background_color (a sub-path)

  if conflictingDiffs is empty:
    apply inverse of targetDiff.entries to the current Store Configuration
    create new Diff, causedBy: { type: "editor_edit", userId }, entries reflecting the reversal,
      humanSummary per entry: "Reverted: <original humanSummary>"
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
          entries), and requires an explicit confirmation naming exactly which later operations will
          be affected, logged to the audit trail with the override explicitly noted
```

"Revert anyway" still never silently rewrites the later operation's own Diff record — it only overwrites the live Store Configuration value at the conflicting path(s) and records a new forward Diff for that override, so the full history (X happened, then Y happened and touched the same field, then the user explicitly chose to force-revert X anyway) remains completely legible in both AI operation history and Diff history. Nothing is deleted or rewritten in place.

---

## 8. Is each AI request one atomic transaction?

**Yes — recommended and specified as: one Operation Plan execution = one transaction = one Diff = one undo unit.**

Concretely: when the user approves an Operation Plan (doc 11) containing one or more `Operation`s — e.g. "add a hero, change the accent color, and add an FAQ section" might plan to three `Operation`s — the executor:

1. Opens one database transaction scoped to the whole plan.
2. Runs all validation (doc 15) for all steps against the tentative post-apply Store Configuration before committing any of them.
3. Applies all `Operation`s to the Store Configuration in sequence within that transaction.
4. Persists **one `Diff`** whose `entries` is the concatenation, in execution order, of every individual `Operation`'s resulting entries (not one Diff per Operation).
5. Persists one `Operation` record per step (so per-operation history/audit stays granular — §4), each pointing at the same shared `diffId`.
6. Commits the transaction only if the whole plan validated and applied cleanly; otherwise rolls back entirely — no partial application of a multi-step plan ever reaches the Store Configuration.

### Justification

- **Atomicity matches user intent.** The user approved one request ("do these three things"), not three independent requests. If step 2 of 3 fails validation, applying steps 1 and 3 anyway produces a configuration the user never asked for and never approved — a silent partial success is more dangerous than a clean full failure.
- **Undo granularity matches request granularity.** One undo press should undo "the thing I just asked the AI to do," not require three separate undo presses, and should never land on a half-executed intermediate state that was never a real, user-approved configuration.
- **It composes correctly with §5 snapshotting.** "Before any overwrite-risk operation" (§5.3) is evaluated once per plan (at the plan boundary), not per individual `Operation` inside the plan — so a single snapshot brackets the whole atomic unit, matching the transaction boundary.
- **It composes correctly with §7 revert.** Reverting "operation X" where X was one step of a multi-step plan reverts only that step's entries within the shared Diff, via the same path-based mechanism — the shared `diffId` doesn't prevent per-Operation reversal because conflict detection and inversion both operate at the `DiffEntry`/path level, not at the whole-Diff level. (The UI, however, always surfaces undo at the whole-plan/whole-Diff grain by default, and offers "revert just this one step" as the more surgical, explicitly-chosen action from AI operation history — this is a UX default, not a system limitation.)
- **Failure handling stays simple.** A validation failure mid-plan (doc 15) triggers the plan's Clarification/re-plan flow (doc 11/13) rather than the system needing to explain "2 of your 3 requested changes were applied, 1 wasn't."

The one deliberate exception: interactive, incremental editor edits (`causedBy.type: "editor_edit"`) are **not** grouped this way — each individual drag/drop or settings-panel field commit is its own `Diff`, because those are already atomic, single-intent user actions with no planning step in front of them. Grouping-into-one-transaction is specifically an AI-Operation-Plan concern.

---

## 9. Compare versions (diff-of-diffs)

Comparing two points in history (two numbered Versions, or two arbitrary timestamps resolved to nearest Version + replay as in §6) means computing a **structural diff between two Store Configuration states**, which is exactly the same entry-producing logic used to create a `Diff` from a mutation — reused here as a pure comparison function rather than a mutation side-effect.

```
compareVersions(storeConfigurationA, storeConfigurationB) -> Diff-shaped result:
  {
    diffId: null,                  // synthetic — not persisted as a real history Diff unless the user
                                    // explicitly saves the comparison
    configurationVersionId: <B's configurationVersionId>,
    causedBy: { type: "comparison", fromSnapshotId: A.snapshotId, toSnapshotId: B.snapshotId },
    entries: [DiffEntry],          // same kind/path/before/after/humanSummary shape as always
    createdAt: <computed at query time>
  }
```

This is "diff-of-diffs" in the practical sense the product needs: rather than trying to algebraically combine the intervening `Diff` records (unnecessary complexity — intervening Diffs may include reverted/superseded ones, per §3/§6/§7, that shouldn't double-count), compare-versions recomputes a clean structural diff directly between the two Store Configuration states, using the identical `DiffEntry`-producing comparator that normal mutations use. This guarantees compare-versions always reflects *actual net difference*, immune to history noise like an edit-then-immediate-undo that produced two Diff rows but zero net change.

The comparator additionally supports a **grouped/aggregated view** for UI presentation — grouping consecutive `entries` by page/section for a human-scannable summary (e.g. "Home page: 1 section added, 4 settings changed across 2 sections; Product page: no changes") — but the underlying flat `entries` list is always available for full detail or export. This grouped view is also what backs the "summary of Diffs since the previous Version" text shown in the Version History list (§5.1).

Compare-versions is read-only and side-effect-free: it never creates real `Diff`/`Operation` rows unless the user takes an explicit follow-up action (e.g. "bring B's value for this one field into my current draft," which then goes through the normal path as a fresh `editor_edit`).

---

## 10. Summary diagram

```
                         ┌─────────────────────────────┐
                         │        Operation Plan         │
                         │   Operation[] (1..N steps)     │
                         └───────────────┬───────────────┘
                                         │  doc 15 validation (ALL steps)
                                         ▼
                         ┌─────────────────────────────────┐
    pre_ai_overwrite /   │        ONE transaction:           │
    ai_initial_generation│  apply Operation[] to Store Config │
    Snapshot taken       │  → ONE Diff (concatenated entries) │
    before this begins   │  → N Operation records              │
                         └───────────────┬───────────────────┘
                                         │
                     ┌───────────────────┼───────────────────┐
                     ▼                   ▼                   ▼
              Undo/Redo stack      AI Operation History   Diff/version history
              (session cursor       (queryable per draft,   (Diff table,
               over Diff list)      per Operation Plan)      ConfigurationSnapshot
                                                              table → numbered
                                                              Version History)
                                                                   │
                        ┌──────────────────────────────────────────┤
                        ▼                        ▼                 ▼
                Restore (snapshot +      Revert single op    Compare versions
                replay to a point)       (conflict check →    (structural diff
                                          block+warn if        between two
                                          later op overlaps)   Store Config states)
                                                                   │
                                                                   ▼
                                                          Publish (doc 16) → flips
                                                          status: "published" on the
                                                          current Version, starts a
                                                          new draft-only tail
```

---

## Future / Advanced Architecture

Everything above assumes the mutable artifact is always the Store Configuration — structured settings and content referencing our fixed, hand-authored Section Library (doc 07). An earlier design direction explored a heavier system for an AI that could parse an arbitrary, unknown merchant theme into a full model of its files and generate new Liquid/CSS/JS to mutate it directly. That direction is out of scope for MVP, but two pieces of its thinking are worth preserving here briefly rather than discarding, in case a future "arbitrary theme" or "AI-generated section" mode is ever built on top of this foundation:

- **File-level diffing.** A `DiffEntry` representing a change to an actual Liquid/CSS/JS file would need `before`/`after` to carry unified-diff text (not full file contents) against a content-addressed file store, distinct from the small structured-value `before`/`after` this doc specifies. The `kind`/`path`/`humanSummary` envelope here would still apply; only the payload shape for that one entry type would need to grow.
- **Regression-scope checking.** A mechanism that cross-checks every `DiffEntry.path` produced by a mutation against that mutation's *declared* scope, hard-blocking anything that touched a path outside it — valuable when a mutation can generate free-form code with unpredictable side effects (e.g. a generated CSS change accidentally touching an unrelated shared class). With a fixed Section Library, the blast radius of any one `Operation` is already bounded by construction (it can only touch the settings/content of sections it explicitly targets), so this check is not needed for MVP — but the same path-based technique described in §7's conflict detection could be extended into a similar scope-enforcement pass if arbitrary code generation is reintroduced later.
