"use client";

import { useState } from "react";
import type { ProductDTO } from "@/lib/product/db-mapping";

// A selectable card in the Products Found grid (docs/product-phases/02-product-import.md).
// Always a real <button> so it's keyboard-accessible and announces its pressed state.
export function ProductCard({
  product,
  selected,
  onSelect,
  badge,
}: {
  product: ProductDTO;
  selected: boolean;
  onSelect: () => void;
  /** Small corner label, e.g. "Related" for web-search candidates that aren't the confirmed exact product. Omitted by default. */
  badge?: string;
}) {
  const image = product.images[0];
  // A URL that fails to load must degrade to the same honest "No image" state as a missing
  // one — a broken-image glyph (or worse, a stale wrong image) misrepresents the product.
  const [imageFailed, setImageFailed] = useState(false);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`relative flex flex-col overflow-hidden rounded-xl border bg-neutral-900 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 ${
        selected ? "border-neutral-100" : "border-neutral-800 hover:border-neutral-600"
      }`}
    >
      {badge && (
        <span className="absolute left-2 top-2 z-10 rounded-full bg-neutral-950/90 px-2 py-0.5 text-xs font-medium text-neutral-300">
          {badge}
        </span>
      )}
      <div className="flex aspect-square items-center justify-center bg-neutral-950">
        {image && !imageFailed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image.url}
            alt={image.altText ?? product.title ?? "Product image"}
            onError={() => setImageFailed(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="text-xs text-neutral-600">No image</span>
        )}
      </div>
      <div className="p-3">
        <p className="truncate text-sm font-medium text-neutral-50">{product.title ?? "Untitled product"}</p>
        <p className="mt-1 text-sm text-neutral-400">
          {product.price !== null ? `${product.currency ?? "$"} ${product.price.toFixed(2)}` : "Price unavailable"}
        </p>
      </div>
    </button>
  );
}
