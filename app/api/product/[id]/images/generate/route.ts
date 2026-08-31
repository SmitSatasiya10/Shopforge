import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { editProductImage, IMAGE_EDIT_ASPECTS, IMAGE_EDIT_MODES, type ImageEditAspect, type ImageEditMode } from "@/lib/ai/image-editor";
import { withAIContext } from "@/lib/ai/debug-logger";
import { appendGeneratedImage, type GeneratedImage } from "@/lib/product/generated-images";

// POST /api/product/:id/images/generate — { instruction, mode, sourceImageUrl?, aspect?,
// stylePreset?, claim? } -> { image: GeneratedImage }. The editor's "Edit with AI" panel
// (plan-image-editing-clever-curry.md) — a single generate/edit call, distinct from
// POST /api/product/:id/images (the wizard's cached candidate-set builder, which this route
// never touches). Persists the result onto Product.generatedImagesJson on every success,
// independent of whether the merchant goes on to click "Use image", so a paid-for generation
// is never silently lost even if they close the panel.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    instruction?: unknown;
    mode?: unknown;
    sourceImageUrl?: unknown;
    aspect?: unknown;
    stylePreset?: unknown;
    claim?: unknown;
  };

  const instruction = typeof body.instruction === "string" ? body.instruction.trim() : "";
  if (!instruction) return NextResponse.json({ error: "Provide { instruction: string }" }, { status: 400 });

  const mode = IMAGE_EDIT_MODES.includes(body.mode as ImageEditMode) ? (body.mode as ImageEditMode) : null;
  if (!mode) return NextResponse.json({ error: `mode must be one of ${IMAGE_EDIT_MODES.join(", ")}` }, { status: 400 });

  const sourceImageUrl = typeof body.sourceImageUrl === "string" && body.sourceImageUrl ? body.sourceImageUrl : null;
  if (mode === "edit" && !sourceImageUrl) {
    return NextResponse.json({ error: 'sourceImageUrl is required when mode is "edit"' }, { status: 400 });
  }

  const aspect: ImageEditAspect = IMAGE_EDIT_ASPECTS.includes(body.aspect as ImageEditAspect)
    ? (body.aspect as ImageEditAspect)
    : "auto";
  const stylePreset = typeof body.stylePreset === "string" && body.stylePreset ? body.stylePreset : null;
  const claim = typeof body.claim === "string" && body.claim ? body.claim : null;

  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });

  const result = await withAIContext(
    { operation: "edit-product-image", route: "/api/product/[id]/images/generate", productId: id },
    () =>
      editProductImage({
        instruction,
        mode,
        sourceImageUrl,
        aspect,
        stylePreset,
        claim,
        signal: req.signal,
      }),
  );

  if (!result.ok) {
    const status =
      result.reason === "disabled" || result.reason === "no-api-key"
        ? 501
        : result.reason === "no-reference"
          ? 400
          : 502;
    return NextResponse.json({ error: result.message }, { status });
  }

  const image: GeneratedImage = {
    id: randomUUID(),
    url: result.url,
    prompt: instruction,
    sourceImageUrl,
    mode,
    createdAt: new Date().toISOString(),
  };

  await prisma.product.update({
    where: { id },
    data: { generatedImagesJson: appendGeneratedImage(product.generatedImagesJson, image) },
  });
  
  return NextResponse.json({ image });
}
