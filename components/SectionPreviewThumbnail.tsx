"use client";

import { useEffect, useRef, useState } from "react";
import { LayoutTemplate } from "lucide-react";
import type { NormalizedProduct } from "@/lib/product/types";
import { getSectionPreviewHtml } from "@/lib/preview/section-preview";
import type { BinaryReader, TemplateReader } from "@/lib/preview/template-loader";

interface SectionPreviewThumbnailProps {
  catalogId: string;
  templateName: string;
  readTemplate: TemplateReader;
  readBinary?: BinaryReader;
  product: NormalizedProduct | null;
  storeName: string;
}

// The design resolution the preview document is rendered/cropped at — a fixed width forces a
// desktop-layout render regardless of how small the card actually displays; overflow-hidden on
// the (aspect-video) wrapper then crops down to the top portion, like a screenshot thumbnail.
const DESIGN_WIDTH = 1440;
const DESIGN_HEIGHT = (DESIGN_WIDTH * 9) / 16;

/**
 * One Add Section card's live preview: a real render of that section (lib/preview/section-
 * preview.ts) scaled into the card via CSS transform, with a loading skeleton and a fallback
 * to the plain icon tile on failure — a broken section type must never break the rest of the
 * grid (docs intent from the Add Section picker work).
 */
export function SectionPreviewThumbnail({
  catalogId,
  templateName,
  readTemplate,
  readBinary,
  product,
  storeName,
}: SectionPreviewThumbnailProps) {
  const [html, setHtml] = useState<string | null | undefined>(undefined);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getSectionPreviewHtml({ catalogId, templateName, readTemplate, readBinary, product, storeName }).then(
      (result) => {
        if (!cancelled) setHtml(result);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [catalogId, templateName, readTemplate, readBinary, product, storeName]);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const update = () => setScale(el.clientWidth / DESIGN_WIDTH);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={wrapperRef} className="relative aspect-video w-full overflow-hidden rounded-lg bg-neutral-700/60">
      {html === undefined ? (
        <div className="absolute inset-0 animate-pulse bg-neutral-700/40" />
      ) : html === null ? (
        <div className="absolute inset-0 grid place-items-center">
          <LayoutTemplate className="h-6 w-6 text-neutral-500" strokeWidth={1.5} />
        </div>
      ) : scale > 0 ? (
        <iframe
          title={`${catalogId} preview`}
          srcDoc={html}
          sandbox="allow-same-origin"
          tabIndex={-1}
          className="pointer-events-none absolute top-0 left-0 origin-top-left border-0"
          style={{ width: DESIGN_WIDTH, height: DESIGN_HEIGHT, transform: `scale(${scale})` }}
        />
      ) : null}
    </div>
  );
}
