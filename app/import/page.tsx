"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ProductDTO } from "@/lib/product/db-mapping";
import { ProgressSteps } from "@/components/ProgressSteps";
import { ProductCard } from "@/components/ProductCard";
import { ProductAnalysis } from "@/components/product-analysis/ProductAnalysis";
import { GenerationOverlay } from "@/components/GenerationOverlay";
import { validateProductUrl } from "@/lib/product/url-validation";
import { SUPPORTED_SUPPLIER_LABEL_LIST, type ProductImportSource } from "@/lib/product/source";
import { formatProductPrice } from "@/lib/product/price-format";
import {
  PRIMARY_STORE_LANGUAGES,
  OTHER_STORE_LANGUAGES,
  findStoreLanguage,
  normalizeStoreLanguage,
  type StoreLanguage,
} from "@/lib/store-config/language";
import type { PersonaOption } from "@/lib/store-config/persona";
import type { MarketingAngleOption } from "@/lib/store-config/marketing-angle";
import { MAX_SELECTED_IMAGES, type ImageCandidatesCache } from "@/lib/store-config/product-images";

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
  // The Start screen's "Try a sample product" shortcut skips the Product URL / Connect
  // Shopify step entirely, so the sample product never actually visited it — back from the
  // Products step (or anywhere later in the wizard) must return straight to Start instead of
  // to a step the merchant never saw. Threaded through the same backParam every later step
  // already carries, so it survives forward/back navigation across the whole wizard.
  const fromSample = searchParams.get("sample") === "1";
  const sampleQuery = fromSample ? "&sample=1" : "";
  // Which Shopify store (if any) was connected via ConnectShopify's picker — threaded through
  // backParam below like sample/language/persona so back navigation from anywhere later in the
  // wizard returns to the picker instead of losing the connection and falling back to the
  // generic "not connected" Connect Shopify screen.
  const connectedShop = searchParams.get("connected");
  const connectedQuery = connectedShop ? `&connected=${encodeURIComponent(connectedShop)}` : "";
  // Customer store-content language (store-content-language-selection-implementation.md)
  // and customer persona (product_based_customer_persona_implementation.md): both ride the
  // wizard URL like every other piece of wizard state, so back/forward restores them.
  // persona is a generated option's id, or the sentinel "custom" with the merchant's own
  // text in personaText.
  const language = normalizeStoreLanguage(searchParams.get("language"));
  const personaParam = searchParams.get("persona");
  const personaTextParam = searchParams.get("personaText");
  const personaQuery = personaParam
    ? `&persona=${encodeURIComponent(personaParam)}${
        personaParam === "custom" && personaTextParam
          ? `&personaText=${encodeURIComponent(personaTextParam)}`
          : ""
      }`
    : "";
  const ids = productId ? [productId] : productIdsParam ? productIdsParam.split(",").filter(Boolean) : [];

  const backParam =
    (productId ? `productId=${productId}` : `productIds=${productIdsParam ?? ""}`) + sampleQuery + connectedQuery;

  // Flow order after product selection: Analysis -> Language -> Persona -> project/editor.
  if (step === "analysis" && selected) {
    const backHref = `/import?source=${source}&${backParam}${language ? `&language=${language}` : ""}${personaQuery}`;
    const nextHref = `/import?source=${source}&${backParam}&selected=${selected}&step=language${language ? `&language=${language}` : ""}${personaQuery}`;
    return (
      <div className="flex flex-1 flex-col bg-neutral-950 text-neutral-50">
        <ProductAnalysisScreen productId={selected} backHref={backHref} nextHref={nextHref} />
      </div>
    );
  }

  if (step === "language" && selected) {
    return (
      <div className="flex flex-1 flex-col bg-neutral-950 text-neutral-50">
        <LanguageScreen
          source={source}
          backParam={backParam}
          selectedProductId={selected}
          initialLanguage={language}
          personaQuery={personaQuery}
        />
      </div>
    );
  }

  if (step === "persona" && selected) {
    return (
      <div className="flex flex-1 flex-col bg-neutral-950 text-neutral-50">
        <PersonaScreen
          source={source}
          backParam={backParam}
          selectedProductId={selected}
          language={language}
          initialPersonaId={personaParam}
          initialCustomText={personaTextParam ?? ""}
          substep={searchParams.get("substep") === "angle" ? "angle" : "persona"}
          initialAngleId={searchParams.get("angle")}
          imagesQuery={searchParams.get("images")}
        />
      </div>
    );
  }

  // Product Images step (shopforge-personalization-image-selection-plan.md §9-18): the last
  // wizard screen, shown once persona + marketing angle are both resolved. angle/
  // angleSelectionType here are always a concrete cached angle id and how it was chosen
  // ("ai" already resolved to the model's recommended id) — never the "ai" sentinel used
  // inside the Persona step's own state.
  if (step === "images" && selected) {
    const angleId = searchParams.get("angle");
    if (angleId) {
      return (
        <div className="flex flex-1 flex-col bg-neutral-950 text-neutral-50">
          <ImagesScreen
            source={source}
            backParam={backParam}
            selectedProductId={selected}
            language={language}
            personaParam={personaParam}
            personaTextParam={personaTextParam}
            angleId={angleId}
            angleSelectionType={searchParams.get("angleSelectionType") === "ai" ? "ai" : "generated"}
            initialImageIds={searchParams.get("images")}
          />
        </div>
      );
    }
  }

  return (
    <div className="flex flex-1 flex-col bg-neutral-950 text-neutral-50">
      {ids.length > 0 ? (
        <ProductResults
          ids={ids}
          source={source}
          partialFailed={partialFailed}
          partialTotal={partialTotal}
          related={related}
          language={language}
          personaQuery={personaQuery}
          fromSample={fromSample}
          connectedShop={connectedShop}
        />
      ) : source === "shopify" && step !== "url" ? (
        <ConnectShopify />
      ) : (
        <ImportForm source={source} />
      )}
    </div>
  );
}

// Connect Shopify Store step: the merchant can connect their store via a real OAuth install
// (app/api/shopify/install -> Shopify consent screen -> app/api/shopify/callback persists the
// access token), or skip straight to pasting a product URL — connecting isn't required, since
// product import itself works off a store's public product JSON either way
// (lib/product/fetcher.ts tryFetchShopifyProductJson).
interface ShopifyProductSummary {
  id: string;
  title: string;
  handle: string;
  imageUrl: string | null;
  price: string | null;
  currency: string | null;
  productUrl: string;
}

function ConnectShopify() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const connectedFromUrl = searchParams.get("connected");
  const [shopInput, setShopInput] = useState("");
  const [products, setProducts] = useState<ShopifyProductSummary[] | null>(null);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [importingUrl, setImportingUrl] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  // Remembers a store connected earlier in this browser, so landing here fresh (not just right
  // after the OAuth redirect) still recognizes the connection instead of showing the blank
  // connect form every time — this app connects one store at a time (docs/product-spec/
  // DECISIONS.md), so "the connected store" is whichever ShopifyStore was touched most recently.
  const [defaultShop, setDefaultShop] = useState<string | null>(null);
  useEffect(() => {
    if (connectedFromUrl) return;
    fetch("/api/shopify/store")
      .then((res) => res.json())
      .then((data) => setDefaultShop(data.shopDomain ?? null))
      .catch(() => {});
  }, [connectedFromUrl]);
  const connectedShop = connectedFromUrl ?? defaultShop;

  async function disconnect() {
    if (!connectedShop || disconnecting) return;
    setDisconnecting(true);
    try {
      await fetch("/api/shopify/disconnect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shop: connectedShop }),
      });
      setDefaultShop(null);
      router.push("/import?source=shopify");
    } finally {
      setDisconnecting(false);
    }
  }

  useEffect(() => {
    if (!connectedShop) return;
    fetch(`/api/shopify/products?shop=${encodeURIComponent(connectedShop)}`)
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) {
          setProductsError(data.error ?? "Could not load products from this store.");
          return;
        }
        setProducts(data.products);
      })
      .catch(() => setProductsError("Could not load products from this store."));
  }, [connectedShop]);

  async function selectProduct(product: ShopifyProductSummary) {
    if (importingUrl) return;
    setImportingUrl(product.productUrl);
    setImportError(null);
    try {
      const res = await fetch("/api/shopify/products/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shop: connectedShop, productId: product.id, productUrl: product.productUrl }),
      });
      const data = await res.json();
      if (!res.ok || data.mode !== "product") {
        setImportError(data.products?.[0]?.importError ?? data.error ?? "Import failed");
        setImportingUrl(null);
        return;
      }
      const imported = data.products[0];
      if (imported.importStatus === "failed") {
        setImportError(imported.importError ?? "Could not import this product.");
        setImportingUrl(null);
        return;
      }
      router.push(
        `/import?source=shopify&productId=${imported.id}&connected=${encodeURIComponent(connectedShop ?? "")}`,
      );
    } catch {
      setImportError("Something went wrong while importing. Please try again.");
      setImportingUrl(null);
    }
  }

  if (connectedShop) {
    return (
      <>
        <ProgressSteps step={2} onBack={() => router.push("/dashboard/new")} />
        <div className="mx-auto w-full max-w-4xl flex-1 px-4 py-12 sm:px-8">
          <div className="mb-6 flex items-center justify-between gap-3 rounded-lg border border-emerald-800 bg-emerald-950/50 px-4 py-3 text-sm text-emerald-300">
            <span>Connected to {connectedShop}</span>
            <button
              type="button"
              onClick={disconnect}
              disabled={disconnecting}
              className="shrink-0 text-emerald-300/70 underline hover:text-emerald-200 disabled:opacity-60"
            >
              {disconnecting ? "Disconnecting…" : "Disconnect"}
            </button>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">Choose a product</h1>
          <p className="mt-3 text-base text-neutral-400">Select one of your store&apos;s products to build around.</p>

          {importError && (
            <p role="alert" className="mt-4 text-sm text-red-400">
              {importError}
            </p>
          )}
          {productsError && (
            <p role="alert" className="mt-6 text-sm text-red-400">
              {productsError}
            </p>
          )}
          {!productsError && !products && (
            <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4" aria-hidden="true">
              {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                <div key={i} className="aspect-square animate-pulse rounded-xl border border-neutral-800 bg-neutral-900" />
              ))}
            </div>
          )}
          {products && products.length === 0 && (
            <p className="mt-8 text-sm text-neutral-400">This store has no products yet.</p>
          )}
          {products && products.length > 0 && (
            <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {products.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => selectProduct(product)}
                  disabled={importingUrl !== null}
                  className="flex flex-col overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900 text-left transition hover:border-neutral-600 hover:bg-neutral-800 disabled:opacity-60"
                >
                  <div className="aspect-square bg-neutral-950">
                    {product.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={product.imageUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-neutral-700">No image</div>
                    )}
                  </div>
                  <div className="p-3">
                    <p className="truncate text-sm font-medium text-neutral-100">{product.title}</p>
                    {product.price !== null && (
                      <p className="mt-1 text-xs text-neutral-400">
                        {formatProductPrice(Number(product.price), product.currency)}
                      </p>
                    )}
                  </div>
                  {importingUrl === product.productUrl && (
                    <p className="px-3 pb-3 text-xs text-neutral-400">Importing…</p>
                  )}
                </button>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={() => router.push("/import?source=shopify&step=url")}
            className="mt-10 text-sm text-neutral-400 underline hover:text-neutral-200"
          >
            Paste a product URL instead
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <ProgressSteps step={2} onBack={() => router.push("/dashboard/new")} />
      <div className="flex flex-1 flex-col lg:flex-row">
        {/* Left: connect actions */}
        <div className="flex flex-1 flex-col px-6 py-12 sm:px-12 lg:px-16">
          <div className="mx-auto flex w-full max-w-xl flex-1 flex-col">
            <div className="pt-4 lg:pt-12">
              <h1 className="text-3xl font-semibold tracking-tight">Connect your Shopify store</h1>
              <p className="mt-3 text-base text-neutral-400">
                Connect your store for a smoother import, or skip this and paste a product URL directly.
              </p>

              <form
                action="/api/shopify/install"
                method="get"
                className="mt-8 flex flex-col gap-3 rounded-xl border border-neutral-800 bg-neutral-900 p-5"
              >
                <label htmlFor="shopify-domain" className="text-sm font-medium text-neutral-300">
                  Your Shopify store domain
                </label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    id="shopify-domain"
                    name="shop"
                    type="text"
                    autoComplete="off"
                    value={shopInput}
                    onChange={(e) => setShopInput(e.target.value)}
                    placeholder="your-store.myshopify.com"
                    className="flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-4 py-3 text-base text-neutral-50 transition placeholder:text-neutral-500 focus-visible:border-neutral-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
                  />
                  <button
                    type="submit"
                    disabled={shopInput.trim() === ""}
                    className="shrink-0 rounded-lg bg-neutral-50 px-5 py-3 text-sm font-semibold text-neutral-900 transition hover:bg-neutral-200 disabled:opacity-60"
                  >
                    Connect store
                  </button>
                </div>
              </form>

              <p className="mt-4 flex items-center justify-center gap-2 text-sm text-neutral-400">
                <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="2.5" y="2.5" width="15" height="15" rx="4" />
                  <path d="m6.5 10.5 2.5 2.5 4.5-5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                You&apos;ll be redirected to Shopify to approve access
              </p>
            </div>

            <div className="mt-auto pt-16">
              <button
                type="button"
                onClick={() => router.push("/import?source=shopify&step=url")}
                className="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-6 py-4 text-base font-semibold text-neutral-50 transition hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
              >
                Skip for now
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
        onBack={() => router.push(source === "shopify" ? "/import?source=shopify" : "/dashboard/new")}
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
  language,
  personaQuery,
  fromSample = false,
  connectedShop = null,
}: {
  ids: string[];
  source: ProductImportSource;
  partialFailed: number;
  partialTotal: number;
  related?: boolean;
  language: string | null;
  personaQuery: string;
  /** Came in via the Start screen's "Try a sample product" shortcut, which skips the
   * Product URL / Connect Shopify step — back must go straight to Start instead. */
  fromSample?: boolean;
  /** The store connected via ConnectShopify's picker, if any — back returns to that picker
   * (still connected) rather than the generic paste-a-URL screen. */
  connectedShop?: string | null;
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

  // Continue goes to the analysis step first; a language or persona already picked (the
  // user came back from a later step) rides along so those screens restore the selection.
  // A persona id that belongs to a different product is cleared by the persona step itself
  // once that product's own options load.
  function goToAnalysis() {
    if (!selectedId) return;
    const backParam =
      (ids.length === 1 ? `productId=${ids[0]}` : `productIds=${ids.join(",")}`) +
      (fromSample ? "&sample=1" : "") +
      (connectedShop ? `&connected=${encodeURIComponent(connectedShop)}` : "");
    router.push(
      `/import?source=${source}&${backParam}&selected=${selectedId}&step=analysis${language ? `&language=${language}` : ""}${personaQuery}`,
    );
  }

  const selectedProduct = products?.find((p) => p.id === selectedId) ?? null;

  return (
    <>
      <ProgressSteps
        step={3}
        onBack={() =>
          router.push(
            fromSample
              ? "/"
              : source === "shopify"
                ? connectedShop
                  ? `/import?source=shopify&connected=${encodeURIComponent(connectedShop)}`
                  : "/import?source=shopify&step=url"
                : `/import?source=${source}`,
          )
        }
      />
      <div className={`mx-auto w-full max-w-4xl flex-1 px-4 py-12 sm:px-8 ${selectedProduct ? "pb-32" : ""}`}>
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
                  : "Select the product you want to build your store around."}
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
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-neutral-800 bg-neutral-950/95 shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.6)] backdrop-blur">
          <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4 px-4 py-3 sm:px-8">
            <div className="flex min-w-0 items-center gap-3">
              {selectedProduct.images[0] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={selectedProduct.images[0].url}
                  alt=""
                  className="h-11 w-11 shrink-0 rounded-md border border-neutral-800 object-cover"
                />
              ) : (
                <div className="h-11 w-11 shrink-0 rounded-md border border-neutral-800 bg-neutral-900" aria-hidden="true" />
              )}
              <div className="min-w-0">
                <p className="text-[11px] font-medium tracking-wide text-neutral-500 uppercase">Selected product</p>
                <div className="flex items-baseline gap-2">
                  <p className="truncate text-sm font-medium text-neutral-100">
                    {selectedProduct.title ?? "Untitled product"}
                  </p>
                  {selectedProduct.price !== null && (
                    <p className="shrink-0 text-sm text-neutral-400">
                      {formatProductPrice(selectedProduct.price, selectedProduct.currency)}
                    </p>
                  )}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={goToAnalysis}
              disabled={selectedProduct.importStatus === "failed"}
              className="flex shrink-0 items-center gap-1.5 rounded-lg bg-neutral-50 px-5 py-3 text-sm font-medium text-neutral-900 transition hover:bg-neutral-200 disabled:opacity-60"
            >
              Continue
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 10h12M11 5l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// Customer Language step (store-content-language-selection-implementation.md). Shown after
// a product is selected; captures the TARGET language for generated customer-facing store
// content only — the wizard/admin UI itself stays in English. The selection rides the
// wizard URL (like every other wizard state) and is persisted on the Project when the
// Analysis step creates it.
function LanguageScreen({
  source,
  backParam,
  selectedProductId,
  initialLanguage,
  personaQuery,
}: {
  source: ProductImportSource;
  backParam: string;
  selectedProductId: string;
  initialLanguage: string | null;
  /** Already-encoded &persona… params from a later step, echoed forward so back/forward keeps the selection. */
  personaQuery: string;
}) {
  const router = useRouter();
  const [selectedCode, setSelectedCode] = useState<string | null>(initialLanguage);
  const [otherOpen, setOtherOpen] = useState(
    () => initialLanguage !== null && OTHER_STORE_LANGUAGES.some((l) => l.code === initialLanguage),
  );
  const [query, setQuery] = useState("");

  const selectedLanguage = selectedCode ? findStoreLanguage(selectedCode) : undefined;
  const normalizedQuery = query.trim().toLowerCase();
  const otherMatches = OTHER_STORE_LANGUAGES.filter(
    (l) =>
      normalizedQuery === "" ||
      l.label.toLowerCase().includes(normalizedQuery) ||
      l.endonym.toLowerCase().includes(normalizedQuery) ||
      l.code === normalizedQuery,
  );

  function handleContinue() {
    if (!selectedCode) return;
    router.push(
      `/import?source=${source}&${backParam}&selected=${selectedProductId}&step=persona&language=${selectedCode}${personaQuery}`,
    );
  }

  const cardClass = (selected: boolean) =>
    `flex w-full items-center gap-4 rounded-xl border px-5 py-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 ${
      selected
        ? "border-neutral-100 bg-neutral-800"
        : "border-neutral-800 bg-neutral-900 hover:border-neutral-600 hover:bg-neutral-800"
    }`;

  return (
    <>
      <ProgressSteps
        step={5}
        onBack={() =>
          router.push(
            `/import?source=${source}&${backParam}&selected=${selectedProductId}&step=analysis${selectedCode ? `&language=${selectedCode}` : ""}${personaQuery}`,
          )
        }
      />
      <div className="flex flex-1 flex-col lg:flex-row">
        {/* Left: language picker */}
        <div className="flex flex-1 flex-col px-6 py-12 sm:px-12 lg:px-16">
          <div className="mx-auto flex w-full max-w-xl flex-1 flex-col">
            <div className="pt-4 lg:pt-8">
              <h1 className="text-3xl font-semibold tracking-tight">
                What language do your customers speak?
              </h1>
              <p className="mt-3 text-base text-neutral-400">
                Your store content will be generated in this language
              </p>
            </div>

            <div
              className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2"
              role="radiogroup"
              aria-label="Customer language"
            >
              {PRIMARY_STORE_LANGUAGES.map((lang) => {
                const selected = lang.code === selectedCode && !otherOpen;
                return (
                  <button
                    key={lang.code}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => {
                      setSelectedCode(lang.code);
                      setOtherOpen(false);
                    }}
                    className={cardClass(selected)}
                  >
                    <span
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-neutral-700 bg-neutral-950 text-xl"
                      aria-hidden="true"
                    >
                      {lang.flag}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-base font-semibold">{lang.label}</span>
                      <span className="block text-sm text-neutral-400">{lang.endonym}</span>
                    </span>
                  </button>
                );
              })}

              <button
                type="button"
                role="radio"
                aria-checked={otherOpen}
                onClick={() => {
                  if (!otherOpen) {
                    setOtherOpen(true);
                    // A primary-card pick doesn't carry over as an "other" language.
                    if (selectedCode && PRIMARY_STORE_LANGUAGES.some((l) => l.code === selectedCode)) {
                      setSelectedCode(null);
                    }
                  }
                }}
                className={`sm:col-span-2 ${cardClass(otherOpen)}`}
              >
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-neutral-700 bg-neutral-950 text-xl"
                  aria-hidden="true"
                >
                  🌐
                </span>
                <span className="min-w-0">
                  <span className="block text-base font-semibold">Other language</span>
                  <span className="block text-sm text-neutral-400">
                    {otherOpen && selectedLanguage
                      ? `${selectedLanguage.label} · ${selectedLanguage.endonym}`
                      : "Search more languages"}
                  </span>
                </span>
              </button>
            </div>

            {otherOpen && (
              <div className="mt-3 rounded-xl border border-neutral-800 bg-neutral-900 p-4">
                <label htmlFor="other-language-search" className="sr-only">
                  Search languages
                </label>
                <input
                  id="other-language-search"
                  type="text"
                  autoComplete="off"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search languages…"
                  className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-4 py-2.5 text-sm text-neutral-50 transition placeholder:text-neutral-500 focus-visible:border-neutral-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
                />
                <div className="mt-3 max-h-56 overflow-y-auto" role="listbox" aria-label="More languages">
                  {otherMatches.length === 0 && (
                    <p className="px-2 py-3 text-sm text-neutral-500">No languages match your search.</p>
                  )}
                  {otherMatches.map((lang: StoreLanguage) => {
                    const selected = lang.code === selectedCode;
                    return (
                      <button
                        key={lang.code}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        onClick={() => setSelectedCode(lang.code)}
                        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition ${
                          selected ? "bg-neutral-700 text-neutral-50" : "text-neutral-300 hover:bg-neutral-800"
                        }`}
                      >
                        <span aria-hidden="true">{lang.flag}</span>
                        <span className="font-medium">{lang.label}</span>
                        <span className="text-neutral-500">{lang.endonym}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="mt-auto pt-10">
              <button
                type="button"
                onClick={handleContinue}
                disabled={!selectedCode}
                className="w-full rounded-xl bg-neutral-50 px-6 py-4 text-base font-semibold text-neutral-900 transition hover:bg-neutral-200 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
              >
                Continue
              </button>
            </div>
          </div>
        </div>

        {/* Right: preview illustration, matching the Connect Shopify split layout */}
        <div className="hidden flex-1 items-center justify-center border-l border-neutral-900 bg-neutral-950 bg-[radial-gradient(circle,rgba(255,255,255,0.07)_1px,transparent_1px)] [background-size:22px_22px] lg:flex">
          <div className="mx-8 w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-8 text-center shadow-2xl shadow-black/60">
            <span
              className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-neutral-800 bg-neutral-950 text-4xl"
              aria-hidden="true"
            >
              {selectedLanguage?.flag ?? "🌐"}
            </span>
            <p className="mt-6 text-lg font-semibold">
              {selectedLanguage ? selectedLanguage.label : "Store content language"}
            </p>
            <p className="mt-2 text-sm text-neutral-400">
              {selectedLanguage
                ? `Headings, descriptions and buttons will be written in ${selectedLanguage.label}`
                : "Pick the language your customers will read your store in"}
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

// Customer Persona step (product_based_customer_persona_implementation.md). Shown after
// the customer-language step; asks "who are you selling to?" with four persona options
// generated from the selected product (cached server-side per product+language, so
// revisiting never re-calls the AI) plus a "write your own" option. The selection rides
// the wizard URL as persona=<id>, or persona=custom&personaText=<text>.
//
// The step has TWO internal states (persona_step_marketing_angle_implementation.md) — the
// progress bar shows "Persona" for both, never a 7th step:
//   1. substep absent:   "Who are you selling to?" — pick the persona.
//   2. substep=angle:    "How do you want to sell it?" — pick one of four marketing angles
//      generated from product + persona + language (cached per that trio on the Product
//      row), or "Let AI decide", which takes the model's recommended angle.
// As the last wizard state, the angle Continue creates the Project (persisting language +
// persona + marketing angle) and opens the editor.
function PersonaScreen({
  source,
  backParam,
  selectedProductId,
  language,
  initialPersonaId,
  initialCustomText,
  substep,
  initialAngleId,
  imagesQuery,
}: {
  source: ProductImportSource;
  backParam: string;
  selectedProductId: string;
  language: string | null;
  initialPersonaId: string | null;
  initialCustomText: string;
  substep: "persona" | "angle";
  initialAngleId: string | null;
  /** A prior Product Images selection riding through, so going back to Angle and forward
   * again (goToImages) restores it instead of starting the Images step over. */
  imagesQuery: string | null;
}) {
  const router = useRouter();
  const [reloadKey, setReloadKey] = useState(0);
  // Results are keyed by what was requested: a result for a stale key simply stops being
  // "current" when product/language/retry change, which is what puts the screen back into
  // its loading state without any synchronous resets inside the effect.
  const requestKey = `${selectedProductId}|${language ?? ""}|${reloadKey}`;
  const [result, setResult] = useState<{
    key: string;
    options: PersonaOption[] | null;
    error: string | null;
  } | null>(null);
  // selectedId is a generated option's id, or the sentinel "custom" for the free-text card.
  const [selectedId, setSelectedId] = useState<string | null>(initialPersonaId);
  const [customText, setCustomText] = useState(initialCustomText);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/product/${selectedProductId}/personas`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(language ? { language } : {}),
    })
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (!ok) {
          setResult({
            key: requestKey,
            options: null,
            error: data.error ?? "Could not generate personas for this product",
          });
          return;
        }
        const loaded = data.options as PersonaOption[];
        setResult({ key: requestKey, options: loaded, error: null });
        // A persona restored from the URL may belong to another product or an older
        // generation run — clear it rather than keeping an obviously stale selection.
        setSelectedId((current) =>
          current === "custom" || current === null || loaded.some((o) => o.id === current)
            ? current
            : null,
        );
      })
      .catch(() => {
        if (!cancelled) {
          setResult({ key: requestKey, options: null, error: "Could not generate personas for this product" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [requestKey, selectedProductId, language]);

  const current = result?.key === requestKey ? result : null;
  const options = current?.options ?? null;
  const error = current?.error ?? null;

  const selectedOption =
    selectedId && selectedId !== "custom" ? (options?.find((o) => o.id === selectedId) ?? null) : null;
  const customValid = customText.trim().length > 0;
  const canContinue = selectedId === "custom" ? customValid : selectedOption !== null;

  // ---- Marketing-angle state (substep=angle) -------------------------------------------
  // selectedAngleId is a generated angle's id, or the sentinel "ai" for "Let AI decide".
  const [selectedAngleId, setSelectedAngleId] = useState<string | null>(initialAngleId);
  const [angleReloadKey, setAngleReloadKey] = useState(0);
  // The persona the angles are generated for, derived from the (valid) persona selection.
  const personaKey =
    selectedId === "custom"
      ? customValid
        ? `custom:${customText.trim()}`
        : null
      : selectedOption
        ? `generated:${selectedOption.id}`
        : null;
  const angleRequestKey = `${selectedProductId}|${language ?? ""}|${personaKey ?? ""}|${angleReloadKey}`;
  const [angleResult, setAngleResult] = useState<{
    key: string;
    options: MarketingAngleOption[] | null;
    recommendedId: string | null;
    error: string | null;
  } | null>(null);

  useEffect(() => {
    if (substep !== "angle") return;
    const persona =
      selectedId === "custom"
        ? customText.trim()
          ? { type: "custom" as const, text: customText.trim() }
          : null
        : (() => {
            const option = options?.find((o) => o.id === selectedId);
            return option
              ? {
                  type: "generated" as const,
                  id: option.id,
                  name: option.name,
                  description: option.description,
                }
              : null;
          })();
    if (!persona) return; // persona selection not resolved yet (or invalid) — no fetch
    let cancelled = false;
    fetch(`/api/product/${selectedProductId}/marketing-angles`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ persona, ...(language ? { language } : {}) }),
    })
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (!ok) {
          setAngleResult({
            key: angleRequestKey,
            options: null,
            recommendedId: null,
            error: data.error ?? "Could not generate marketing angles",
          });
          return;
        }
        const loaded = data.options as MarketingAngleOption[];
        setAngleResult({
          key: angleRequestKey,
          options: loaded,
          recommendedId: (data.recommendedId as string) ?? loaded[0]?.id ?? null,
          error: null,
        });
        // An angle restored from the URL may belong to another persona/product/language —
        // clear it rather than keeping an obviously stale selection.
        setSelectedAngleId((currentId) =>
          currentId === "ai" || currentId === null || loaded.some((o) => o.id === currentId)
            ? currentId
            : null,
        );
      })
      .catch(() => {
        if (!cancelled) {
          setAngleResult({
            key: angleRequestKey,
            options: null,
            recommendedId: null,
            error: "Could not generate marketing angles",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [substep, angleRequestKey, selectedProductId, language, selectedId, customText, options]);

  const currentAngles = angleResult?.key === angleRequestKey ? angleResult : null;
  const angleOptions = currentAngles?.options ?? null;
  const angleError = currentAngles?.error ?? null;
  const selectedAngle =
    selectedAngleId && selectedAngleId !== "ai"
      ? (angleOptions?.find((o) => o.id === selectedAngleId) ?? null)
      : null;
  const canContinueAngle =
    selectedAngleId === "ai" ? currentAngles?.recommendedId != null : selectedAngle !== null;

  // substep=angle in the URL only counts once the persona selection behind it is valid;
  // otherwise (deep link, stale persona) the persona state renders instead.
  const angleMode = substep === "angle" && canContinue;

  const personaQueryString = () => {
    if (selectedId === "custom" && customValid) {
      return `&persona=custom&personaText=${encodeURIComponent(customText.trim())}`;
    }
    return selectedOption ? `&persona=${encodeURIComponent(selectedOption.id)}` : "";
  };
  const angleQueryString = () =>
    selectedAngleId ? `&angle=${encodeURIComponent(selectedAngleId)}` : "";

  /** Persona-state Continue: advance to the marketing-angle state of this same step. */
  function goToAngles() {
    if (!canContinue) return;
    router.push(
      `/import?source=${source}&${backParam}&selected=${selectedProductId}&step=persona&substep=angle${language ? `&language=${language}` : ""}${personaQueryString()}${angleQueryString()}`,
    );
  }

  // The angle state advances to the Product Images step (shopforge-personalization-image-
  // selection-plan.md §9-18), which is now the wizard's last state — the angle "ai" sentinel
  // is resolved to a concrete id here, once, so every screen after this one only ever deals
  // with a real cached angle id.
  function goToImages() {
    if (!canContinueAngle || !selectedAngleId) return;
    const angleId = selectedAngleId === "ai" ? currentAngles?.recommendedId : selectedAngleId;
    if (!angleId) return;
    const angleSelectionType = selectedAngleId === "ai" ? "ai" : "generated";
    router.push(
      `/import?source=${source}&${backParam}&selected=${selectedProductId}&step=images${language ? `&language=${language}` : ""}${personaQueryString()}&angle=${encodeURIComponent(angleId)}&angleSelectionType=${angleSelectionType}${imagesQuery ? `&images=${encodeURIComponent(imagesQuery)}` : ""}`,
    );
  }

  /** Angle-state back: return to the persona state of this same step. */
  function backToPersona() {
    router.push(
      `/import?source=${source}&${backParam}&selected=${selectedProductId}&step=persona${language ? `&language=${language}` : ""}${personaQueryString()}${angleQueryString()}`,
    );
  }

  /** Persona-state back: return to the language step. */
  function handleBack() {
    router.push(
      `/import?source=${source}&${backParam}&selected=${selectedProductId}&step=language${language ? `&language=${language}` : ""}${personaQueryString()}`,
    );
  }

  const cardClass = (selected: boolean) =>
    `flex w-full items-center gap-4 rounded-xl border px-5 py-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 ${
      selected
        ? "border-neutral-100 bg-neutral-800"
        : "border-neutral-800 bg-neutral-900 hover:border-neutral-600 hover:bg-neutral-800"
    }`;

  if (angleMode) {
    const personaIcon = selectedId === "custom" ? "✏️" : (selectedOption?.icon ?? "🙂");
    const personaName = selectedId === "custom" ? "Your own persona" : (selectedOption?.name ?? "");
    const languageFlag = language ? findStoreLanguage(language)?.flag : undefined;
    return (
      <>
        <ProgressSteps step={6} onBack={backToPersona} />
        <div className="flex flex-1 flex-col lg:flex-row">
          {/* Left: marketing-angle picker */}
          <div className="flex flex-1 flex-col px-6 py-12 sm:px-12 lg:px-16">
            <div className="mx-auto flex w-full max-w-xl flex-1 flex-col">
              <div className="pt-4 lg:pt-8">
                <h1 className="text-3xl font-semibold tracking-tight">How do you want to sell it?</h1>
                <p className="mt-3 text-base text-neutral-400">
                  Choose an angle that hooks your customers
                </p>
              </div>

              {angleError && (
                <div className="mt-8 rounded-xl border border-neutral-800 bg-neutral-900 p-6">
                  <p role="alert" className="text-sm text-red-400">
                    {angleError}
                  </p>
                  <button
                    type="button"
                    onClick={() => setAngleReloadKey((k) => k + 1)}
                    className="mt-4 rounded-lg border border-neutral-700 px-4 py-2 text-sm font-medium text-neutral-200 transition hover:bg-neutral-800"
                  >
                    Retry
                  </button>
                </div>
              )}

              {!angleError && !angleOptions && (
                <div className="relative mt-8" aria-hidden="true">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {[0, 1, 2, 3].map((i) => (
                      <div key={i} className="h-36 animate-pulse rounded-xl border border-neutral-800 bg-neutral-900" />
                    ))}
                  </div>
                  <GenerationOverlay visible label="Generating…" scope="page" />
                </div>
              )}

              {angleOptions && (
                <div className="mt-8" role="radiogroup" aria-label="Marketing angle">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {angleOptions.map((angle) => {
                      const selected = angle.id === selectedAngleId;
                      return (
                        <button
                          key={angle.id}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => setSelectedAngleId(angle.id)}
                          className={`flex flex-col items-start gap-3 rounded-xl border p-5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 ${
                            selected
                              ? "border-neutral-100 bg-neutral-800"
                              : "border-neutral-800 bg-neutral-900 hover:border-neutral-600 hover:bg-neutral-800"
                          }`}
                        >
                          <span
                            className="flex h-10 w-10 items-center justify-center rounded-lg border border-neutral-700 bg-neutral-950 text-xl"
                            aria-hidden="true"
                          >
                            {angle.icon}
                          </span>
                          <span className="min-w-0">
                            <span className="block text-base font-semibold">{angle.title}</span>
                            <span className="mt-1 block text-sm text-neutral-400">{angle.description}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="my-4 h-px bg-neutral-800" aria-hidden="true" />

                  <button
                    type="button"
                    role="radio"
                    aria-checked={selectedAngleId === "ai"}
                    onClick={() => setSelectedAngleId("ai")}
                    className={`flex w-full items-center gap-4 rounded-xl border px-5 py-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 ${
                      selectedAngleId === "ai"
                        ? "border-neutral-100 bg-neutral-800"
                        : "border-neutral-800 bg-neutral-900 hover:border-neutral-600 hover:bg-neutral-800"
                    }`}
                  >
                    <span
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-neutral-700 bg-neutral-950 text-xl"
                      aria-hidden="true"
                    >
                      🧠
                    </span>
                    <span className="min-w-0">
                      <span className="block text-base font-semibold">Let AI decide</span>
                      <span className="block text-sm text-neutral-400">
                        We&apos;ll pick the best marketing angle for your product
                      </span>
                    </span>
                  </button>
                </div>
              )}

              <div className="mt-auto pt-10">
                <button
                  type="button"
                  onClick={goToImages}
                  disabled={!canContinueAngle}
                  className="w-full rounded-xl bg-neutral-50 px-6 py-4 text-base font-semibold text-neutral-900 transition hover:bg-neutral-200 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
                >
                  Continue
                </button>
              </div>
            </div>
          </div>

          {/* Right: targeting preview — persona + language + selected angle */}
          <div className="hidden flex-1 items-center justify-center border-l border-neutral-900 bg-neutral-950 bg-[radial-gradient(circle,rgba(255,255,255,0.07)_1px,transparent_1px)] [background-size:22px_22px] lg:flex">
            <div className="mx-8 w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-8 text-center shadow-2xl shadow-black/60">
              <span
                className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-neutral-800 bg-neutral-950 text-4xl"
                aria-hidden="true"
              >
                {personaIcon}
              </span>
              <p className="mt-6 text-lg font-semibold">{personaName}</p>
              {languageFlag && (
                <p className="mt-1 text-sm text-neutral-400" aria-hidden="true">
                  {languageFlag}
                </p>
              )}
              <p className="mt-5 text-base font-semibold">
                {selectedAngle
                  ? selectedAngle.title
                  : selectedAngleId === "ai"
                    ? "AI will pick your angle"
                    : "Your unique marketing angle"}
              </p>
              <p className="mt-2 text-sm text-neutral-400">
                {selectedAngle
                  ? selectedAngle.description
                  : selectedAngleId === "ai"
                    ? "We'll pick the best marketing angle for your product"
                    : "Choose how to position your store"}
              </p>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <ProgressSteps step={6} onBack={handleBack} />
      <div className="flex flex-1 flex-col lg:flex-row">
        {/* Left: persona picker */}
        <div className="flex flex-1 flex-col px-6 py-12 sm:px-12 lg:px-16">
          <div className="mx-auto flex w-full max-w-xl flex-1 flex-col">
            <div className="pt-4 lg:pt-8">
              <h1 className="text-3xl font-semibold tracking-tight">Who are you selling to?</h1>
              <p className="mt-3 text-base text-neutral-400">
                Pick the person that best matches your buyer
              </p>
            </div>

            {error && (
              <div className="mt-8 rounded-xl border border-neutral-800 bg-neutral-900 p-6">
                <p role="alert" className="text-sm text-red-400">
                  {error}
                </p>
                <button
                  type="button"
                  onClick={() => setReloadKey((k) => k + 1)}
                  className="mt-4 rounded-lg border border-neutral-700 px-4 py-2 text-sm font-medium text-neutral-200 transition hover:bg-neutral-800"
                >
                  Retry
                </button>
              </div>
            )}

            {!error && !options && (
              <div className="relative mt-8 flex flex-col gap-3" aria-hidden="true">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="h-[76px] animate-pulse rounded-xl border border-neutral-800 bg-neutral-900" />
                ))}
                <GenerationOverlay visible label="Generating…" scope="page" />
              </div>
            )}

            {options && (
              <div className="mt-8 flex flex-col gap-3" role="radiogroup" aria-label="Customer persona">
                {options.map((persona) => {
                  const selected = persona.id === selectedId;
                  return (
                    <button
                      key={persona.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setSelectedId(persona.id)}
                      className={cardClass(selected)}
                    >
                      <span
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-neutral-700 bg-neutral-950 text-xl"
                        aria-hidden="true"
                      >
                        {persona.icon}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-base font-semibold">{persona.name}</span>
                        <span className="block text-sm text-neutral-400">{persona.description}</span>
                      </span>
                    </button>
                  );
                })}

                <button
                  type="button"
                  role="radio"
                  aria-checked={selectedId === "custom"}
                  onClick={() => setSelectedId("custom")}
                  className={`mt-2 ${cardClass(selectedId === "custom")}`}
                >
                  <span
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-neutral-700 bg-neutral-950 text-xl"
                    aria-hidden="true"
                  >
                    ✏️
                  </span>
                  <span className="min-w-0">
                    <span className="block text-base font-semibold">Write your own persona</span>
                    <span className="block text-sm text-neutral-400">
                      Describe your ideal customer yourself
                    </span>
                  </span>
                </button>

                {selectedId === "custom" && (
                  <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
                    <label htmlFor="custom-persona" className="text-sm font-medium text-neutral-300">
                      Describe your ideal customer
                    </label>
                    <textarea
                      id="custom-persona"
                      rows={3}
                      value={customText}
                      onChange={(e) => setCustomText(e.target.value)}
                      placeholder='e.g. "Young professionals who want stylish bags for commuting and travel."'
                      className="mt-2 w-full resize-none rounded-lg border border-neutral-700 bg-neutral-950 px-4 py-3 text-sm text-neutral-50 transition placeholder:text-neutral-500 focus-visible:border-neutral-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
                    />
                  </div>
                )}
              </div>
            )}

            <div className="mt-auto pt-10">
              <button
                type="button"
                onClick={goToAngles}
                disabled={!canContinue}
                className="w-full rounded-xl bg-neutral-50 px-6 py-4 text-base font-semibold text-neutral-900 transition hover:bg-neutral-200 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
              >
                Continue
              </button>
            </div>
          </div>
        </div>

        {/* Right: persona preview, same split layout as the language step */}
        <div className="hidden flex-1 items-center justify-center border-l border-neutral-900 bg-neutral-950 bg-[radial-gradient(circle,rgba(255,255,255,0.07)_1px,transparent_1px)] [background-size:22px_22px] lg:flex">
          <div className="mx-8 w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-8 text-center shadow-2xl shadow-black/60">
            <span
              className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-neutral-800 bg-neutral-950 text-4xl"
              aria-hidden="true"
            >
              {selectedId === "custom" ? "✏️" : (selectedOption?.icon ?? "🙂")}
            </span>
            <p className="mt-6 text-lg font-semibold">
              {selectedId === "custom"
                ? "Your own persona"
                : (selectedOption?.name ?? "Ideal customer persona")}
            </p>
            <p className="mt-2 text-sm text-neutral-400">
              {selectedId === "custom"
                ? customValid
                  ? customText.trim()
                  : "Describe the customer this store should speak to"
                : (selectedOption?.description ?? "Your unique marketing angle")}
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

// Product Images step (shopforge-personalization-image-selection-plan.md §9-18). The wizard's
// last screen: candidates (the product's own photos, AI-generated product photography, and
// web-found photos of the same product) are fetched once per product — cached server-side, so
// revisiting or a language/persona change never re-triggers generation/search — and the user
// picks up to five, in the order they'll appear in the store's product gallery (first pick =
// featured image). "Generate my store" persists the Project with everything collected in the
// wizard (language, persona, marketing angle, this selection), kicks off the existing content-
// generation call so the store isn't empty on arrival, and opens the editor.
function ImagesScreen({
  source,
  backParam,
  selectedProductId,
  language,
  personaParam,
  personaTextParam,
  angleId,
  angleSelectionType,
  initialImageIds,
}: {
  source: ProductImportSource;
  backParam: string;
  selectedProductId: string;
  language: string | null;
  personaParam: string | null;
  personaTextParam: string | null;
  angleId: string;
  angleSelectionType: "generated" | "ai";
  initialImageIds: string | null;
}) {
  const router = useRouter();
  const [reloadKey, setReloadKey] = useState(0);
  const requestKey = `${selectedProductId}|${reloadKey}`;
  const [result, setResult] = useState<{
    key: string;
    candidates: ImageCandidatesCache | null;
    error: string | null;
  } | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    initialImageIds ? initialImageIds.split(",").filter(Boolean) : [],
  );

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/product/${selectedProductId}/images`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...(personaParam === "custom" ? { personaText: personaTextParam } : personaParam ? { personaId: personaParam } : {}),
        angleId,
      }),
    })
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (!ok) {
          setResult({ key: requestKey, candidates: null, error: data.error ?? "Could not find images for this product" });
          return;
        }
        const candidates = data as ImageCandidatesCache;
        setResult({ key: requestKey, candidates, error: null });
        const validIds = new Set([...candidates.primary, ...candidates.other].map((c) => c.id));
        setSelectedIds((current) => current.filter((id) => validIds.has(id)));
      })
      .catch(() => {
        if (!cancelled) {
          setResult({ key: requestKey, candidates: null, error: "Could not find images for this product" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [requestKey, selectedProductId, personaParam, personaTextParam, angleId]);

  const current = result?.key === requestKey ? result : null;
  const candidates = current?.candidates ?? null;
  const error = current?.error ?? null;
  const aiGenerated = candidates?.primary[0]?.source === "ai-generated";

  function toggle(id: string) {
    setSelectedIds((ids) => {
      if (ids.includes(id)) return ids.filter((existing) => existing !== id);
      if (ids.length >= MAX_SELECTED_IMAGES) return ids; // at the cap — ignore, never silently swap
      return [...ids, id];
    });
  }

  const [generating, setGenerating] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const hasCandidates = candidates !== null && candidates.primary.length + candidates.other.length > 0;
  const canGenerate = !generating && (selectedIds.length > 0 || !hasCandidates);

  async function handleGenerate() {
    if (!canGenerate) return;
    setGenerating(true);
    setSubmitError(null);
    const res = await fetch("/api/project", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        productId: selectedProductId,
        ...(language ? { language } : {}),
        ...(personaParam === "custom" ? { personaText: personaTextParam } : { personaId: personaParam }),
        angleId,
        angleSelectionType,
        imageSelection: selectedIds,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setSubmitError(data.error ?? "Could not create the project");
      setGenerating(false);
      return;
    }
    const projectId = data.project.id as string;
    // Best-effort: a slow/failed generation call must not strand the merchant on this screen —
    // the editor's own "Generate content" button can always retry once they're there. But a
    // failure here must not be entirely invisible either, or the merchant lands in the editor
    // looking at the un-generated default store with no idea generation never ran — flag it
    // via a query param so the editor can surface it once loaded.
    const generateOk = await fetch(`/api/project/${projectId}/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ generateImages: false }),
    })
      .then((res) => res.ok)
      .catch(() => false);
    router.push(`/editor/${projectId}${generateOk ? "" : "?generationFailed=1"}`);
  }

  function goBack() {
    // Restores the "ai" sentinel (rather than the resolved concrete id) so the angle screen
    // highlights "Let AI decide" again instead of a card the merchant never actually clicked;
    // the current selection rides along so a subsequent Continue back into this screen
    // (goToImages) restores it instead of starting the Images step over.
    const angleParam = angleSelectionType === "ai" ? "ai" : angleId;
    router.push(
      `/import?source=${source}&${backParam}&selected=${selectedProductId}&step=persona&substep=angle${language ? `&language=${language}` : ""}${personaParam ? `&persona=${encodeURIComponent(personaParam)}` : ""}${personaParam === "custom" && personaTextParam ? `&personaText=${encodeURIComponent(personaTextParam)}` : ""}&angle=${encodeURIComponent(angleParam)}${selectedIds.length > 0 ? `&images=${encodeURIComponent(selectedIds.join(","))}` : ""}`,
    );
  }

  const cardClass = (selected: boolean) =>
    `group relative aspect-square overflow-hidden rounded-xl border-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 ${
      selected ? "border-neutral-100" : "border-transparent hover:border-neutral-600"
    }`;

  function ImageCard({ candidate, selected }: { candidate: ImageCandidatesCache["primary"][number]; selected: boolean }) {
    const position = selected ? selectedIds.indexOf(candidate.id) : -1;
    return (
      <button type="button" onClick={() => toggle(candidate.id)} className={cardClass(selected)} aria-pressed={selected}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={candidate.url} alt={candidate.altText ?? ""} className="h-full w-full object-cover" />
        <span
          className={`absolute inset-0 transition ${selected ? "bg-neutral-950/10" : "bg-neutral-950/0 group-hover:bg-neutral-950/20"}`}
          aria-hidden="true"
        />
        <span
          className={`absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border text-xs font-semibold transition ${
            selected ? "border-neutral-100 bg-neutral-50 text-neutral-900" : "border-white/60 bg-black/30 text-transparent"
          }`}
          aria-hidden="true"
        >
          {selected ? (position === 0 ? "★" : position + 1) : ""}
        </span>
      </button>
    );
  }

  return (
    <>
      <ProgressSteps step={7} onBack={goBack} />
      <div className={`mx-auto w-full max-w-4xl flex-1 px-4 py-12 sm:px-8 ${hasCandidates || error ? "pb-28" : ""}`}>
        <div className="text-center">
          <h1 className="text-3xl font-semibold tracking-tight">
            {aiGenerated ? "Your free AI-generated images" : "Images from your product"}
          </h1>
          <p className="mt-3 text-base text-neutral-400">
            {aiGenerated
              ? "Select the AI images you want to use in your store"
              : "Select the images you want to use in your store"}
          </p>
        </div>

        {error && (
          <div className="mx-auto mt-10 max-w-md rounded-xl border border-neutral-800 bg-neutral-900 p-6 text-center">
            <p role="alert" className="text-sm text-red-400">
              {error}
            </p>
            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              className="mt-4 rounded-lg border border-neutral-700 px-4 py-2 text-sm font-medium text-neutral-200 transition hover:bg-neutral-800"
            >
              Retry
            </button>
          </div>
        )}

        {!error && !candidates && (
          <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-5" aria-hidden="true">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="aspect-square animate-pulse rounded-xl border border-neutral-800 bg-neutral-900" />
            ))}
            <p className="col-span-full mt-2 text-center text-sm text-neutral-500">Finding images for your product…</p>
          </div>
        )}

        {candidates && !hasCandidates && (
          <p className="mt-10 text-center text-sm text-neutral-400">
            We couldn&apos;t find suitable images for this product. You can continue without images and add some later
            in the editor.
          </p>
        )}

        {candidates && candidates.primary.length > 0 && (
          <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {candidates.primary.map((candidate) => (
              <ImageCard key={candidate.id} candidate={candidate} selected={selectedIds.includes(candidate.id)} />
            ))}
          </div>
        )}

        {candidates && candidates.other.length > 0 && (
          <div className="mt-10">
            <h2 className="text-sm font-medium text-neutral-400">Other images we found for your product</h2>
            <div className="mt-4 grid grid-cols-3 gap-2.5 sm:grid-cols-6">
              {candidates.other.map((candidate) => (
                <ImageCard key={candidate.id} candidate={candidate} selected={selectedIds.includes(candidate.id)} />
              ))}
            </div>
          </div>
        )}
      </div>

      {(hasCandidates || (candidates && !hasCandidates)) && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-neutral-800 bg-neutral-950/95 backdrop-blur">
          <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4 px-4 py-4 sm:px-8">
            <p className="text-sm text-neutral-400">
              {hasCandidates ? `${selectedIds.length} of ${MAX_SELECTED_IMAGES} selected` : "No images selected"}
            </p>
            <div className="flex items-center gap-3">
              {submitError && (
                <p role="alert" className="text-sm text-red-400">
                  {submitError}
                </p>
              )}
              <button
                type="button"
                onClick={handleGenerate}
                disabled={!canGenerate}
                className="shrink-0 rounded-lg bg-neutral-50 px-5 py-3 text-sm font-medium text-neutral-900 transition hover:bg-neutral-200 disabled:opacity-60"
              >
                {generating ? "Generating your store…" : "Generate my store"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Product Analysis step (product-analysis-progress-screen-prompt.md). Fetches the
// selected product through the existing product API — no new API/data model — then runs
// the deterministic analysis. Continue advances to the customer-language step; the Project
// itself is created at the end of the wizard, on the persona step's Continue.
function ProductAnalysisScreen({
  productId,
  backHref,
  nextHref,
}: {
  productId: string;
  backHref: string;
  nextHref: string;
}) {
  const router = useRouter();
  const [product, setProduct] = useState<ProductDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
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
          <ProductAnalysis product={product} onContinue={() => router.push(nextHref)} continuing={false} />
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
