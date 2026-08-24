import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

// GET /api/shopify/store — the most recently connected store, if any. This app connects one
// store at a time (no multi-tenant account model yet — see docs/product-spec/DECISIONS.md),
// so "the connected store" is just whichever ShopifyStore row was touched most recently, used
// by the import wizard to recognize an existing connection on a fresh page load rather than
// only right after the OAuth redirect back.
export async function GET() {
  const store = await prisma.shopifyStore.findFirst({ orderBy: { updatedAt: "desc" } });
  return NextResponse.json({ shopDomain: store?.shopDomain ?? null });
}
