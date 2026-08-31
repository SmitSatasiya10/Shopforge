import { prisma } from "@/lib/db/prisma";
import { toNormalizedProduct, toProductDTOWithOverrides } from "@/lib/product/db-mapping";
import { deriveStoreName } from "@/lib/store-config/store-name";
import { PageTemplate, parseConfiguration, templateFor } from "@/lib/store-config/store";
import { createFsBinaryReader, createFsTemplateReader } from "./fs-template-reader";
import { renderTemplate } from "./template-renderer";

export interface PublicStorefrontResult {
  html: string;
}

/**
 * Renders a theme's current saved configuration for its public preview link
 * (app/preview/[token]/...). Reuses the exact same renderTemplate() pipeline the editor and
 * the fs-based readers already use — no second rendering engine.
 *
 * Deliberately queries only `store.product`, never `store.shopifyStore` (which holds
 * accessTokenCipher/refreshTokenCipher) — do not add that include here, this route has no
 * auth layer to fall back on and this query shape is the actual security boundary.
 *
 * Returns null (never throws) for: unknown token, a disabled link, or an unrenderable
 * project (e.g. configurationJson that fails validation) — the caller turns every case into
 * the same 404, so an anonymous visitor can never distinguish "not enabled" from "broken".
 */
export async function renderPublicStorefront(
  token: string,
  page: PageTemplate,
): Promise<PublicStorefrontResult | null> {
  if (!token) return null;

  const project = await prisma.project.findUnique({
    where: { publicPreviewToken: token },
    include: { store: { include: { product: true } } },
  });
  if (!project || !project.publicPreviewEnabled) return null;

  try {
    const configuration = parseConfiguration(project.configurationJson);
    const dto = toProductDTOWithOverrides(project.store.product, project.selectedImagesJson);
    const product = toNormalizedProduct(dto);

    const html = await renderTemplate({
      template: templateFor(configuration, page),
      product,
      storeName: deriveStoreName(product),
      readTemplate: createFsTemplateReader(),
      readBinary: createFsBinaryReader(),
      templateName: page,
    });

    return { html };
  } catch {
    return null;
  }
}
