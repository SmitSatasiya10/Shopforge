import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@/app/generated/prisma/client";

// A burst of edits within this window collapses into one ProjectVersion row (editCount++);
// an idle gap longer than this starts a fresh row. Mirrors the editor's "recent changes" panel
// grouping (see docs/product-spec/18-versioning-and-undo-redo.md §4.1's "scheduled" checkpoint,
// simplified here to whole-state snapshots with no field-level Diff).
const CHECKPOINT_GAP_MS = 5 * 60 * 1000;

interface CheckpointInput {
  // Accepts a plain read-back `Prisma.JsonValue` (which types `null` as a theoretical member)
  // as well as a fresh `InputJsonValue` — `configurationJson` is a required column and is never
  // actually null in practice, so callers don't need to cast at the call site.
  configurationJson: Prisma.JsonValue;
  productTitle?: string | null;
}

// Called after every successful autosave (configuration or product title PATCH) to keep the
// history panel's checkpoint list up to date. Best-effort: callers should not fail the autosave
// if this throws.
export async function recordCheckpoint(projectId: string, snapshot: CheckpointInput) {
  await prisma.$transaction(async (tx) => {
    // Two autosaves for the same project can fire back-to-back (e.g. React Strict Mode's
    // double-effect invocation in dev, or the config and product-title autosaves landing close
    // together) and race the read-then-write below — both reading "no recent row" and each
    // creating their own, defeating the batching this function exists for. An advisory lock
    // scoped to the transaction and keyed by projectId serializes them without a schema change.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${projectId}))`;

    const latest = await tx.projectVersion.findFirst({
      where: { projectId },
      orderBy: { updatedAt: "desc" },
      select: { id: true, updatedAt: true, editCount: true },
    });

    const withinBatchWindow = latest && Date.now() - latest.updatedAt.getTime() < CHECKPOINT_GAP_MS;

    if (withinBatchWindow && latest) {
      await tx.projectVersion.update({
        where: { id: latest.id },
        data: {
          configurationJson: snapshot.configurationJson as Prisma.InputJsonValue,
          productTitle: snapshot.productTitle,
          editCount: latest.editCount + 1,
        },
      });
      return;
    }

    await tx.projectVersion.create({
      data: {
        projectId,
        configurationJson: snapshot.configurationJson as Prisma.InputJsonValue,
        productTitle: snapshot.productTitle,
      },
    });
  });
}
