"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ProductDTO } from "@/lib/product/db-mapping";
import { ProgressSteps } from "@/components/ProgressSteps";
import { ProductCard } from "@/components/ProductCard";
import { ProductAnalysis } from "@/components/product-analysis/ProductAnalysis";
import { validateProductUrl } from "@/lib/product/url-validation";
import { SUPPORTED_SUPPLIER_LABEL_LIST, type ProductImportSource } from "@/lib/product/source";
import {
  PRIMARY_STORE_LANGUAGES,
  OTHER_STORE_LANGUAGES,
  findStoreLanguage,
  normalizeStoreLanguage,
  type StoreLanguage,
} from "@/lib/store-config/language";
import type { PersonaOption } from "@/lib/store-config/persona";
import type { MarketingAngleOption } from "@/lib/store-config/marketing-angle";

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

  const backParam = productId ? `productId=${productId}` : `productIds=${productIdsParam ?? ""}`;

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
        />
      </div>
    );
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
        />
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
  language,
  personaQuery,
}: {
  ids: string[];
  source: ProductImportSource;
  partialFailed: number;
  partialTotal: number;
  related?: boolean;
  language: string | null;
  personaQuery: string;
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
    const backParam = ids.length === 1 ? `productId=${ids[0]}` : `productIds=${ids.join(",")}`;
    router.push(
      `/import?source=${source}&${backParam}&selected=${selectedId}&step=analysis${language ? `&language=${language}` : ""}${personaQuery}`,
    );
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
}: {
  source: ProductImportSource;
  backParam: string;
  selectedProductId: string;
  language: string | null;
  initialPersonaId: string | null;
  initialCustomText: string;
  substep: "persona" | "angle";
  initialAngleId: string | null;
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

  // The angle state is the last wizard state: Continue creates the Project (persisting
  // language + persona + marketing angle) and enters the editor.
  const [continuing, setContinuing] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function handleAngleContinue() {
    if (!canContinueAngle || !selectedAngleId || continuing) return;
    const angleId = selectedAngleId === "ai" ? currentAngles?.recommendedId : selectedAngleId;
    if (!angleId) return;
    setContinuing(true);
    setSubmitError(null);
    const res = await fetch("/api/project", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        productId: selectedProductId,
        ...(language ? { language } : {}),
        ...(selectedId === "custom"
          ? { personaText: customText.trim() }
          : { personaId: selectedId }),
        angleId,
        angleSelectionType: selectedAngleId === "ai" ? "ai" : "generated",
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setSubmitError(data.error ?? "Could not create the project");
      setContinuing(false);
      return;
    }
    router.push(`/editor/${data.project.id}`);
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
                <div className="mt-8" aria-hidden="true">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {[0, 1, 2, 3].map((i) => (
                      <div key={i} className="h-36 animate-pulse rounded-xl border border-neutral-800 bg-neutral-900" />
                    ))}
                  </div>
                  <p className="mt-4 text-center text-sm text-neutral-500">
                    Crafting your marketing angles…
                  </p>
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
                {submitError && (
                  <p role="alert" className="mb-3 text-center text-sm text-red-400">
                    {submitError}
                  </p>
                )}
                <button
                  type="button"
                  onClick={handleAngleContinue}
                  disabled={!canContinueAngle || continuing}
                  className="w-full rounded-xl bg-neutral-50 px-6 py-4 text-base font-semibold text-neutral-900 transition hover:bg-neutral-200 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
                >
                  {continuing ? "Creating your store…" : "Continue"}
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
              <div className="mt-8 flex flex-col gap-3" aria-hidden="true">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="h-[76px] animate-pulse rounded-xl border border-neutral-800 bg-neutral-900" />
                ))}
                <p className="mt-2 text-center text-sm text-neutral-500">
                  Finding your ideal customers…
                </p>
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
