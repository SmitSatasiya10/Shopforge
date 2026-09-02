"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  Circle,
  ImageOff,
  LoaderCircle,
  RectangleHorizontal,
  RectangleVertical,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import type { ImageEditAspect, ImageEditMode } from "@/lib/ai/image-editor";
import type { GeneratedImage } from "@/lib/product/generated-images";

const ASPECTS: { id: ImageEditAspect; label: string; icon: typeof Square }[] = [
  { id: "auto", label: "Auto", icon: Sparkles },
  { id: "landscape", label: "Landscape", icon: RectangleHorizontal },
  { id: "portrait", label: "Portrait", icon: RectangleVertical },
  { id: "square", label: "Square", icon: Square },
  { id: "circle", label: "Circle", icon: Circle },
];

const STYLE_PRESETS = ["Minimal studio", "Warm lifestyle", "Bold editorial", "Natural light"];

const MODES: { id: ImageEditMode; label: string }[] = [
  { id: "edit", label: "Edit this image" },
  { id: "generate", label: "New image" },
  { id: "infographic", label: "Infographic" },
];

interface AiImageEditPanelProps {
  productId: string | null;
  /** The currently selected theme image — the default reference for "edit"/starting point for the panel's preview. */
  sourceImageUrl: string;
  onChooseReference: () => void;
  /** Called once a generation succeeds, so the caller can add it to the product's reusable media grid without a refetch. */
  onGenerated: (image: GeneratedImage) => void;
  /** Writes the accepted result into the currently targeted image_picker setting via the existing updateSetting path. */
  onUseImage: (url: string) => void;
  onClose: () => void;
  /** Mirrors this panel's own `busy` state out to the caller, so the shared GenerationOverlay
   *  over the live preview's selected image can track the same request lifecycle. */
  onBusyChange?: (busy: boolean) => void;
}

/**
 * "Edit with AI" — the left-sidebar-slot panel (same spot as MediaPanel and the AI content
 * panel) opened from ImageChangeButton. Generating never writes to configurationJson; only
 * "Use image" does, through the caller's existing updateSetting path. A successful generation
 * is always persisted server-side (POST /api/product/:id/images/generate) regardless of
 * whether "Use image" is ever clicked, so a paid-for call is never wasted.
 */
export function AiImageEditPanel({
  productId,
  sourceImageUrl,
  onChooseReference,
  onGenerated,
  onUseImage,
  onClose,
  onBusyChange,
}: AiImageEditPanelProps) {
  const [mode, setMode] = useState<ImageEditMode>("edit");
  const [instruction, setInstruction] = useState("");
  const [aspect, setAspect] = useState<ImageEditAspect>("auto");
  const [stylePreset, setStylePreset] = useState<string>("");
  const [claim, setClaim] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ url: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Aborts an in-flight generation if the panel unmounts (user closes it or navigates away
  // mid-request) — no partial DB write happens for an aborted call, since the route only
  // persists after a completed provider response.
  useEffect(() => () => abortRef.current?.abort(), []);

  const referenceRequired = mode === "edit" && !sourceImageUrl;

  const generate = async () => {
    if (busy || !instruction.trim() || !productId || referenceRequired) return;
    setBusy(true);
    onBusyChange?.(true);
    setError(null);
    setResult(null);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`/api/product/${productId}/images/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          instruction: instruction.trim(),
          mode,
          sourceImageUrl: mode === "edit" ? sourceImageUrl : null,
          aspect,
          stylePreset: stylePreset || undefined,
          claim: mode === "infographic" && claim.trim() ? claim.trim() : undefined,
        }),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Generation failed");
        return;
      }
      setResult({ url: data.image.url });
      onGenerated(data.image as GeneratedImage);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError("Generation failed. Try again.");
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  };

  return (
    <div className="flex min-h-0 w-72 shrink-0 flex-col gap-3 overflow-y-auto border-r border-neutral-200 bg-white p-4 text-neutral-900">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-neutral-900">Edit with AI</p>
        <button onClick={onClose} title="Close" className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-900">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-neutral-100 ring-1 ring-neutral-200">
          {sourceImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={sourceImageUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="grid h-full w-full place-items-center text-neutral-300">
              <ImageOff className="h-5 w-5" strokeWidth={1.5} />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-neutral-700">Reference image</p>
          <button onClick={onChooseReference} className="text-xs font-medium text-neutral-500 underline hover:text-neutral-900">
            Choose different image
          </button>
        </div>
      </div>

      <div className="flex rounded-lg bg-neutral-100 p-0.5 text-xs font-medium">
        {MODES.map((m) => (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            className={`flex-1 rounded-md px-2 py-1.5 ${mode === m.id ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-900"}`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <textarea
        rows={3}
        value={instruction}
        disabled={busy}
        onChange={(e) => setInstruction(e.target.value)}
        placeholder={
          mode === "infographic"
            ? "Describe the infographic, e.g. \"Show the product with a clean feature callout\""
            : mode === "edit"
              ? "e.g. \"Put this product on a marble bathroom counter\""
              : "e.g. \"Create a premium studio product photo\""
        }
        className="resize-none rounded-lg border border-neutral-200 p-2 text-xs outline-none placeholder-neutral-400 focus:border-neutral-400 disabled:opacity-50"
      />

      {referenceRequired ? <p className="text-xs text-amber-600">Choose a reference image to edit first.</p> : null}

      <div>
        <p className="mb-1.5 text-[10px] font-semibold tracking-widest text-neutral-400 uppercase">Aspect</p>
        <div className="flex gap-1">
          {ASPECTS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              title={label}
              onClick={() => setAspect(id)}
              className={`grid h-8 flex-1 place-items-center rounded-lg ring-1 ${
                aspect === id ? "bg-neutral-900 text-white ring-neutral-900" : "text-neutral-500 ring-neutral-200 hover:bg-neutral-50"
              }`}
            >
              <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          ))}
        </div>
      </div>

      <div>
        <button
          onClick={() => setAdvancedOpen((v) => !v)}
          className="text-xs font-medium text-neutral-600 hover:text-neutral-900"
        >
          Advanced {advancedOpen ? "▲" : "▼"}
        </button>
        {advancedOpen ? (
          <div className="mt-2 flex flex-col gap-2">
            <div>
              <p className="mb-1 text-[10px] font-semibold tracking-widest text-neutral-400 uppercase">Style preset</p>
              <select
                value={stylePreset}
                onChange={(e) => setStylePreset(e.target.value)}
                className="w-full rounded-lg border border-neutral-200 p-1.5 text-xs outline-none focus:border-neutral-400"
              >
                <option value="">None</option>
                {STYLE_PRESETS.map((preset) => (
                  <option key={preset} value={preset}>
                    {preset}
                  </option>
                ))}
              </select>
            </div>
            {mode === "infographic" ? (
              <div>
                <p className="mb-1 text-[10px] font-semibold tracking-widest text-neutral-400 uppercase">Exact text/claim</p>
                <textarea
                  rows={2}
                  value={claim}
                  onChange={(e) => setClaim(e.target.value)}
                  placeholder={'e.g. "30-day money-back guarantee"'}
                  className="w-full resize-none rounded-lg border border-neutral-200 p-2 text-xs outline-none placeholder-neutral-400 focus:border-neutral-400"
                />
                <p className="mt-1 text-[10px] text-neutral-400">Rendered exactly as typed — nothing else is added.</p>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <button
        onClick={generate}
        disabled={busy || !instruction.trim() || referenceRequired}
        className="flex items-center justify-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-2 text-xs font-medium text-white disabled:opacity-40"
      >
        {busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" strokeWidth={2} /> : <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />}
        {busy ? "Generating…" : "Generate"}
      </button>

      {error ? (
        <p className="flex items-start gap-1.5 text-xs text-red-600">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-2">
          <div className="overflow-hidden rounded-lg bg-neutral-100">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={result.url} alt="" className="max-h-48 w-full object-contain" />
          </div>
          <div className="flex gap-2">
            <button
              onClick={generate}
              disabled={busy}
              className="flex-1 rounded-lg border border-neutral-200 px-2 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-40"
            >
              Regenerate
            </button>
            <button
              onClick={() => onUseImage(result.url)}
              className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-neutral-900 px-2 py-1.5 text-xs font-medium text-white hover:bg-neutral-800"
            >
              <Check className="h-3.5 w-3.5" strokeWidth={2} />
              Use image
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
