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
import {
  ImageCandidatesCacheSchema,
  MAX_SELECTED_IMAGES,
  allCandidates,
  type SelectedImages,
} from "@/lib/store-config/product-images";
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
//
// "imageSelection" (shopforge-personalization-image-selection-plan.md §9-18) is an ordered
// array of candidate ids — at most MAX_SELECTED_IMAGES — from the product's cached image
// candidates, order = gallery order, first = featured. Persisted as Project.selectedImagesJson;
// Product.images is never overwritten.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.productId !== "string") {
    return NextResponse.json(
      {
        error:
          "Provide { productId: string, name?: string, language?: string, personaId?: string, personaText?: string, angleId?: string, angleSelectionType?: \"generated\" | \"ai\", imageSelection?: string[] }",
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

  // The wizard's Product Images step (shopforge-personalization-image-selection-plan.md
  // §9-18): an ordered list of candidate ids (order = gallery order, first = featured), each
  // of which must be one of THIS product's cached candidates — same staleness rule as persona
  // and angle above, so a selection made against a previous product/candidate set can never
  // silently attach to a different one. Persisted on the Project, never on Product.images —
  // the original imported product data is never overwritten.
  let selectedImages: SelectedImages | null = null;
  if (Array.isArray(body.imageSelection)) {
    if (body.imageSelection.length > MAX_SELECTED_IMAGES) {
      return NextResponse.json({ error: `At most ${MAX_SELECTED_IMAGES} images may be selected` }, { status: 400 });
    }
    const cache = ImageCandidatesCacheSchema.safeParse(product.imageCandidatesJson);
    const byId = new Map((cache.success ? allCandidates(cache.data) : []).map((c) => [c.id, c]));
    const images = [];
    for (const candidateId of body.imageSelection) {
      const candidate = typeof candidateId === "string" ? byId.get(candidateId) : undefined;
      if (!candidate) {
        return NextResponse.json({ error: `Unknown image "${String(candidateId)}" for this product` }, { status: 400 });
      }
      images.push(candidate);
    }
    selectedImages = { images };
  }

  const existing = await prisma.project.findUnique({ where: { productId: product.id } });
  if (existing) {
    // Re-running the wizard for the same product with a different language or persona
    // should win: later generation reads these off the project row.
    const data: Prisma.ProjectUpdateInput = {
      ...(language && language !== existing.language ? { language } : {}),
      ...(persona ? { personaJson: persona } : {}),
      ...(marketingAngle ? { marketingAngleJson: marketingAngle } : {}),
      ...(selectedImages ? { selectedImagesJson: selectedImages } : {}),
    };
    if (Object.keys(data).length > 0) {
      const updated = await prisma.project.update({ where: { id: existing.id }, data });
      return NextResponse.json({ project: updated }, { status: 200 });
    }
    return NextResponse.json({ project: existing }, { status: 200 });
  }

  const configuration = await defaultConfiguration(createFsTemplateReader());

  // Seed every image slot from the wizard's selected images when the Product Images step ran,
  // so the very first preview reflects what the merchant actually picked rather than the raw
  // scrape; otherwise fall back to the imported product's own photos as before. AI generation
  // later replaces these (with the same images again, or generated images when the toggle is
  // on); a product with no images leaves the theme defaults in place.
  const normalized = toNormalizedProduct(toProductDTO(product));
  const seedProduct = selectedImages
    ? { ...normalized, images: selectedImages.images.map((img) => ({ url: img.url, altText: img.altText })) }
    : normalized;
  const { sections, blocks } = await loadCatalog();
  for (const template of Object.values(configuration.templates)) {
    applyProductImages(collectImageTargets(template, sections, blocks), seedProduct);
  }

  const project = await prisma.project.create({
    data: {
      name:
        typeof body.name === "string" && body.name.trim() ? body.name : (product.title ?? "Untitled store"),
      productId: product.id,
      language: language ?? DEFAULT_STORE_LANGUAGE,
      ...(persona ? { personaJson: persona } : {}),
      ...(marketingAngle ? { marketingAngleJson: marketingAngle } : {}),
      ...(selectedImages ? { selectedImagesJson: selectedImages } : {}),
      // Prisma's Json input type wants an index signature the configuration type does not
      // structurally have; round-tripping through JSON keeps this a plain-object write.
      configurationJson: JSON.parse(JSON.stringify(configuration)),
    },
  });

  return NextResponse.json({ project }, { status: 201 });
}
