import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { toProductDTO, toNormalizedProduct } from "@/lib/product/db-mapping";
import { rewriteProductDescription } from "@/lib/ai/description-rewriter";
import { withAIContext } from "@/lib/ai/debug-logger";
import { presetById } from "@/lib/ai/rewrite-presets";
import { AiConfigError } from "@/lib/ai/config";
import { OpenRouterError } from "@/lib/ai/openrouter";
import { parseCustomerPersona } from "@/lib/store-config/persona";
import { parseMarketingAngle } from "@/lib/store-config/marketing-angle";

// POST /api/project/:id/rewrite-product-description — AI-rewrites the product's description
// and persists it to the Product record (docs/EDITOR-TOOLBARS.md "Editing the product
// description"): the description is product data, not a template setting, so it has its own
// endpoint rather than going through rewrite-section's catalog-scoped machinery.
//
// Body:
//   { "prompt"?: string,   a free-typed instruction
//     "preset"?: string,   a REWRITE_PRESETS id (chips); combined with prompt when both given
//     "model"?: string }   overrides OPENROUTER_MODEL for this one run
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    prompt?: unknown;
    preset?: unknown;
    model?: unknown;
  };

  const preset = typeof body.preset === "string" ? presetById(body.preset) : undefined;
  if (typeof body.preset === "string" && !preset) {
    return NextResponse.json({ error: `Unknown preset "${body.preset}"` }, { status: 400 });
  }
  const typed = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const instruction = [preset?.instruction, typed].filter(Boolean).join("\n\nAdditionally: ");
  if (!instruction) {
    return NextResponse.json({ error: "Provide a prompt or a preset" }, { status: 400 });
  }

  const project = await prisma.project.findUnique({ where: { id }, include: { store: { include: { product: true } } } });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const result = await withAIContext(
      {
        operation: "rewrite-product-description",
        route: "/api/project/[id]/rewrite-product-description",
        projectId: id,
        productId: project.store.productId,
      },
      () =>
        rewriteProductDescription({
          product: toNormalizedProduct(toProductDTO(project.store.product)),
          instruction,
          // Rewrites honor the same customer store-content language and persona as full generation.
          language: project.language,
          customerPersona: parseCustomerPersona(project.personaJson),
          marketingAngle: parseMarketingAngle(project.marketingAngleJson),
          config: typeof body.model === "string" && body.model ? { model: body.model } : {},
          signal: req.signal,
        }),
    );

    const product = await prisma.product.update({
      where: { id: project.store.productId },
      data: { description: result.description },
    });

    return NextResponse.json({ product: toProductDTO(product), model: result.model });
  } catch (error) {
    if (error instanceof AiConfigError) {
      return NextResponse.json({ error: error.message }, { status: 501 });
    }
    if (error instanceof OpenRouterError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    const message = error instanceof Error ? error.message : "Rewrite failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
