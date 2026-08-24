"use client";

import { useState } from "react";
import type { ProductDTO } from "@/lib/product/db-mapping";
import { formatProductPrice } from "@/lib/product/price-format";

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
      className={`group relative flex flex-col overflow-hidden rounded-xl border bg-neutral-900 text-left transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 ${
        selected
          ? "border-neutral-100"
          : "border-neutral-800 hover:border-neutral-600 hover:shadow-lg hover:shadow-black/20"
      }`}
    >
      {badge && (
        <span className="absolute left-2 top-2 z-10 rounded-full bg-neutral-950/90 px-2 py-0.5 text-xs font-medium text-neutral-300">
          {badge}
        </span>
      )}
      {selected && (
        <span
          className="absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-neutral-50 text-neutral-900 shadow-sm"
          aria-hidden="true"
        >
          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.75">
            <path d="m4.5 10.5 3.5 3.5 7.5-8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      )}
      <div className="flex aspect-square items-center justify-center overflow-hidden bg-neutral-950">
        {image && !imageFailed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image.url}
            alt={image.altText ?? product.title ?? "Product image"}
            onError={() => setImageFailed(true)}
            className="h-full w-full object-cover transition-transform duration-150 group-hover:scale-[1.02]"
          />
        ) : (
          <span className="text-xs text-neutral-600">No image</span>
        )}
      </div>
      <div className={`p-3 transition-colors duration-150 ${selected ? "bg-neutral-800" : ""}`}>
        <p className="truncate text-sm font-medium text-neutral-50">{product.title ?? "Untitled product"}</p>
        <p className="mt-1 text-sm text-neutral-400">
          {product.price !== null ? formatProductPrice(product.price, product.currency) : "Price unavailable"}
        </p>
      </div>
    </button>
  );
}
