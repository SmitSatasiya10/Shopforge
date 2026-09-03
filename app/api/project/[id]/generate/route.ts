import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { toProductDTO } from "@/lib/product/db-mapping";
import { generateStore } from "@/lib/ai/content-generator";
import { withAITrace } from "@/lib/ai/debug-logger";
import { AiConfigError } from "@/lib/ai/config";
import { OpenRouterError } from "@/lib/ai/openrouter";
import { parseConfiguration, StoreConfiguration } from "@/lib/store-config/store";
import { parseCustomerPersona } from "@/lib/store-config/persona";
import { parseMarketingAngle } from "@/lib/store-config/marketing-angle";
import { parseSelectedImages } from "@/lib/store-config/product-images";
import { requireUserId } from "@/lib/auth/session";
import { assertProjectOwnership } from "@/lib/auth/authorize";

// POST /api/project/:id/generate — regenerates both page templates from the project's
// imported product using OpenRouter, and replaces the project's Store Configuration.
//
// Body (all optional):
//   { "generateImages": boolean }  overrides the SHOPFORGE_GENERATE_IMAGES env default for
//                                  this one run. false (the default) fills every image
//                                  setting from the imported product's own photos and calls
//                                  no image model; true generates images instead.
//   { "model": string }            overrides OPENROUTER_MODEL for this one run.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId(req);
  if (userId instanceof NextResponse) return userId;
  const { id } = await params;
  const authError = await assertProjectOwnership(id, userId);
  if (authError) return authError;

  const body = (await req.json().catch(() => ({}))) as {
    generateImages?: unknown;
    model?: unknown;
  };

  const project = await prisma.project.findUnique({ where: { id }, include: { store: { include: { product: true } } } });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const normalized = toProductDTO(project.store.product);
  // The wizard's Product Images selection (shopforge-personalization-image-selection-plan.md
  // §17), when present, is what hero/banner image settings round-robin-fill from — the
  // merchant's curated set, not the raw scrape. Product.images itself is never modified.
  const selectedImages = parseSelectedImages(project.selectedImagesJson);
  if (selectedImages) {
    normalized.images = selectedImages.images.map((img) => ({ url: img.url, altText: img.altText }));
  }

  try {
    const generated = await withAITrace(
      "generate-store",
      { route: "/api/project/[id]/generate", projectId: id, productId: project.store.productId },
      () =>
        generateStore(normalized, {
          // The customer-language and persona selections made during onboarding: all
          // customer-facing copy is generated in this language, written for this buyer
          // (store-content-language-selection-implementation.md,
          // product_based_customer_persona_implementation.md).
          language: project.language,
          customerPersona: parseCustomerPersona(project.personaJson),
          marketingAngle: parseMarketingAngle(project.marketingAngleJson),
          config: {
            ...(typeof body.generateImages === "boolean" ? { generateImages: body.generateImages } : {}),
            ...(typeof body.model === "string" && body.model ? { model: body.model } : {}),
          },
          signal: req.signal,
        }),
    );

    // Regenerating content replaces the templates, but a merchant's Design panel changes
    // (global theme settings) aren't part of what "Generate content" regenerates — carry them
    // forward rather than silently resetting them to defaults.
    const previousThemeSettings = (() => {
      try {
        return parseConfiguration(project.configurationJson).themeSettings;
      } catch {
        return {};
      }
    })();

    const configuration: StoreConfiguration = {
      version: 2,
      templates: { index: generated.index.template, product: generated.product.template },
      generatedAt: new Date().toISOString(),
      themeSettings: previousThemeSettings,
    };

    const updated = await prisma.project.update({
      where: { id },
      data: { configurationJson: JSON.parse(JSON.stringify(configuration)) },
    });

    return NextResponse.json({
      project: updated,
      // Surfaced so the caller can see which side of the image toggle ran, and what the
      // catalog guard rejected, rather than having to diff the template to find out.
      generation: {
        model: generated.index.model,
        index: {
          sections: generated.index.template.order?.length ?? 0,
          images: generated.index.images,
          dropped: generated.index.droppedSections,
          fallback: generated.index.fallbackSections,
        },
        product: {
          sections: generated.product.template.order?.length ?? 0,
          images: generated.product.images,
          dropped: generated.product.droppedSections,
          fallback: generated.product.fallbackSections,
        },
      },
    });
  } catch (error) {
    if (error instanceof AiConfigError) {
      return NextResponse.json({ error: error.message }, { status: 501 });
    }
    if (error instanceof OpenRouterError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    const message = error instanceof Error ? error.message : "Generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** GET — reports whether generation has run for this project and what the image toggle default is. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId(req);
  if (userId instanceof NextResponse) return userId;
  const { id } = await params;
  const authError = await assertProjectOwnership(id, userId);
  if (authError) return authError;

  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let generatedAt: string | null = null;
  try {
    generatedAt = parseConfiguration(project.configurationJson).generatedAt;
  } catch {
    generatedAt = null;
  }

  return NextResponse.json({
    generatedAt,
    aiConfigured: Boolean(process.env.OPENROUTER_API_KEY),
    generateImagesDefault: ["1", "true", "yes", "on"].includes(
      (process.env.SHOPFORGE_GENERATE_IMAGES ?? "false").trim().toLowerCase(),
    ),
  });
}
