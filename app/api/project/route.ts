import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { createFsTemplateReader } from "@/lib/preview/fs-template-reader";
import { defaultConfiguration } from "@/lib/store-config/store";
import { loadCatalog } from "@/lib/ai/catalog";
import { collectImageTargets, applyProductImages } from "@/lib/ai/images";
import { toNormalizedProduct, toProductDTO } from "@/lib/product/db-mapping";
import { DEFAULT_STORE_LANGUAGE, normalizeStoreLanguage } from "@/lib/store-config/language";
import { PersonaOptionsCacheSchema, type CustomerPersona } from "@/lib/store-config/persona";
import { MarketingAngleCacheSchema, type MarketingAngle } from "@/lib/store-config/marketing-angle";
import { Prisma } from "@/app/generated/prisma/client";

// POST /api/project — { productId, name, language } -> creates the Project seeded with the
// Base Theme's own templates, so the store is previewable the moment it exists. AI content
// generation is a separate call (POST /api/project/:id/generate) rather than something
// project creation blocks on: a full two-template generation takes over a minute.
//
// "language" is the target language for generated customer-facing store content
// (store-content-language-selection-implementation.md) — an ISO 639-1 code such as "de".
// It never affects the app/admin UI language.
//
// The customer persona (product_based_customer_persona_implementation.md) arrives as either
//   "personaId":   the id of one of the product's cached generated persona options, or
//   "personaText": the merchant's own "write your own persona" description,
// and is persisted as Project.personaJson for the generation pipeline.
//
// The marketing angle (persona_step_marketing_angle_implementation.md) arrives as
//   "angleId":            the id of one of the product's cached generated angles
//   "angleSelectionType": "generated" (user picked the card) | "ai" ("Let AI decide" took
//                         the model's recommended angle)
// and is persisted as Project.marketingAngleJson.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.productId !== "string") {
    return NextResponse.json(
      {
        error:
          "Provide { productId: string, name?: string, language?: string, personaId?: string, personaText?: string, angleId?: string, angleSelectionType?: \"generated\" | \"ai\" }",
      },
      { status: 400 },
    );
  }

  const language = body.language === undefined ? null : normalizeStoreLanguage(body.language);
  if (body.language !== undefined && language === null) {
    return NextResponse.json({ error: `Unsupported language "${String(body.language)}"` }, { status: 400 });
  }

  let persona: CustomerPersona | null = null;
  if (body.personaText !== undefined) {
    const text = typeof body.personaText === "string" ? body.personaText.trim() : "";
    if (!text) {
      return NextResponse.json({ error: "Custom persona text must not be empty" }, { status: 400 });
    }
    persona = { type: "custom", text };
  }

  const product = await prisma.product.findUnique({ where: { id: body.productId } });
  if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });

  if (!persona && body.personaId !== undefined) {
    // A generated persona must be one of THIS product's cached options — a stale id from a
    // previously selected product is rejected rather than silently persisted.
    const cache = PersonaOptionsCacheSchema.safeParse(product.personaOptionsJson);
    const option =
      cache.success && typeof body.personaId === "string"
        ? cache.data.options.find((o) => o.id === body.personaId)
        : undefined;
    if (!option) {
      return NextResponse.json(
        { error: `Unknown persona "${String(body.personaId)}" for this product` },
        { status: 400 },
      );
    }
    persona = { type: "generated", id: option.id, name: option.name, description: option.description };
  }

  let marketingAngle: MarketingAngle | null = null;
  if (body.angleId !== undefined) {
    // Same staleness rule as personas: the angle must be one of THIS product's cached set.
    const cache = MarketingAngleCacheSchema.safeParse(product.marketingAnglesJson);
    const option =
      cache.success && typeof body.angleId === "string"
        ? cache.data.options.find((o) => o.id === body.angleId)
        : undefined;
    if (!option) {
      return NextResponse.json(
        { error: `Unknown marketing angle "${String(body.angleId)}" for this product` },
        { status: 400 },
      );
    }
    marketingAngle = {
      id: option.id,
      title: option.title,
      description: option.description,
      selectionType: body.angleSelectionType === "ai" ? "ai" : "generated",
    };
  }

  const existing = await prisma.project.findUnique({ where: { productId: product.id } });
  if (existing) {
    // Re-running the wizard for the same product with a different language or persona
    // should win: later generation reads these off the project row.
    const data: Prisma.ProjectUpdateInput = {
      ...(language && language !== existing.language ? { language } : {}),
      ...(persona ? { personaJson: persona } : {}),
      ...(marketingAngle ? { marketingAngleJson: marketingAngle } : {}),
    };
    if (Object.keys(data).length > 0) {
      const updated = await prisma.project.update({ where: { id: existing.id }, data });
      return NextResponse.json({ project: updated }, { status: 200 });
    }
    return NextResponse.json({ project: existing }, { status: 200 });
  }

  const configuration = await defaultConfiguration(createFsTemplateReader());

  // Seed every image slot from the imported product's own photos, so the very first preview
  // shows the real product rather than the theme's demo images. AI generation later replaces
  // these (with product photos again, or generated images when the toggle is on); a product
  // with no images leaves the theme defaults in place.
  const normalized = toNormalizedProduct(toProductDTO(product));
  const { sections, blocks } = await loadCatalog();
  for (const template of Object.values(configuration.templates)) {
    applyProductImages(collectImageTargets(template, sections, blocks), normalized);
  }

  const project = await prisma.project.create({
    data: {
      name:
        typeof body.name === "string" && body.name.trim() ? body.name : (product.title ?? "Untitled store"),
      productId: product.id,
      language: language ?? DEFAULT_STORE_LANGUAGE,
      ...(persona ? { personaJson: persona } : {}),
      ...(marketingAngle ? { marketingAngleJson: marketingAngle } : {}),
      // Prisma's Json input type wants an index signature the configuration type does not
      // structurally have; round-tripping through JSON keeps this a plain-object write.
      configurationJson: JSON.parse(JSON.stringify(configuration)),
    },
  });

  return NextResponse.json({ project }, { status: 201 });
}
