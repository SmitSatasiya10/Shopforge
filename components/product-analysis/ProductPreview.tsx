import type { ProductDTO } from "@/lib/product/db-mapping";

// Right-hand product preview panel (product-analysis-progress-screen-prompt.md §8). Falls
// back to a proper placeholder — never a broken image icon — when there's no image.
export function ProductPreview({ product, complete }: { product: ProductDTO; complete: boolean }) {
  const image = product.images[0];

  return (
    <div className="flex w-full max-w-xs flex-col items-center gap-4">
      <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image.url}
            alt={image.altText ?? product.title ?? "Product image"}
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="px-6 text-center text-xs text-neutral-600">No product image available</span>
        )}
      </div>
      {product.title && <p className="text-center text-sm font-medium text-neutral-200">{product.title}</p>}
      <p className="text-xs text-neutral-500" aria-live="polite">
        {complete ? "Analysis complete" : "Analyzing…"}
      </p>
    </div>
  );
}
