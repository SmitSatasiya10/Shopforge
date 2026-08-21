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
  const related = searchParams.get("related") === "1";
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
        <ProductResults ids={ids} source={source} partialFailed={partialFailed} partialTotal={partialTotal} related={related} />
      ) : source === "shopify" && step !== "url" ? (
        <ConnectShopify />
      ) : (
        <ImportForm source={source} />
      )}
    </div>
  );
}

// Placeholder until the Shopforge Shopify app exists — swap in the real App Store listing URL.
const SHOPIFY_APP_STORE_URL = "https://apps.shopify.com/";

// Connect Shopify Store step: the Shopify entry point asks the merchant to install the
// Shopforge app first, instead of pasting a URL. The real OAuth/app install isn't built
// yet, so "Continue" falls through to the existing URL-entry step (?step=url) to keep the
// flow usable end-to-end.
function ConnectShopify() {
  const router = useRouter();

  return (
    <>
      <ProgressSteps step={2} onBack={() => router.push("/")} />
      <div className="flex flex-1 flex-col lg:flex-row">
        {/* Left: connect actions */}
        <div className="flex flex-1 flex-col px-6 py-12 sm:px-12 lg:px-16">
          <div className="mx-auto flex w-full max-w-xl flex-1 flex-col">
            <div className="pt-4 lg:pt-12">
              <h1 className="text-3xl font-semibold tracking-tight">Connect your Shopify store</h1>
              <p className="mt-3 text-base text-neutral-400">
                Install the Shopforge app to import your products.
              </p>

              <a
                href={SHOPIFY_APP_STORE_URL}
                target="_blank"
                rel="noreferrer"
                className="mt-10 flex w-full items-center justify-center gap-3 rounded-xl border border-neutral-700 bg-neutral-900 px-6 py-4 text-base font-semibold transition hover:border-neutral-500 hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
              >
                <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true" fill="#95BF47">
                  <path d="M15.34 2.98c-.14-.01-.3-.02-.47-.02-.2-.62-.5-1.2-.9-1.66C13.42.68 12.83.4 12.2.4c-.13 0-.26.01-.39.04C11.34.14 10.83 0 10.35 0 7.9 0 6.73 3.06 6.36 4.61l-2.1.65c-.65.2-.67.22-.75.83L1.8 19.31 14.55 21.7l6.9-1.49S15.6 3 15.34 2.98ZM12.9 3.7l-1.66.51c0-.09.01-.17.01-.27 0-.81-.11-1.47-.3-1.98.75.09 1.5.98 1.95 1.74Zm-2.62-1.6c.2.5.34 1.2.34 2.17v.14l-2.7.83c.35-1.32 1.16-2.72 2.36-3.14Zm-1.5-1.05c.19 0 .38.06.56.19-1.4.66-2.35 2.34-2.76 4.32l-2.13.66C5.03 4.36 6.24 1.05 8.78 1.05Z" />
                </svg>
                Install Shopforge on Shopify
              </a>

              <p className="mt-4 flex items-center justify-center gap-2 text-sm text-neutral-400">
                <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="2.5" y="2.5" width="15" height="15" rx="4" />
                  <path d="m6.5 10.5 2.5 2.5 4.5-5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                You&apos;ll be redirected to the Shopify App Store
              </p>
            </div>

            <div className="mt-auto pt-16">
              <button
                type="button"
                onClick={() => router.push("/import?source=shopify&step=url")}
                className="w-full rounded-xl bg-neutral-50 px-6 py-4 text-base font-semibold text-neutral-900 transition hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
              >
                Continue
              </button>
              <p className="mt-3 text-center text-sm text-neutral-500">Try out for free</p>
            </div>
          </div>
        </div>

        {/* Right: install-steps illustration */}
        <div className="hidden flex-1 items-center justify-center border-l border-neutral-900 bg-neutral-950 bg-[radial-gradient(circle,rgba(255,255,255,0.07)_1px,transparent_1px)] [background-size:22px_22px] lg:flex">
          <div className="mx-8 max-w-md rounded-2xl border border-neutral-800 bg-neutral-900 p-5 shadow-2xl shadow-black/60">
            <div className="overflow-hidden rounded-xl bg-gradient-to-br from-orange-400 via-rose-400 to-emerald-500 p-6" aria-hidden="true">
              <div className="rounded-lg bg-neutral-950/90 p-4">
                <div className="h-2 w-24 rounded bg-neutral-700" />
                <div className="mt-2 h-2 w-32 rounded bg-neutral-800" />
                <div className="mt-4 h-8 rounded-md border border-neutral-700 bg-neutral-800" />
                <div className="mt-2 h-2 w-28 rounded bg-neutral-800" />
                <div className="mt-4 flex justify-end">
                  <div className="h-14 w-20 rounded-md border border-neutral-700 bg-neutral-800 p-2">
                    <div className="h-1.5 w-10 rounded bg-neutral-600" />
                    <div className="mt-1 h-1.5 w-8 rounded bg-neutral-700" />
                    <div className="mt-2 h-3 rounded-sm bg-neutral-700" />
                  </div>
                </div>
              </div>
            </div>
            <p className="mt-4 text-center text-lg font-semibold">Follow these steps to install the app</p>
          </div>
        </div>
      </div>
    </>
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
  { icon: string; heading: string; description: string; placeholder: string; submitLabel: string; label: string; badges?: string[] }
> = {
  shopify: {
    icon: "🛍️",
    heading: "Import your product",
    description: "Enter a Shopify product URL, or a store homepage to browse its products",
    placeholder: "https://store.com/products/example",
    submitLabel: "Import Product",
    label: "Shopify product or store URL",
  },
  supplier: {
    icon: "🔗",
    heading: "Import from a supplier link",
    description: "Paste the supplier product URL — we'll extract everything for you.",
    placeholder: "https://example-supplier.com/product/...",
    submitLabel: "Import product",
    label: "Supplier product URL",
    badges: SUPPORTED_SUPPLIER_LABEL_LIST.split(", "),
  },
  competitor: {
    icon: "🏬",
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

      if (data.mode === "related") {
        // The exact product couldn't be confirmed, but web search found similar listings —
        // route to the same Products Found grid, flagged so it labels these as related rather
        // than as the requested product.
        const ids = data.products.map((p: ProductDTO) => p.id).join(",");
        router.push(`/import?source=${source}&productIds=${ids}&related=1`);
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
      <ProgressSteps
        step={2}
        onBack={() => router.push(source === "shopify" ? "/import?source=shopify" : "/")}
      />
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-6 py-16">
        <div className="text-center">
          <span
            className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-900 text-3xl"
            aria-hidden="true"
          >
            {copy.icon}
          </span>
          <h1 className="mt-6 text-3xl font-semibold tracking-tight">{copy.heading}</h1>
          <p className="mt-3 text-base text-neutral-400">{copy.description}</p>
          {copy.badges && (
            <div className="mt-4 flex items-center justify-center gap-2">
              <span className="text-xs text-neutral-500">Supports</span>
              {copy.badges.map((badge) => (
                <span
                  key={badge}
                  className="rounded-full border border-neutral-800 bg-neutral-900 px-3 py-1 text-xs font-medium text-neutral-300"
                >
                  {badge}
                </span>
              ))}
            </div>
          )}
        </div>

        <form
          onSubmit={handleSubmit}
          className="mt-10 flex flex-col gap-4 rounded-2xl border border-neutral-800 bg-neutral-900 p-6 shadow-lg shadow-black/30"
          noValidate
        >
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
            className="rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-3.5 text-base text-neutral-50 transition placeholder:text-neutral-500 focus-visible:border-neutral-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={loading || url.trim() === ""}
            className="rounded-xl bg-neutral-50 px-4 py-3.5 text-base font-semibold text-neutral-900 transition hover:bg-neutral-200 disabled:opacity-60"
          >
            {loading ? activeStages[Math.min(stageIndex, activeStages.length - 1)] : copy.submitLabel}
          </button>
          <div aria-live="polite" className="min-h-[1.25rem] text-center">
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
  related = false,
}: {
  ids: string[];
  source: ProductImportSource;
  partialFailed: number;
  partialTotal: number;
  related?: boolean;
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
      <ProgressSteps
        step={3}
        onBack={() => router.push(source === "shopify" ? "/import?source=shopify&step=url" : `/import?source=${source}`)}
      />
      <div className={`mx-auto w-full max-w-4xl flex-1 px-4 py-12 sm:px-8 ${selectedProduct ? "pb-28" : ""}`}>
        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}
        {!error && !products && <p className="text-sm text-neutral-400">Loading…</p>}

        {products && products.length > 0 && (
          <>
            <div className="text-center">
              <h1 className="text-3xl font-semibold tracking-tight">
                {related
                  ? "We couldn't find the exact product"
                  : products.length > 1
                    ? "Products found"
                    : "Product found"}
              </h1>
              <p className="mt-3 text-base text-neutral-400">
                {related
                  ? "We found similar products that may help — select one to continue"
                  : "Select a product to continue"}
              </p>
              {products.length > 1 && !related && (
                <p className="mt-2 text-sm text-neutral-500">
                  {products.length} products imported
                </p>
              )}
              {partialFailed > 0 && (
                <p className="mt-2 text-sm text-amber-400">
                  {partialTotal} products found. {partialFailed} product{partialFailed === 1 ? "" : "s"} couldn&apos;t be
                  imported.
                </p>
              )}
            </div>

            <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {products.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  selected={product.id === selectedId}
                  onSelect={() => setSelectedId(product.id)}
                  badge={related ? "Related" : undefined}
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
