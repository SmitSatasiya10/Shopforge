import { describe, expect, it, vi, beforeEach } from "vitest";

const findFirst = vi.fn();
const create = vi.fn();
const update = vi.fn();
const executeRaw = vi.fn();

const tx = {
  $executeRaw: (...args: unknown[]) => executeRaw(...args),
  projectVersion: {
    findFirst: (...args: unknown[]) => findFirst(...args),
    create: (...args: unknown[]) => create(...args),
    update: (...args: unknown[]) => update(...args),
  },
};

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(tx),
  },
}));

const { recordCheckpoint } = await import("./checkpoint");

describe("recordCheckpoint", () => {
  beforeEach(() => {
    findFirst.mockReset();
    create.mockReset();
    update.mockReset();
    executeRaw.mockReset();
  });

  it("creates a new checkpoint when there is no prior one", async () => {
    findFirst.mockResolvedValue(null);

    await recordCheckpoint("project-1", { configurationJson: { a: 1 }, productTitle: "Bag" });

    expect(create).toHaveBeenCalledWith({
      data: { projectId: "project-1", configurationJson: { a: 1 }, productTitle: "Bag" },
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("batches into the existing checkpoint when the previous edit was recent", async () => {
    findFirst.mockResolvedValue({ id: "v1", updatedAt: new Date(Date.now() - 60_000), editCount: 3 });

    await recordCheckpoint("project-1", { configurationJson: { a: 2 }, productTitle: "Bag" });

    expect(update).toHaveBeenCalledWith({
      where: { id: "v1" },
      data: { configurationJson: { a: 2 }, productTitle: "Bag", editCount: 4 },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("starts a new checkpoint once the batch window has elapsed", async () => {
    findFirst.mockResolvedValue({ id: "v1", updatedAt: new Date(Date.now() - 6 * 60 * 1000), editCount: 3 });

    await recordCheckpoint("project-1", { configurationJson: { a: 3 }, productTitle: "Bag" });

    expect(create).toHaveBeenCalledWith({
      data: { projectId: "project-1", configurationJson: { a: 3 }, productTitle: "Bag" },
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("acquires a per-project advisory lock before reading the latest checkpoint", async () => {
    findFirst.mockResolvedValue(null);

    await recordCheckpoint("project-1", { configurationJson: { a: 1 }, productTitle: "Bag" });

    expect(executeRaw).toHaveBeenCalled();
  });
});
