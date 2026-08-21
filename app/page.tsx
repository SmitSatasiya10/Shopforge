"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ProgressSteps } from "@/components/ProgressSteps";
import { SUPPORTED_SUPPLIER_LABEL_LIST } from "@/lib/product/source";

// Start Store UI (docs/product-phases/02-product-import.md,
// supplier-competitor-import-prompt.md). All three source entry points route into the same
// /import URL-entry step, tagged with which source was chosen so the form/API can adapt
// copy and behavior without duplicating the flow.
export default function Home() {
  const router = useRouter();
  const [loadingSample, setLoadingSample] = useState(false);
  const [sampleError, setSampleError] = useState<string | null>(null);

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
      router.push(`/import?productId=${data.products[0].id}`);
    } catch (err) {
      setSampleError(err instanceof Error ? err.message : "Something went wrong");
      setLoadingSample(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col bg-neutral-950 text-neutral-50">
      <ProgressSteps step={1} />
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center px-6 py-16">
        <div className="text-center">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            How do you want to start your store?
          </h1>
          <p className="mt-3 text-base text-neutral-400">
            Choose where your product comes from — we&apos;ll handle the rest.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-3">
          <button
            type="button"
            onClick={() => router.push("/import?source=shopify")}
            className="group flex flex-col items-center gap-5 rounded-2xl border border-neutral-800 bg-neutral-900 px-6 py-10 text-center transition duration-200 hover:-translate-y-1 hover:border-neutral-600 hover:bg-neutral-800 hover:shadow-lg hover:shadow-black/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
          >
            <span
              className="flex h-20 w-20 items-center justify-center rounded-2xl bg-neutral-800 text-4xl transition duration-200 group-hover:scale-110 group-hover:bg-neutral-700"
              aria-hidden="true"
            >
              🛍️
            </span>
            <span className="flex flex-col gap-1.5">
              <span className="text-base font-semibold">Import your product from Shopify</span>
              <span className="text-sm text-neutral-500">Bring over an existing listing</span>
            </span>
          </button>

          <button
            type="button"
            onClick={() => router.push("/import?source=supplier")}
            className="group flex flex-col items-center gap-5 rounded-2xl border border-neutral-800 bg-neutral-900 px-6 py-10 text-center transition duration-200 hover:-translate-y-1 hover:border-neutral-600 hover:bg-neutral-800 hover:shadow-lg hover:shadow-black/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
          >
            <span
              className="flex h-20 w-20 items-center justify-center rounded-2xl bg-neutral-800 text-4xl transition duration-200 group-hover:scale-110 group-hover:bg-neutral-700"
              aria-hidden="true"
            >
              🔗
            </span>
            <span className="flex flex-col gap-1.5">
              <span className="text-base font-semibold">Import from a supplier link</span>
              <span className="text-sm text-neutral-500">{SUPPORTED_SUPPLIER_LABEL_LIST}</span>
            </span>
          </button>

          <button
            type="button"
            onClick={() => router.push("/import?source=competitor")}
            className="group flex flex-col items-center gap-5 rounded-2xl border border-neutral-800 bg-neutral-900 px-6 py-10 text-center transition duration-200 hover:-translate-y-1 hover:border-neutral-600 hover:bg-neutral-800 hover:shadow-lg hover:shadow-black/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
          >
            <span
              className="flex h-20 w-20 items-center justify-center rounded-2xl bg-neutral-800 text-4xl transition duration-200 group-hover:scale-110 group-hover:bg-neutral-700"
              aria-hidden="true"
            >
              🏬
            </span>
            <span className="flex flex-col gap-1.5">
              <span className="text-base font-semibold">Import from a competitor store</span>
              <span className="text-sm text-neutral-500">Find products from any store</span>
            </span>
          </button>
        </div>

        <div className="mx-auto my-10 flex w-full max-w-md items-center gap-4 text-xs font-medium tracking-widest text-neutral-500">
          <div className="h-px flex-1 bg-neutral-800" />
          OR
          <div className="h-px flex-1 bg-neutral-800" />
        </div>

        <button
          type="button"
          onClick={startWithSample}
          disabled={loadingSample}
          className="mx-auto w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900 px-6 py-5 text-center transition duration-200 hover:border-neutral-600 hover:bg-neutral-800 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
        >
          <span className="block text-base font-semibold">
            {loadingSample ? "Loading sample product…" : "Try a sample product"}
          </span>
          <span className="mt-1 block text-sm text-neutral-500">Just see how it works</span>
        </button>
        {sampleError && (
          <p role="alert" className="mx-auto mt-3 w-full max-w-md text-center text-sm text-red-400">
            {sampleError}
          </p>
        )}
      </div>
    </div>
  );
}
