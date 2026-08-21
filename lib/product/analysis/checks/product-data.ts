import type { ProductDTO } from "@/lib/product/db-mapping";
import type { CheckOutcome } from "../types";

/** Inspects the already-imported product: is there enough to analyze at all? */
export function checkProductData(product: ProductDTO): CheckOutcome {
  if (product.importStatus === "failed" || !product.title) {
    return {
      status: "failed",
      score: null,
      summary: "Could not confirm usable product data.",
      detail: product.importError ?? "The import is missing a title or other core fields.",
    };
  }

  const hasImages = product.images.length > 0;
  const hasDescription = (product.description?.trim().length ?? 0) > 0;

  let score = 40; // baseline for a resolvable title
  if (hasImages) score += 35;
  if (hasDescription) score += 25;

  return {
    status: "completed",
    score: Math.min(100, score),
    summary:
      hasImages && hasDescription
        ? "Title, description, and images were all found."
        : "Core product data was found, though some fields are missing.",
    detail: product.importedFieldsMissing.length > 0 ? `Missing: ${product.importedFieldsMissing.join(", ")}` : undefined,
  };
}
