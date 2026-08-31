"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Building2, Check, Link2, Sparkles, Store } from "lucide-react";
import { SUPPORTED_SUPPLIER_LABEL_LIST, type ProductImportSource } from "@/lib/product/source";

// Start Store UI (docs/product-phases/02-product-import.md,
// supplier-competitor-import-prompt.md). All three source entry points route into the same
// /import URL-entry step, tagged with which source was chosen so the form/API can adapt
// copy and behavior without duplicating the flow. Extracted from the old `/` landing page so
// it can be reused as the dashboard's empty state (a brand-new account with no stores yet)
// as well as anywhere else "start a new store" needs to be offered.
const SOURCES: Array<{
  id: ProductImportSource;
  icon: typeof Store;
  label: string;
  title: string;
  description: string;
  caption?: string;
  recommended?: boolean;
}> = [
  {
    id: "shopify",
    icon: Store,
    label: "Existing store",
    title: "Import from Shopify",
    description: "Bring over an existing product listing.",
    recommended: true,
  },
  {
    id: "supplier",
    icon: Link2,
    label: "Product URL",
    title: "Import from a supplier",
    description: "Start with a product URL from your supplier.",
    caption: SUPPORTED_SUPPLIER_LABEL_LIST,
  },
  {
    id: "competitor",
    icon: Building2,
    label: "Store URL",
    title: "Analyze a competitor",
    description: "Use an existing storefront as inspiration.",
  },
];

export function StartStoreHero() {
  const router = useRouter();
  const [pendingSource, setPendingSource] = useState<ProductImportSource | null>(null);
  const [loadingSample, setLoadingSample] = useState(false);
  const [sampleError, setSampleError] = useState<string | null>(null);
  const navigating = pendingSource !== null || loadingSample;

  function goToSource(source: ProductImportSource) {
    if (navigating) return;
    setPendingSource(source);
    router.push(`/import?source=${source}`);
  }

  async function startWithSample() {
    setLoadingSample(true);
    setSampleError(null);
    try {
      const res = await fetch("/api/product/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sample: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not load the sample product");
      router.push(`/import?productId=${data.products[0].id}&sample=1`);
    } catch (err) {
      setSampleError(err instanceof Error ? err.message : "Something went wrong");
      setLoadingSample(false);
    }
  }

  return (
    <div className="relative isolate flex flex-1 flex-col overflow-hidden bg-[#09090B] text-[#FAFAFA]">
      <div className="bg-grain pointer-events-none absolute inset-0 -z-10 opacity-[0.025]" aria-hidden="true" />
      <div
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[560px] bg-[radial-gradient(ellipse_60%_50%_at_50%_0%,rgba(139,92,246,0.16),transparent_70%)]"
        aria-hidden="true"
      />

      <div className="mx-auto flex w-full max-w-[1050px] flex-1 flex-col justify-center px-6 py-14 sm:py-16">
        <div className="animate-fade-up text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-medium tracking-[0.08em] text-[#A78BFA] uppercase">
            <Sparkles className="h-3 w-3" aria-hidden="true" />
            AI Store Builder
          </span>

          <h1 className="mt-5 text-[38px] leading-[1.08] font-semibold tracking-[-0.02em] text-balance sm:text-[52px]">
            Build your store with AI.
          </h1>

          <p className="mx-auto mt-4 max-w-[600px] text-[15px] text-[#A1A1AA] sm:text-[17px]">
            Bring a product, supplier link, or competitor store. We&apos;ll handle the rest.
          </p>

          <div className="mt-6 inline-flex items-center gap-1.5 text-[11px] font-medium text-[#71717A]">
            <Sparkles className="h-3 w-3 text-[#8B5CF6]" aria-hidden="true" />
            AI-powered storefront generation
          </div>
        </div>

        <p
          className="animate-fade-up mt-14 text-center text-[15px] font-semibold text-[#D4D4D8] sm:text-[18px]"
          style={{ animationDelay: "80ms" }}
        >
          Where is your product coming from?
        </p>

        <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-3">
          {SOURCES.map((src, i) => {
            const Icon = src.icon;
            const isSelected = pendingSource === src.id;
            return (
              <button
                key={src.id}
                type="button"
                onClick={() => goToSource(src.id)}
                disabled={navigating}
                style={{ animationDelay: `${120 + i * 70}ms` }}
                className={`group animate-fade-up relative flex flex-col gap-5 rounded-2xl border px-6 py-6 text-left transition-all duration-200 focus-visible:ring-2 focus-visible:ring-[#8B5CF6]/60 focus-visible:outline-none disabled:cursor-default ${
                  isSelected
                    ? "border-[#8B5CF6] bg-[#8B5CF6]/[0.07]"
                    : src.recommended
                      ? "border-[#8B5CF6]/25 bg-[#111113] hover:-translate-y-1 hover:border-[#8B5CF6]/50 hover:bg-[#151518] hover:shadow-[0_12px_32px_-12px_rgba(139,92,246,0.25)]"
                      : "border-white/[0.08] bg-[#111113] hover:-translate-y-1 hover:border-white/20 hover:bg-[#151518] hover:shadow-[0_12px_32px_-16px_rgba(0,0,0,0.6)]"
                } ${navigating && !isSelected ? "opacity-40" : ""}`}
              >
                {src.recommended && (
                  <span className="absolute -top-2.5 right-5 rounded-full border border-[#8B5CF6]/30 bg-[#1B1530] px-2.5 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-[#A78BFA] uppercase">
                    Recommended
                  </span>
                )}

                <div className="flex items-center justify-between">
                  <span
                    className={`flex h-12 w-12 items-center justify-center rounded-xl border transition-transform duration-200 group-hover:scale-105 sm:h-14 sm:w-14 ${
                      src.recommended
                        ? "border-[#8B5CF6]/25 bg-[#8B5CF6]/[0.08] text-[#A78BFA]"
                        : "border-white/10 bg-white/[0.04] text-[#A1A1AA]"
                    }`}
                    aria-hidden="true"
                  >
                    <Icon className="h-5 w-5 sm:h-6 sm:w-6" strokeWidth={1.75} />
                  </span>
                  {isSelected ? (
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#8B5CF6] text-white">
                      <Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
                    </span>
                  ) : (
                    <ArrowRight
                      className="h-4 w-4 text-[#52525B] transition-all duration-200 group-hover:translate-x-1 group-hover:text-[#A1A1AA]"
                      aria-hidden="true"
                    />
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-semibold tracking-[0.08em] text-[#71717A] uppercase">
                    {src.label}
                  </span>
                  <span className="text-[16px] font-semibold text-[#FAFAFA] sm:text-[17px]">{src.title}</span>
                  <span className="text-[13px] leading-relaxed text-[#A1A1AA] sm:text-[14px]">
                    {src.description}
                  </span>
                  {src.caption && <span className="mt-0.5 text-[11px] text-[#52525B]">{src.caption}</span>}
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-12 flex flex-col items-center">
          <div className="flex w-full max-w-md items-center gap-4" aria-hidden="true">
            <div className="h-px flex-1 bg-white/[0.08]" />
            <span className="text-[10px] font-medium tracking-[0.12em] text-[#52525B] uppercase">Or</span>
            <div className="h-px flex-1 bg-white/[0.08]" />
          </div>

          <div className="mt-6 text-center">
            <p className="text-[13px] text-[#71717A]">Not ready to import a product?</p>
            <button
              type="button"
              onClick={startWithSample}
              disabled={navigating}
              className="group mt-1 inline-flex items-center gap-1.5 rounded-md text-[14px] font-medium text-[#D4D4D8] transition-colors duration-200 hover:text-[#FAFAFA] focus-visible:ring-2 focus-visible:ring-[#8B5CF6]/60 focus-visible:outline-none disabled:opacity-60"
            >
              {loadingSample ? "Loading sample product…" : "Try a sample product"}
              <ArrowRight
                className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-1"
                aria-hidden="true"
              />
            </button>
            <p className="mt-1.5 text-[12px] text-[#52525B]">Explore the complete AI workflow with a demo product.</p>
          </div>

          {sampleError && (
            <p role="alert" className="mt-3 text-center text-[13px] text-red-400">
              {sampleError}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
