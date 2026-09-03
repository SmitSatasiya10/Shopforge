import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

const NOT_FOUND = () => NextResponse.json({ error: "Not found" }, { status: 404 });

/** Verifies `userId` owns the given Store. Returns null on success, or a 404 NextResponse to
 * return as-is otherwise — a mismatched owner and a missing store are indistinguishable on
 * purpose, so a caller can never tell "doesn't exist" from "exists but isn't yours". */
export async function assertStoreOwnership(storeId: string, userId: string): Promise<NextResponse | null> {
  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { ownerId: true } });
  if (!store || store.ownerId !== userId) return NOT_FOUND();
  return null;
}

/** Same as assertStoreOwnership, but for a Project (theme), via its owning Store. */
export async function assertProjectOwnership(projectId: string, userId: string): Promise<NextResponse | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { store: { select: { ownerId: true } } },
  });
  if (!project || project.store.ownerId !== userId) return NOT_FOUND();
  return null;
}

/** Same as assertStoreOwnership, but for a Product. A Product not yet attached to any Store
 * (mid-import, before a theme/store exists for it) has no owner to check against — allowed for
 * any authenticated caller, a narrow, documented Phase 1 gap (see docs/product-spec/21-security-
 * and-multi-tenancy.md's Store-scoped model — Product has no ownerId of its own). */
export async function assertProductOwnership(productId: string, userId: string): Promise<NextResponse | null> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { store: { select: { ownerId: true } } },
  });
  if (!product) return NOT_FOUND();
  if (product.store && product.store.ownerId !== userId) return NOT_FOUND();
  return null;
}
