import type { ProductDTO } from "@/lib/product/db-mapping";
import type { CheckOutcome } from "../types";

/** Deterministic signals from the normalized product — description depth, image count,
 *  variant count, and brand presence — as a proxy for how complete/trustworthy the
 *  listing would look to a shopper. Not a claim about actual market perception. */
export function checkPerceivedValue(product: ProductDTO): CheckOutcome {
  const descriptionLength = product.description?.trim().length ?? 0;
  const imageCount = product.images.length;
  const variantCount = product.variants.length;

  if (descriptionLength === 0 && imageCount === 0) {
    return {
      status: "unavailable",
      score: null,
      summary: "Not enough product detail to evaluate perceived value.",
    };
  }

  let score = 0;
  score += Math.min(40, Math.round((descriptionLength / 400) * 40)); // up to 40 pts for a full description
  score += Math.min(35, imageCount * 7); // up to 5 images
  score += Math.min(15, variantCount * 5); // up to 3 variants
  if (product.vendor) score += 10;

  return {
    status: "completed",
    score: Math.min(100, score),
    summary: `${imageCount} image${imageCount === 1 ? "" : "s"}, ${variantCount} variant${variantCount === 1 ? "" : "s"}, ${descriptionLength}-character description.`,
  };
}
