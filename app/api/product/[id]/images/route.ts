import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { toProductDTO, toNormalizedProduct } from "@/lib/product/db-mapping";
import { buildImageCandidates } from "@/lib/product/images/candidates";
import { withAIContext } from "@/lib/ai/debug-logger";
import { ImageCandidatesCacheSchema, type SelectionStatus } from "@/lib/store-config/product-images";
import { PersonaOptionsCacheSchema, type CustomerPersona } from "@/lib/store-config/persona";
import { MarketingAngleCacheSchema, type MarketingAngle } from "@/lib/store-config/marketing-angle";
import { requireUserId } from "@/lib/auth/session";
import { assertProductOwnership } from "@/lib/auth/authorize";

// POST /api/product/:id/images — {} -> the wizard's Product Images step candidate set:
// { primary: ImageCandidate[], other: ImageCandidate[] } (shopforge-personalization-image-
// selection-plan.md §9-12).
//
// Cost control: the generated set is cached on the Product row (see product-images.ts for why
// it isn't keyed by language/persona/angle the way personas and marketing angles are) — the
// wizard step never re-calls AI generation or web search on revisit, back/forward, or a
// language/persona change; only a different product (a different Product row) gets a fresh set.
//
// { personaId | personaText, angleId } are optional here: when they resolve to one of THIS
// product's cached persona/angle options, they steer the AI prompts (shopforge-
// personalization-image-selection-plan.md §10 — "persona, marketing angle" as context); an
// unresolvable or absent value never blocks candidate generation, since the product itself
// remains the primary relevance signal.
//
// Whether each one resolved is reported back as personaStatus/angleStatus ("resolved" |
// "stale" | "none"). Generating candidates doesn't need them, but POST /api/project rejects
// an unresolvable id outright, so the wizard uses these to send the merchant back to re-pick
// on arrival — rather than at the final "Generate my store" click, after they have already
// chosen their images.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId(req);
  if (userId instanceof NextResponse) return userId;
  const { id } = await params;
  const authError = await assertProductOwnership(id, userId);
  if (authError) return authError;

  const body = (await req.json().catch(() => ({}))) as {
    personaId?: unknown;
    personaText?: unknown;
    angleId?: unknown;
  };

  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });

  // Resolved BEFORE the candidate cache is consulted: personaStatus/angleStatus are how the
  // wizard detects a stale URL, and a revisit — precisely when a stale id turns up — takes the
  // cached branch below, which would otherwise return without ever looking at them.
  let persona: CustomerPersona | null = null;
  let personaStatus: SelectionStatus = "none";
  if (typeof body.personaText === "string" && body.personaText.trim()) {
    persona = { type: "custom", text: body.personaText.trim() };
    personaStatus = "resolved";
  } else if (typeof body.personaId === "string") {
    const cache = PersonaOptionsCacheSchema.safeParse(product.personaOptionsJson);
    const option = cache.success ? cache.data.options.find((o) => o.id === body.personaId) : undefined;
    if (option) persona = { type: "generated", id: option.id, name: option.name, description: option.description };
    personaStatus = option ? "resolved" : "stale";
  }

  let marketingAngle: MarketingAngle | null = null;
  let angleStatus: SelectionStatus = "none";
  if (typeof body.angleId === "string") {
    const cache = MarketingAngleCacheSchema.safeParse(product.marketingAnglesJson);
    const option = cache.success ? cache.data.options.find((o) => o.id === body.angleId) : undefined;
    if (option) marketingAngle = { id: option.id, title: option.title, description: option.description, selectionType: "generated" };
    angleStatus = option ? "resolved" : "stale";
  }

  const selection = { personaStatus, angleStatus };

  const cached = ImageCandidatesCacheSchema.safeParse(product.imageCandidatesJson);
  if (cached.success) {
    return NextResponse.json({ ...cached.data, cached: true, ...selection });
  }

  const normalized = toNormalizedProduct(toProductDTO(product));
  const result = await withAIContext(
    { operation: "generate-product-images", route: "/api/product/[id]/images", productId: id },
    () => buildImageCandidates(normalized, { persona, marketingAngle, signal: req.signal }),
  );

  await prisma.product.update({ where: { id }, data: { imageCandidatesJson: result } });

  return NextResponse.json({ ...result, cached: false, ...selection });
}
