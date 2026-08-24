import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { toProductDTO, toNormalizedProduct } from "@/lib/product/db-mapping";
import { buildImageCandidates } from "@/lib/product/images/candidates";
import { ImageCandidatesCacheSchema } from "@/lib/store-config/product-images";
import { PersonaOptionsCacheSchema, type CustomerPersona } from "@/lib/store-config/persona";
import { MarketingAngleCacheSchema, type MarketingAngle } from "@/lib/store-config/marketing-angle";

// POST /api/product/:id/images — {} -> the wizard's Product Images step candidate set:
// { primary: ImageCandidate[], other: ImageCandidate[] } (shopforge-personalization-image-
// selection-plan.md §9-12).
//
// Cost control: the generated set is cached on the Product row (see product-images.ts for why
// it isn't keyed by language/persona/angle the way personas and marketing angles are) — the
// wizard step never re-calls AI generation or web search on revisit, back/forward, or a
// language/persona change; only a different product (a different Product row) gets a fresh set.
//
// { personaId | personaText, angleId } are optional and purely cosmetic here: when they
// resolve to one of THIS product's cached persona/angle options, they steer the AI prompts
// (shopforge-personalization-image-selection-plan.md §10 — "persona, marketing angle" as
// context); an unresolvable or absent value never blocks candidate generation, since the
// product itself remains the primary relevance signal.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    personaId?: unknown;
    personaText?: unknown;
    angleId?: unknown;
  };

  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });

  const cached = ImageCandidatesCacheSchema.safeParse(product.imageCandidatesJson);
  if (cached.success) {
    return NextResponse.json({ ...cached.data, cached: true });
  }

  let persona: CustomerPersona | null = null;
  if (typeof body.personaText === "string" && body.personaText.trim()) {
    persona = { type: "custom", text: body.personaText.trim() };
  } else if (typeof body.personaId === "string") {
    const cache = PersonaOptionsCacheSchema.safeParse(product.personaOptionsJson);
    const option = cache.success ? cache.data.options.find((o) => o.id === body.personaId) : undefined;
    if (option) persona = { type: "generated", id: option.id, name: option.name, description: option.description };
  }

  let marketingAngle: MarketingAngle | null = null;
  if (typeof body.angleId === "string") {
    const cache = MarketingAngleCacheSchema.safeParse(product.marketingAnglesJson);
    const option = cache.success ? cache.data.options.find((o) => o.id === body.angleId) : undefined;
    if (option) marketingAngle = { id: option.id, title: option.title, description: option.description, selectionType: "generated" };
  }

  const normalized = toNormalizedProduct(toProductDTO(product));
  const result = await buildImageCandidates(normalized, { persona, marketingAngle, signal: req.signal });

  await prisma.product.update({ where: { id }, data: { imageCandidatesJson: result } });

  return NextResponse.json({ ...result, cached: false });
}
