"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ProgressSteps } from "@/components/ProgressSteps";

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
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-16">
        <h1 className="text-2xl font-semibold">How do you want to start your store?</h1>
        <p className="mt-2 text-sm text-neutral-400">
          Choose where your product comes from — we&apos;ll handle the rest.
        </p>

        <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <button
            type="button"
            onClick={() => router.push("/import?source=shopify")}
            className="flex flex-col items-start gap-3 rounded-xl border border-neutral-800 bg-neutral-900 p-4 text-left transition hover:border-neutral-600 hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-neutral-800 text-lg" aria-hidden="true">
              🛍️
            </span>
            <span className="text-sm font-medium">Import your product from Shopify</span>
          </button>

          <button
            type="button"
            onClick={() => router.push("/import?source=supplier")}
            className="flex flex-col items-start gap-3 rounded-xl border border-neutral-800 bg-neutral-900 p-4 text-left transition hover:border-neutral-600 hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-neutral-800 text-lg" aria-hidden="true">
              🔗
            </span>
            <span className="text-sm font-medium">Import from a supplier link</span>
            <span className="text-xs text-neutral-500">AliExpress, Amazon, Zendrop, Teemdrop, Etsy</span>
          </button>

          <button
            type="button"
            onClick={() => router.push("/import?source=competitor")}
            className="flex flex-col items-start gap-3 rounded-xl border border-neutral-800 bg-neutral-900 p-4 text-left transition hover:border-neutral-600 hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-neutral-800 text-lg" aria-hidden="true">
              🏬
            </span>
            <span className="text-sm font-medium">Import from a competitor store</span>
            <span className="text-xs text-neutral-500">Find products from any store</span>
          </button>
        </div>

        <div className="my-6 flex items-center gap-3 text-xs text-neutral-500">
          <div className="h-px flex-1 bg-neutral-800" />
          OR
          <div className="h-px flex-1 bg-neutral-800" />
        </div>

        <button
          type="button"
          onClick={startWithSample}
          disabled={loadingSample}
          className="rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-4 text-left transition hover:border-neutral-600 hover:bg-neutral-800 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
        >
          <span className="block text-sm font-medium">
            {loadingSample ? "Loading sample product…" : "Try a sample product"}
          </span>
          <span className="block text-xs text-neutral-400">Just see how it works</span>
        </button>
        {sampleError && (
          <p role="alert" className="mt-2 text-xs text-red-400">
            {sampleError}
          </p>
        )}
      </div>
    </div>
  );
}
