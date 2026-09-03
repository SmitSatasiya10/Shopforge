import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { toProductDTO, toNormalizedProduct } from "@/lib/product/db-mapping";
import { generateAngleOptions, AngleGenerationError } from "@/lib/ai/marketing-angle-generator";
import { withAIContext } from "@/lib/ai/debug-logger";
import { AiConfigError } from "@/lib/ai/config";
import { OpenRouterError } from "@/lib/ai/openrouter";
import { DEFAULT_STORE_LANGUAGE, normalizeStoreLanguage } from "@/lib/store-config/language";
import { CustomerPersonaSchema } from "@/lib/store-config/persona";
import { MarketingAngleCacheSchema, personaCacheKey } from "@/lib/store-config/marketing-angle";
import { requireUserId } from "@/lib/auth/session";
import { assertProductOwnership } from "@/lib/auth/authorize";

// POST /api/product/:id/marketing-angles — { persona, language? } -> the four
// product+persona-specific marketing angles for the Persona step's "How do you want to
// sell it?" state (persona_step_marketing_angle_implementation.md), plus the model's
// recommended angle id, which is what "Let AI decide" resolves to.
//
// Cost control: the generated set is cached on the Product row keyed by (language,
// personaKey). Revisiting the state, going back and forward, or re-rendering never
// re-calls the AI; changing the persona, the language, or the product does — old angles
// are never reused for new inputs.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId(req);
  if (userId instanceof NextResponse) return userId;
  const { id } = await params;
  const authError = await assertProductOwnership(id, userId);
  if (authError) return authError;

  const body = (await req.json().catch(() => ({}))) as { language?: unknown; persona?: unknown };

  const language =
    body.language === undefined ? DEFAULT_STORE_LANGUAGE : normalizeStoreLanguage(body.language);
  if (language === null) {
    return NextResponse.json({ error: `Unsupported language "${String(body.language)}"` }, { status: 400 });
  }

  const persona = CustomerPersonaSchema.safeParse(body.persona);
  if (!persona.success) {
    return NextResponse.json(
      { error: "Provide the selected persona: { type: \"generated\", id, name, description } or { type: \"custom\", text }" },
      { status: 400 },
    );
  }

  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });

  const key = personaCacheKey(persona.data);
  const cached = MarketingAngleCacheSchema.safeParse(product.marketingAnglesJson);
  if (cached.success && cached.data.language === language && cached.data.personaKey === key) {
    return NextResponse.json({
      options: cached.data.options,
      recommendedId: cached.data.recommendedId,
      language,
      cached: true,
    });
  }

  try {
    const generated = await withAIContext(
      { operation: "generate-marketing-angle", route: "/api/product/[id]/marketing-angles", productId: id },
      () =>
        generateAngleOptions({
          product: toNormalizedProduct(toProductDTO(product)),
          persona: persona.data,
          language,
          signal: req.signal,
        }),
    );

    await prisma.product.update({
      where: { id },
      data: {
        marketingAnglesJson: {
          language,
          personaKey: key,
          options: generated.options,
          recommendedId: generated.recommendedId,
        },
      },
    });

    return NextResponse.json({
      options: generated.options,
      recommendedId: generated.recommendedId,
      language,
      cached: false,
      model: generated.model,
    });
  } catch (error) {
    if (error instanceof AiConfigError) {
      return NextResponse.json({ error: error.message }, { status: 501 });
    }
    if (error instanceof OpenRouterError || error instanceof AngleGenerationError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    const message = error instanceof Error ? error.message : "Marketing-angle generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
