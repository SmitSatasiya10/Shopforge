# Phase 10 — Persistence and Projects

## Objective

Formalize the durable, versioned, multi-tenant persistence layer that everything since Phase 04 has been
writing into a minimal/session-scoped form — full `Project`/`StoreConfigVersion` lineage, permanent `Diff`
history, and ownership boundaries — now that the deterministic pipeline (01-08) and AI (09) have both proven
what needs to be persisted.

## Scope

- The full data model from [`docs/product-spec/19-data-model.md`](../product-spec/19-data-model.md): `Project`
  (not `Store` — never conflate the two), `Product`, `StoreConfigVersion`, `StoreConfigDiff`, `StoreOperation`,
  `SectionDefinition` (DB-backed catalog entry mirroring Phase 08's `catalog.json`), `OperationPlan`,
  `AIConversation`/`AIMessage`, `Asset`/`GeneratedAsset`, `PublishHistory`.
- `StoreConfigVersion` lineage: `label`, `status` (`draft|active|published|archived`), `configHash`,
  `lockVersion` (optimistic concurrency), `producedByType`
  (`ai_generation|ai_operation|editor_edit|restore`), `parentStoreConfigVersionId` (branch lineage). Exactly one
  `active` version per Project.
- Optimistic concurrency: every mutating request carries the `lockVersion` read from its last GET; the server
  does compare-and-swap (`WHERE id=? AND lock_version=?`); zero rows affected → `409 Conflict` with the current
  `lockVersion` + configuration for client-side rebase. This upgrades Phase 07's simpler in-session undo/redo
  into the full durable model.
- The permanent `Diff`/`DiffEntry` audit log from
  [`docs/product-spec/18-versioning-and-undo-redo.md`](../product-spec/18-versioning-and-undo-redo.md):
  checkpointing triggers (`ai_initial_generation`, `pre_ai_overwrite`, `manual_save`, `scheduled`,
  `pre_publish`), restore (with its own safety-net checkpoint), single-operation revert (with conflict
  detection against later overlapping Diffs), and compare-versions (diff-of-diffs).
- Ownership/multi-tenancy boundaries: `Organization -> Project -> StoreConfiguration -> {Editor|Version
  History|Publish}`, every record scoped by org/project at the data-access layer, queries filtered by the
  caller's authorized set (never trusting a client-supplied id alone) — per
  [`docs/product-spec/21-security-and-multi-tenancy.md`](../product-spec/21-security-and-multi-tenancy.md) §4.
- Roles: viewer < editor < admin < owner, enforced server-side including for AI-originated calls (§3 of the
  same document).
- `Project` explicitly does not require a connected Shopify store to exist, build, or preview — that connection
  is established only at Phase 11/12's publish flow, per
  [`docs/product-spec/DECISIONS.md`](../product-spec/DECISIONS.md) #14.

## Out of Scope

- Anything Shopify-facing (`ShopifyStore`, `ShopifyInstallation`, publish) — Phases 11/12.
- Billing/subscription tiers beyond a functional free + flat-fee split — later hardening, not this phase.
- Enterprise-scale org features (nested teams, custom role definitions) — not part of MVP's owner/editor/
  admin/viewer split.

## Architecture

```text
Organization
  |
Project (no Shopify connection required)
  |
StoreConfigVersion (lineage: parentStoreConfigVersionId, exactly one "active")
  |
StoreConfigDiff (permanent, append-only audit log)
  |
StoreOperation (the intent, distinct from Diff, the effect)
```

This phase migrates Phase 04's minimal single-row configuration storage and Phase 07's session-scoped Diff list
into this durable model without changing what any consumer (AI, editor, preview) reads/writes at the JSON-shape
level — Phase 04's `StoreConfiguration` shape is unchanged; what changes is how it's versioned, checkpointed,
and concurrency-controlled around.

## Inputs

Every write this roadmap has produced so far: Phase 02/03's `Product`, Phase 04/07's Store Configuration
(previously minimally persisted), Phase 07's session Diffs, Phase 09's `OperationPlan`s.

## Outputs

A fully versioned, multi-tenant-safe persistence layer: any Project's configuration history can be inspected,
restored, or branched, with concurrent-edit safety.

## Dependencies

Phase 04 (the JSON shape being versioned), Phase 07 (the Diff concept being formalized), Phase 09 (AI-produced
`OperationPlan`s that must now persist through this durable model, including `producedByType` provenance).

## Implementation Areas

- Full schema migration from Phase 01's minimal tables to the model in
  [`docs/product-spec/19-data-model.md`](../product-spec/19-data-model.md).
- `lockVersion` compare-and-swap on every mutating endpoint, with the `409 Conflict` + rebase-data response
  shape from [`docs/product-spec/20-api-contracts.md`](../product-spec/20-api-contracts.md).
- Checkpointing logic: which triggers create a new `StoreConfigVersion` vs. which just append a `Diff` to the
  active version.
- Restore, single-operation revert (with conflict detection), and compare-versions, per
  [`docs/product-spec/18-versioning-and-undo-redo.md`](../product-spec/18-versioning-and-undo-redo.md).
- Org/project/role scoping at the data-access layer — every query filtered server-side by the caller's
  authorized set, never by trusting a client-supplied id.
- `AuditLog` entries for auth events, role changes, and version restores (publish/rollback audit entries are
  Phase 12's concern, layered on the same `AuditLog`).

## Data Contracts

```text
Project { id, name, status, currentStoreConfigVersionId, publishedStoreConfigVersionId, shopifyStoreId?, installedThemeShopifyId? }
StoreConfigVersion { id, projectId, label, status, configuration, configHash, lockVersion, producedByType, parentStoreConfigVersionId }
StoreConfigDiff { diffId, storeConfigVersionId, causedBy, entries: DiffEntry[], createdAt }
DiffEntry { kind: "added"|"removed"|"modified"|"moved"|"renamed", path, before, after }
StoreOperation { operationType, ... }  // the intent; Diff is the effect
```

Full authoritative shapes: [`docs/product-spec/19-data-model.md`](../product-spec/19-data-model.md) and
[`docs/product-spec/18-versioning-and-undo-redo.md`](../product-spec/18-versioning-and-undo-redo.md).

## User Flow

No new end-user-visible flow required at MVP beyond what Phase 07 already built (undo/redo, save, reload) — the
user-visible difference is durability and correctness under concurrent access, plus (if the editor UI exposes
it) a version history / restore screen.

## Error Handling

- A `lockVersion` mismatch on write returns `409 Conflict` with the current state for rebase — never a silent
  overwrite of a concurrent edit, and never a hard failure that loses the user's local change (the client can
  rebase and retry).
- A restore always takes a safety-net checkpoint of current state first, so a restore is itself always
  undoable.
- A single-operation revert whose target path was touched by a later, still-standing Diff is blocked with a
  clear conflicting-operations list — never silently merged or force-applied without explicit confirmation.
- `Diff` rows are never deleted, including after undo — the audit log stays honest; a new edit after undo
  invalidates (does not delete) the redo tail.

## Testing

- Concurrency tests: two concurrent writes to the same `StoreConfigVersion`, confirming the second correctly
  receives `409 Conflict` rather than silently clobbering the first.
- Checkpoint-trigger tests: each trigger (`ai_initial_generation`, `pre_ai_overwrite`, `manual_save`,
  `scheduled`, `pre_publish`) creates a new version at the right time and not otherwise.
- Restore tests: restoring an older version creates a safety-net checkpoint, correctly marks superseded AI
  operations, and is itself undoable.
- Revert-conflict tests: reverting an operation whose path was later modified is blocked with the correct
  conflict list; force-revert works and is logged.
- Tenant-isolation tests: a caller scoped to one org/project can never read or write another's data, even with
  a guessed/enumerated id.
- Role-enforcement tests: each of viewer/editor/admin/owner's permitted and forbidden actions, including
  AI-originated calls attempting an action the requesting user's role forbids.

## Completion Criteria

- Every write path from Phases 04, 07, and 09 now persists through this durable model with no behavior change
  visible to those phases' own consumers.
- Concurrent-edit safety is proven under test.
- Version restore, revert, and compare-versions all work correctly.
- Org/project/role isolation is proven under test, not just implemented.

## Next Phase

[11 — Shopify Integration](11-shopify-integration.md) is the first phase requiring real Shopify API access,
building on this phase's `Project` and `StoreConfigVersion` model to attach a real connected store.
