import type { ProductDTO } from "@/lib/product/db-mapping";
import type { CheckOutcome } from "../types";

/** Inspects price/compare-at-price fields already on the normalized product — no external cost data exists yet. */
export function checkMargin(product: ProductDTO): CheckOutcome {
  if (product.price === null) {
    return {
      status: "unavailable",
      score: null,
      summary: "No price data was found for this product.",
    };
  }

  let score = 50; // baseline for having a price at all
  const detail: string[] = [`Price: ${product.currency ?? "$"}${product.price.toFixed(2)}`];

  if (product.compareAtPrice !== null && product.compareAtPrice > product.price) {
    const discount = (product.compareAtPrice - product.price) / product.compareAtPrice;
    score += Math.min(30, Math.round(discount * 100));
    detail.push(`${Math.round(discount * 100)}% below compare-at price`);
  }

  // A plausible price band for a single-item store product — neither a rounding error
  // near $0 nor a high-ticket item margin heuristics here don't account for.
  if (product.price >= 15 && product.price <= 300) score += 20;

  return {
    status: "completed",
    score: Math.min(100, score),
    summary: "Pricing data is present and within a workable range.",
    detail: detail.join(" · "),
  };
}
