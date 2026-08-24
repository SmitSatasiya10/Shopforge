import { normalizeFromShopifyJson } from "./normalizer";
import { NormalizedProduct } from "./types";

// Deterministic local/demo product (prototype-phase-plan.md §6) — flows through the
// exact same Shopify-JSON normalizer as a real import, so it exercises the identical
// downstream code path (Project creation, Store Configuration, preview).
const SAMPLE_PRODUCT_URL = "https://shopforge-sample.example.com/products/aurora-pet-bed";

const SAMPLE_SHOPIFY_JSON = {
  title: "Aurora Pet Bed",
  vendor: "Aurora Home",
  body_html:
    "<p>A plush, machine-washable pet bed with memory-foam base and raised bolster edge for extra comfort and security.</p>",
  images: [
    {
      src: "https://images.unsplash.com/photo-1581888227599-779811939961?w=800&h=800&fit=crop&auto=format",
      alt: "Aurora Pet Bed",
    },
    {
      src: "https://images.unsplash.com/photo-1598397678815-c5dc869035b8?w=800&h=800&fit=crop&auto=format",
      alt: "Side view",
    },
  ],
  variants: [
    { title: "Small", price: "59.00", sku: "APB-SM", compare_at_price: "79.00" },
    { title: "Large", price: "79.00", sku: "APB-LG", compare_at_price: "99.00" },
  ],
  options: [{ name: "Size", values: ["Small", "Large"] }],
};

export function getSampleNormalizedProduct(): NormalizedProduct {
  const normalized = normalizeFromShopifyJson(SAMPLE_SHOPIFY_JSON, SAMPLE_PRODUCT_URL);
  return { ...normalized, source: "sample" };
}

export const SAMPLE_PRODUCT_RAW = SAMPLE_SHOPIFY_JSON;
