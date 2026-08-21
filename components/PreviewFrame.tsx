"use client";

import { useEffect, useRef } from "react";

export interface SelectInfo {
  sectionId: string;
  sectionType: string | null;
  settingId: string | null;
  editable: string | null;
}

interface PreviewFrameProps {
  html: string;
  selectedSectionId: string | null;
  onSelect: (info: SelectInfo) => void;
  onTextCommit: (sectionId: string, settingId: string, value: string) => void;
}

/**
 * Same-origin sandboxed preview iframe (docs/product-spec/08-preview-iframe.md,
 * prototype-phase-plan.md §3 — binding decision). `sandbox="allow-same-origin"` only,
 * set once, never mutated, never `allow-scripts`. React reaches directly into
 * `contentDocument` for click-to-select and inline text editing — no postMessage,
 * because same-origin gives direct DOM access without it.
 */
export function PreviewFrame({ html, selectedSectionId, onSelect, onTextCommit }: PreviewFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const handleLoad = () => {
      const doc = iframe.contentDocument;
      if (!doc) return;

      const handleClick = (e: MouseEvent) => {
        let node = e.target as HTMLElement | null;
        while (node && node !== doc.body) {
          const settingId = node.getAttribute("data-sf-setting");
          const sectionEl = node.closest("[data-sf-section-id]") as HTMLElement | null;
          if (settingId && sectionEl) {
            const editable = node.getAttribute("data-sf-editable");
            onSelect({
              sectionId: sectionEl.getAttribute("data-sf-section-id")!,
              sectionType: sectionEl.getAttribute("data-sf-section-type"),
              settingId,
              editable,
            });
            if (editable === "text" || editable === "richtext") {
              enableInlineEdit(node, settingId, sectionEl.getAttribute("data-sf-section-id")!);
            }
            return;
          }
          if (sectionEl) {
            onSelect({
              sectionId: sectionEl.getAttribute("data-sf-section-id")!,
              sectionType: sectionEl.getAttribute("data-sf-section-type"),
              settingId: null,
              editable: null,
            });
            return;
          }
          node = node.parentElement;
        }
      };

      const enableInlineEdit = (node: HTMLElement, settingId: string, sectionId: string) => {
        node.setAttribute("contenteditable", "true");
        node.focus();
        const commit = () => {
          node.removeAttribute("contenteditable");
          node.removeEventListener("blur", commit);
          onTextCommit(sectionId, settingId, node.textContent?.trim() ?? "");
        };
        node.addEventListener("blur", commit);
      };

      doc.addEventListener("click", handleClick);
    };

    iframe.addEventListener("load", handleLoad);
    return () => iframe.removeEventListener("load", handleLoad);
  }, [onSelect, onTextCommit]);

  // Toggle the selection outline on the currently-loaded document without a re-render.
  useEffect(() => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    doc.querySelectorAll("[data-sf-section-id]").forEach((el) => {
      el.classList.toggle(
        "sf-selected",
        el.getAttribute("data-sf-section-id") === selectedSectionId,
      );
    });
  }, [selectedSectionId, html]);

  return (
    <iframe
      ref={iframeRef}
      sandbox="allow-same-origin"
      srcDoc={html}
      title="Store preview"
      className="h-full w-full border-0 bg-white"
    />
  );
}
