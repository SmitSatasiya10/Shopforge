import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { toProductDTO, toNormalizedProduct } from "@/lib/product/db-mapping";
import { rewriteSection, SectionNotRewritableError } from "@/lib/ai/section-rewriter";
import { presetById } from "@/lib/ai/rewrite-presets";
import { AiConfigError } from "@/lib/ai/config";
import { OpenRouterError } from "@/lib/ai/openrouter";
import { PAGE_TEMPLATES, PageTemplate, parseConfiguration } from "@/lib/store-config/store";
import { parseCustomerPersona } from "@/lib/store-config/persona";
import { parseMarketingAngle } from "@/lib/store-config/marketing-angle";

// POST /api/project/:id/rewrite-section — rewrites ONE section of one page template with AI
// and persists the result (docs/SECTION-AI-EDITING.md). Unlike /generate this never touches
// the rest of the page: the returned configuration is the stored one with exactly this
// section replaced.
//
// Body:
//   { "page": "index" | "product", "sectionId": string,
//     "prompt"?: string,     a free-typed instruction
//     "preset"?: string,     a REWRITE_PRESETS id (chips); combined with prompt when both given
//     "blockPath"?: string[],  with settingId: scope the rewrite to ONE setting — the result
//     "settingId"?: string,    is the stored section with only that value changed
//     "model"?: string }     overrides OPENROUTER_MODEL for this one run
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    page?: unknown;
    sectionId?: unknown;
    prompt?: unknown;
    preset?: unknown;
    blockPath?: unknown;
    settingId?: unknown;
    model?: unknown;
  };

  const page = body.page as PageTemplate;
  if (!PAGE_TEMPLATES.includes(page)) {
    return NextResponse.json({ error: `"page" must be one of: ${PAGE_TEMPLATES.join(", ")}` }, { status: 400 });
  }
  if (typeof body.sectionId !== "string" || !body.sectionId) {
    return NextResponse.json({ error: "Provide sectionId" }, { status: 400 });
  }

  const preset = typeof body.preset === "string" ? presetById(body.preset) : undefined;
  if (typeof body.preset === "string" && !preset) {
    return NextResponse.json({ error: `Unknown preset "${body.preset}"` }, { status: 400 });
  }
  const typed = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const instruction = [preset?.instruction, typed].filter(Boolean).join("\n\nAdditionally: ");
  if (!instruction) {
    return NextResponse.json({ error: "Provide a prompt or a preset" }, { status: 400 });
  }

  const scope =
    typeof body.settingId === "string" && body.settingId
      ? {
          settingId: body.settingId,
          blockPath: Array.isArray(body.blockPath) ? body.blockPath.filter((b): b is string => typeof b === "string") : [],
        }
      : undefined;

  const project = await prisma.project.findUnique({ where: { id }, include: { product: true } });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let configuration;
  try {
    configuration = parseConfiguration(project.configurationJson);
  } catch {
    return NextResponse.json(
      { error: "This project's configuration predates the current theme. Regenerate it." },
      { status: 409 },
    );
  }

  const section = configuration.templates[page].sections[body.sectionId];
  if (!section) {
    return NextResponse.json({ error: `No section "${body.sectionId}" on the ${page} template` }, { status: 404 });
  }

  try {
    const result = await rewriteSection({
      product: toNormalizedProduct(toProductDTO(project.product)),
      sectionId: body.sectionId,
      section,
      instruction,
      // Rewrites honor the same customer store-content language and persona as full generation.
      language: project.language,
      customerPersona: parseCustomerPersona(project.personaJson),
      marketingAngle: parseMarketingAngle(project.marketingAngleJson),
      scope,
      config: typeof body.model === "string" && body.model ? { model: body.model } : {},
      signal: req.signal,
    });

    configuration.templates[page].sections[body.sectionId] = result.section;

    const updated = await prisma.project.update({
      where: { id },
      data: { configurationJson: JSON.parse(JSON.stringify(configuration)) },
    });

    return NextResponse.json({ project: updated, sectionId: body.sectionId, model: result.model });
  } catch (error) {
    if (error instanceof SectionNotRewritableError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
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
