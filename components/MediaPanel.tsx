"use client";

import { useRef, useState } from "react";
import { Upload, X } from "lucide-react";

interface MediaPanelProps {
  open: boolean;
  images: { url: string; altText: string | null }[];
  onSelect: (url: string) => void;
  onClose: () => void;
}

type Tab = "product" | "reviews" | "uploaded";

const TABS: { id: Tab; label: string }[] = [
  { id: "product", label: "Product" },
  { id: "reviews", label: "Reviews" },
  { id: "uploaded", label: "Uploaded" },
];

// Kept well under typical request-body/JSON-column limits — an image_picker value is stored as
// a data: URI directly in the template JSON until publish converts it into a real Shopify file
// (lib/shopify/asset-upload.ts), so an oversized upload would bloat every save until then.
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/**
 * "Your media" — browse existing product photos and assign one to the currently targeted
 * image_picker setting (opened via SettingsPanel's "Browse media" button). Product images come
 * straight from the project's own product data; Reviews has no backing data source in this app
 * yet, so it shows an honest empty state rather than fabricated content. Uploaded holds images
 * picked from the user's device for this session, encoded as data: URIs (the same value shape
 * every other tab hands to onSelect).
 */
export function MediaPanel({ open, images, onSelect, onClose }: MediaPanelProps) {
  const [tab, setTab] = useState<Tab>("product");
  const [uploaded, setUploaded] = useState<{ url: string; altText: string | null }[]>([]);

  if (!open) return null;

  return (
    <div className="fixed inset-y-0 left-0 z-40 flex w-72 flex-col bg-neutral-900 text-white shadow-2xl ring-1 ring-white/10">
      <div className="flex items-center justify-between px-4 py-3">
        <p className="text-sm font-semibold">Your media</p>
        <button onClick={onClose} title="Close" className="rounded p-1 text-neutral-400 hover:bg-neutral-700 hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex border-b border-white/10 px-4">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-2 py-2 text-xs font-medium ${
              tab === t.id ? "border-white text-white" : "border-transparent text-neutral-400 hover:text-neutral-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {tab === "product" ? (
          <ProductTab images={images} onSelect={onSelect} />
        ) : tab === "uploaded" ? (
          <UploadedTab
            images={uploaded}
            onSelect={onSelect}
            onUpload={(image) => setUploaded((prev) => [image, ...prev])}
          />
        ) : (
          <EmptyTab />
        )}
      </div>
    </div>
  );
}

function ProductTab({ images, onSelect }: { images: { url: string; altText: string | null }[]; onSelect: (url: string) => void }) {
  if (images.length === 0) {
    return <p className="px-1 py-4 text-xs text-neutral-400">No product images yet.</p>;
  }
  return (
    <div className="grid grid-cols-2 gap-2">
      {images.map((image, i) => (
        <button
          key={`${image.url}-${i}`}
          onClick={() => onSelect(image.url)}
          title={image.altText ?? undefined}
          className="aspect-square overflow-hidden rounded-lg bg-neutral-800 ring-1 ring-white/10 hover:ring-white/40"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.url}
            alt={image.altText ?? ""}
            className="h-full w-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        </button>
      ))}
    </div>
  );
}

function UploadedTab({
  images,
  onSelect,
  onUpload,
}: {
  images: { url: string; altText: string | null }[];
  onSelect: (url: string) => void;
  onUpload: (image: { url: string; altText: string | null }) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFile = (file: File) => {
    setError(null);
    if (!file.type.startsWith("image/")) {
      setError("Choose an image file.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError("Image is too large (max 8MB).");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      onUpload({ url: reader.result as string, altText: file.name });
    };
    reader.onerror = () => setError("Couldn't read that file.");
    reader.readAsDataURL(file);
  };

  return (
    <div className="flex flex-col gap-3">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
      />
      <button
        onClick={() => inputRef.current?.click()}
        className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/20 py-3 text-xs font-medium text-neutral-300 hover:border-white/40 hover:text-white"
      >
        <Upload className="h-3.5 w-3.5" strokeWidth={1.75} />
        Upload image
      </button>
      {error ? <p className="text-xs text-red-400">{error}</p> : null}
      {images.length === 0 ? (
        <p className="px-1 py-1 text-xs text-neutral-400">Images you upload appear here.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {images.map((image, i) => (
            <button
              key={`${image.url}-${i}`}
              onClick={() => onSelect(image.url)}
              title={image.altText ?? undefined}
              className="aspect-square overflow-hidden rounded-lg bg-neutral-800 ring-1 ring-white/10 hover:ring-white/40"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image.url} alt={image.altText ?? ""} className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyTab() {
  return <p className="px-1 py-4 text-xs text-neutral-400">Review images aren&apos;t available yet.</p>;
}
