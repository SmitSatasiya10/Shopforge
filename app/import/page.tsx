"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ProductDTO } from "@/lib/product/db-mapping";
import { ProgressSteps } from "@/components/ProgressSteps";
import { ProductCard } from "@/components/ProductCard";
import { ProductAnalysis } from "@/components/product-analysis/ProductAnalysis";
import { validateProductUrl } from "@/lib/product/url-validation";
import { SUPPORTED_SUPPLIER_LABEL_LIST, type ProductImportSource } from "@/lib/product/source";

export default function ImportPage() {
  return (
    <Suspense>
      <ImportPageInner />
    </Suspense>
  );
}

function readSource(raw: string | null): ProductImportSource {
  return raw === "supplier" || raw === "competitor" ? raw : "shopify";
}

function ImportPageInner() {
  const searchParams = useSearchParams();
  const step = searchParams.get("step");
  const selected = searchParams.get("selected");
  const productId = searchParams.get("productId");
  const productIdsParam = searchParams.get("productIds");
  const source = readSource(searchParams.get("source"));
  const partialFailed = Number(searchParams.get("partialFailed") ?? "0");
  const partialTotal = Number(searchParams.get("partialTotal") ?? "0");
  const ids = productId ? [productId] : productIdsParam ? productIdsParam.split(",").filter(Boolean) : [];

  if (step === "analysis" && selected) {
    const backHref = productId
      ? `/import?source=${source}&productId=${productId}`
      : `/import?source=${source}&productIds=${productIdsParam ?? ""}`;
    return (
      <div className="flex flex-1 flex-col bg-neutral-950 text-neutral-50">
        <ProductAnalysisScreen productId={selected} backHref={backHref} />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col bg-neutral-950 text-neutral-50">
      {ids.length > 0 ? (
        <ProductResults ids={ids} source={source} partialFailed={partialFailed} partialTotal={partialTotal} />
      ) : (
        <ImportForm source={source} />
      )}
    </div>
  );
}

const SHOPIFY_PRODUCT_STAGES = ["Fetching product…", "Extracting product information…"];
const SHOPIFY_STORE_STAGES = ["Finding products…", "Fetching product information…", "Preparing products…"];
const SUPPLIER_STAGES = [
  "Detecting supplier…",
  "Fetching supplier page…",
  "Extracting product information…",
  "Normalizing product…",
  "Saving product…",
];
const COMPETITOR_STAGES = [
  "Fetching store…",
  "Finding products…",
  "Extracting products…",
  "Normalizing products…",
  "Saving products…",
];
const STAGE_STEP_MS = 900;

const SOURCE_COPY: Record<
  ProductImportSource,
  { heading: string; description: string; placeholder: string; submitLabel: string; label: string }
> = {
  shopify: {
    heading: "Import your product",
    description: "Enter a Shopify product URL, or a store homepage to browse its products",
    placeholder: "https://store.com/products/example",
    submitLabel: "Import Product",
    label: "Shopify product or store URL",
  },
  supplier: {
    heading: "Import from a supplier link",
    description: `Paste the supplier product URL. Supports ${SUPPORTED_SUPPLIER_LABEL_LIST}.`,
    placeholder: "https://example-supplier.com/product/...",
    submitLabel: "Import product",
    label: "Supplier product URL",
  },
  competitor: {
    heading: "Import from a competitor store",
    description: "Paste the competitor store URL — we'll look for products to import.",
    placeholder: "https://competitor-store.com",
    submitLabel: "Find products",
    label: "Competitor store URL",
  },
};

// A URL entered with an empty/root path reads as a store homepage rather than a direct
// product page — purely a client-side hint for which loading-stage copy to show while
// waiting; the server does the real classification independent of this.
function looksLikeHomepage(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.pathname === "/" || parsed.pathname === "";
  } catch {
    return false;
  }
}

function stagesFor(source: ProductImportSource, url: string): string[] {
  if (source === "supplier") return SUPPLIER_STAGES;
  if (source === "competitor") return COMPETITOR_STAGES;
  return looksLikeHomepage(url) ? SHOPIFY_STORE_STAGES : SHOPIFY_PRODUCT_STAGES;
}

// URL entry step (docs/product-phases/02-product-import.md; store discovery per
// store-homepage-product-discovery-prompt.md; supplier/competitor per
// supplier-competitor-import-prompt.md). Validates client-side for immediate feedback; the
// server remains responsible for fetch/classification/extraction for all three sources.
function ImportForm({ source }: { source: ProductImportSource }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [activeStages, setActiveStages] = useState<string[]>(() => stagesFor(source, ""));
  const [stageIndex, setStageIndex] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const stageTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const copy = SOURCE_COPY[source];

  function clearStageTimers() {
    stageTimers.current.forEach(clearTimeout);
    stageTimers.current = [];
  }

  useEffect(() => clearStageTimers, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (stageIndex !== -1) return; // guard against duplicate submissions while loading

    const validation = validateProductUrl(url);
    if (!validation.valid) {
      setError(validation.error);
      return;
    }

    setError(null);
    const stages = stagesFor(source, url);
    setActiveStages(stages);
    setStageIndex(0);
    stages.slice(1).forEach((_, i) => {
      stageTimers.current.push(setTimeout(() => setStageIndex(i + 1), (i + 1) * STAGE_STEP_MS));
    });

    try {
      const res = await fetch("/api/product/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source, url }),
      });
      const data = await res.json();
      clearStageTimers();

      if (!res.ok) {
        setError(data.products?.[0]?.importError ?? data.error ?? "Import failed");
        setStageIndex(-1);
        return;
      }

      if (data.mode === "product") {
        const product = data.products[0];
        if (product.importStatus === "failed") {
          setError(product.importError ?? "Could not extract product data from that page.");
          setStageIndex(-1);
          return;
        }
        router.push(`/import?source=${source}&productId=${product.id}`);
        return;
      }

      // mode === "store"
      if (data.products.length === 0) {
        setError(
          source === "competitor"
            ? "We couldn't find any products on this store."
            : "No products found. We couldn't find any products on this store. Try a direct product URL instead.",
        );
        setStageIndex(-1);
        return;
      }
      const ids = data.products.map((p: ProductDTO) => p.id).join(",");
      const partial =
        source === "competitor" && data.discovery?.failed > 0
          ? `&partialFailed=${data.discovery.failed}&partialTotal=${data.discovery.discovered}`
          : "";
      router.push(`/import?source=${source}&productIds=${ids}${partial}`);
    } catch {
      clearStageTimers();
      setError("Something went wrong while importing. Please try again.");
      setStageIndex(-1);
    }
  }

  const loading = stageIndex !== -1;

  return (
    <>
      <ProgressSteps step={2} onBack={() => router.push("/")} />
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-16">
        <h1 className="text-2xl font-semibold">{copy.heading}</h1>
        <p className="mt-2 text-sm text-neutral-400">{copy.description}</p>

        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-3" noValidate>
          <label htmlFor="product-url" className="sr-only">
            {copy.label}
          </label>
          <input
            id="product-url"
            type="url"
            inputMode="url"
            autoComplete="off"
            value={url}
            disabled={loading}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={copy.placeholder}
            aria-invalid={error ? "true" : "false"}
            aria-describedby={error ? "product-url-error" : undefined}
            className="rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3 text-sm text-neutral-50 placeholder:text-neutral-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-neutral-50 px-4 py-3 text-sm font-medium text-neutral-900 transition hover:bg-neutral-200 disabled:opacity-60"
          >
            {loading ? activeStages[Math.min(stageIndex, activeStages.length - 1)] : copy.submitLabel}
          </button>
          <div aria-live="polite" className="min-h-[1.25rem]">
            {error && (
              <p id="product-url-error" className="text-sm text-red-400">
                {error}
              </p>
            )}
          </div>
        </form>
      </div>
    </>
  );
}

// Products Found step (docs/product-phases/02-product-import.md; multi-product grid per
// store-homepage-product-discovery-prompt.md). A direct product URL always yields exactly
// one id and is pre-selected, matching the original single-product flow; a store URL can
// yield several, and the user must explicitly pick one.
function ProductResults({
  ids,
  source,
  partialFailed,
  partialTotal,
}: {
  ids: string[];
  source: ProductImportSource;
  partialFailed: number;
  partialTotal: number;
}) {
  const router = useRouter();
  const [products, setProducts] = useState<ProductDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all(
      ids.map((id) =>
        fetch(`/api/product/${id}`)
          .then((res) => res.json())
          .then((data) => (data.error ? null : (data.product as ProductDTO))),
      ),
    )
      .then((results) => {
        const found = results.filter((p): p is ProductDTO => p !== null);
        if (found.length === 0) {
          setError("Could not load the imported product(s)");
          return;
        }
        setProducts(found);
        if (found.length === 1) setSelectedId(found[0].id);
      })
      .catch(() => setError("Could not load the imported product(s)"));
  }, [ids]);

  function goToAnalysis() {
    if (!selectedId) return;
    const backParam = ids.length === 1 ? `productId=${ids[0]}` : `productIds=${ids.join(",")}`;
    router.push(`/import?source=${source}&${backParam}&selected=${selectedId}&step=analysis`);
  }

  const selectedProduct = products?.find((p) => p.id === selectedId) ?? null;

  return (
    <>
      <ProgressSteps step={3} onBack={() => router.push(`/import?source=${source}`)} />
      <div className={`mx-auto w-full max-w-4xl flex-1 px-4 py-12 sm:px-8 ${selectedProduct ? "pb-28" : ""}`}>
        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}
        {!error && !products && <p className="text-sm text-neutral-400">Loading…</p>}

        {products && products.length > 0 && (
          <>
            <h1 className="text-2xl font-semibold">{products.length > 1 ? "Products found" : "Product found"}</h1>
            <p className="mt-1 text-sm text-neutral-400">Select a product to continue</p>
            {partialFailed > 0 && (
              <p className="mt-1 text-sm text-amber-400">
                {partialTotal} products found. {partialFailed} product{partialFailed === 1 ? "" : "s"} couldn&apos;t be
                imported.
              </p>
            )}

            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {products.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  selected={product.id === selectedId}
                  onSelect={() => setSelectedId(product.id)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {selectedProduct && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-neutral-800 bg-neutral-950/95 backdrop-blur">
          <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4 px-4 py-4 sm:px-8">
            <div className="flex min-w-0 items-center gap-3">
              {selectedProduct.images[0] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={selectedProduct.images[0].url}
                  alt=""
                  className="h-10 w-10 shrink-0 rounded-md border border-neutral-800 object-cover"
                />
              ) : (
                <div className="h-10 w-10 shrink-0 rounded-md border border-neutral-800 bg-neutral-900" aria-hidden="true" />
              )}
              <p className="truncate text-sm text-neutral-300">{selectedProduct.title ?? "Untitled product"}</p>
            </div>
            <button
              type="button"
              onClick={goToAnalysis}
              disabled={selectedProduct.importStatus === "failed"}
              className="shrink-0 rounded-lg bg-neutral-50 px-5 py-3 text-sm font-medium text-neutral-900 transition hover:bg-neutral-200 disabled:opacity-60"
            >
              Continue
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// Product Analysis step (product-analysis-progress-screen-prompt.md). Fetches the
// selected product through the existing product API — no new API/data model — then runs
// the deterministic analysis and, once complete, creates the Project exactly as the old
// "Continue" button on the Products Found screen used to.
function ProductAnalysisScreen({ productId, backHref }: { productId: string; backHref: string }) {
  const router = useRouter();
  const [product, setProduct] = useState<ProductDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [continuing, setContinuing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/product/${productId}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) setError(data.error);
        else setProduct(data.product as ProductDTO);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load the imported product");
      });
    return () => {
      cancelled = true;
    };
  }, [productId, reloadKey]);

  function handleRetry() {
    setError(null);
    setProduct(null);
    setReloadKey((k) => k + 1);
  }

  async function handleContinue() {
    setContinuing(true);
    const res = await fetch("/api/project", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ productId }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Could not create the project");
      setContinuing(false);
      return;
    }
    router.push(`/editor/${data.project.id}`);
  }

  return (
    <>
      <ProgressSteps step={4} onBack={() => router.push(backHref)} />
      {error && !product && (
        <div className="mx-auto w-full max-w-md flex-1 px-4 py-16">
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
          <button
            type="button"
            onClick={handleRetry}
            className="mt-4 rounded-lg border border-neutral-700 px-4 py-2 text-sm font-medium text-neutral-200 transition hover:bg-neutral-800"
          >
            Retry
          </button>
        </div>
      )}
      {!error && !product && <p className="px-4 py-16 text-center text-sm text-neutral-400">Loading…</p>}
      {product && (
        <>
          <ProductAnalysis product={product} onContinue={handleContinue} continuing={continuing} />
          {error && (
            <p role="alert" className="mx-auto mb-8 w-full max-w-4xl px-4 text-sm text-red-400 sm:px-8">
              {error}
            </p>
          )}
        </>
      )}
    </>
  );
}
