import type { ProductDTO } from "@/lib/product/db-mapping";

// A selectable card in the Products Found grid (docs/product-phases/02-product-import.md).
// Always a real <button> so it's keyboard-accessible and announces its pressed state.
export function ProductCard({
  product,
  selected,
  onSelect,
}: {
  product: ProductDTO;
  selected: boolean;
  onSelect: () => void;
}) {
  const image = product.images[0];
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex flex-col overflow-hidden rounded-xl border bg-neutral-900 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 ${
        selected ? "border-neutral-100" : "border-neutral-800 hover:border-neutral-600"
      }`}
    >
      <div className="flex aspect-square items-center justify-center bg-neutral-950">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image.url}
            alt={image.altText ?? product.title ?? "Product image"}
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
