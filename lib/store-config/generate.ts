import { randomUUID } from "node:crypto";
import { NormalizedProduct } from "@/lib/product/types";
import { StoreConfiguration, SectionInstance } from "./types";

function section(type: string, settings: Record<string, string | boolean> = {}): SectionInstance {
  return { id: randomUUID(), type, settings };
}

/**
 * Deterministic initial Store Configuration generator — no AI (prototype-phase-plan.md
 * §11/§18). Section order follows plan §14's rendering order exactly: Header ->
 * Announcement -> Product sections -> Footer.
 */
export function generateInitialConfiguration(product: NormalizedProduct): StoreConfiguration {
  const storeName = product.vendor ?? product.title ?? "Shopforge Demo";

  return {
    version: 1,
    pages: {
      product: {
        pageType: "product",
        sections: [
          section("header", { store_name: storeName }),
          section("announcement-bar", {
            message: product.compareAtPrice ? "Limited-time sale — while supplies last" : "Free shipping on all orders",
          }),
          section("product-hero"),
          section(
            "rich-text",
            product.description ? { heading: "Why you'll love it", body: product.description } : {},
          ),
          section("image-with-text", {
            heading: `About ${product.vendor ?? "this product"}`,
            ...(product.images[1] || product.images[0]
              ? { image_url: (product.images[1] ?? product.images[0]).url }
              : {}),
          }),
          section("footer", { copyright_text: `© 2026 ${storeName}. All rights reserved.` }),
        ],
      },
    },
  };
}
