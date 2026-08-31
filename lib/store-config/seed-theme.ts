import type { Product as ProductRow } from "@/app/generated/prisma/client";
import { createFsTemplateReader } from "@/lib/preview/fs-template-reader";
import { defaultConfiguration, StoreConfiguration } from "@/lib/store-config/store";
import { loadCatalog } from "@/lib/ai/catalog";
import { collectImageTargets, applyProductImages } from "@/lib/ai/images";
import { toNormalizedProduct, toProductDTO } from "@/lib/product/db-mapping";
import type { SelectedImages } from "@/lib/store-config/product-images";

/**
 * Seeds a brand-new theme's configurationJson from the Base Theme's own default templates,
 * pre-filled with the product's images (or the wizard's selected images, when present), so the
 * theme is previewable the instant it's created — before/if AI generation ever runs on it. Used
 * both for a store's first theme and for any later blank theme added to an existing store.
 */
export async function seedThemeConfiguration(
  product: ProductRow,
  selectedImages: SelectedImages | null,
): Promise<StoreConfiguration> {
  const configuration = await defaultConfiguration(createFsTemplateReader());

  const normalized = toNormalizedProduct(toProductDTO(product));
  const seedProduct = selectedImages
    ? { ...normalized, images: selectedImages.images.map((img) => ({ url: img.url, altText: img.altText })) }
    : normalized;
  const { sections, blocks } = await loadCatalog();
  for (const template of Object.values(configuration.templates)) {
    applyProductImages(collectImageTargets(template, sections, blocks), seedProduct);
  }

  return configuration;
}
