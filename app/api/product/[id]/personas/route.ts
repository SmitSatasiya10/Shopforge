import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { toProductDTO, toNormalizedProduct } from "@/lib/product/db-mapping";
import { generatePersonaOptions, PersonaGenerationError } from "@/lib/ai/persona-generator";
import { AiConfigError } from "@/lib/ai/config";
import { OpenRouterError } from "@/lib/ai/openrouter";
import { DEFAULT_STORE_LANGUAGE, normalizeStoreLanguage } from "@/lib/store-config/language";
import { PersonaOptionsCacheSchema, assignPersonaIcons } from "@/lib/store-config/persona";

// POST /api/product/:id/personas — { language? } -> the four product-specific persona
// options for the wizard's "Who are you selling to?" step
// (product_based_customer_persona_implementation.md).
//
// Cost control: the generated set is cached on the Product row keyed by the language it was
// written in, so revisiting the step (or going back and forward) never re-calls the AI.
// Regeneration happens only when no valid cache exists for the requested language — which
// also covers "the user changed the product" (a different product row has its own cache)
// and "the user changed the language" (the cache language no longer matches).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { language?: unknown };

  const language =
    body.language === undefined ? DEFAULT_STORE_LANGUAGE : normalizeStoreLanguage(body.language);
  if (language === null) {
    return NextResponse.json({ error: `Unsupported language "${String(body.language)}"` }, { status: 400 });
  }

  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });

  const cached = PersonaOptionsCacheSchema.safeParse(product.personaOptionsJson);
  if (cached.success && cached.data.language === language) {
    // Icons are re-derived on read so sets cached before an icon-pool change stay unique.
    return NextResponse.json({ options: assignPersonaIcons(cached.data.options), language, cached: true });
  }

  try {
    const generated = await generatePersonaOptions({
      product: toNormalizedProduct(toProductDTO(product)),
      language,
      signal: req.signal,
    });

    await prisma.product.update({
      where: { id },
      data: { personaOptionsJson: { language, options: generated.options } },
    });

    return NextResponse.json({
      options: generated.options,
      language,
      cached: false,
      model: generated.model,
    });
  } catch (error) {
    if (error instanceof AiConfigError) {
      return NextResponse.json({ error: error.message }, { status: 501 });
    }
    if (error instanceof OpenRouterError || error instanceof PersonaGenerationError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    const message = error instanceof Error ? error.message : "Persona generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
