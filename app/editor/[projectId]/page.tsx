"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { PreviewFrame, SelectInfo } from "@/components/PreviewFrame";
import { SettingsPanel } from "@/components/SettingsPanel";
import { renderStorePreview } from "@/lib/preview/liquid-renderer";
import { createFetchTemplateReader } from "@/lib/preview/template-loader";
import { getSectionDefinition } from "@/lib/sections/registry";
import { StoreConfiguration } from "@/lib/store-config/types";
import type { ProductDTO } from "@/lib/product/db-mapping";
import { toNormalizedProduct } from "@/lib/product/db-mapping";

// Builder/editor chrome (prototype-phase-plan.md §15/§16). Selection + inline text
// editing come from the iframe via PreviewFrame; structural/style settings come from
// the settings panel. Every change updates Store Configuration state, never the DOM.
export default function EditorPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [product, setProduct] = useState<ProductDTO | null>(null);
  const [configuration, setConfiguration] = useState<StoreConfiguration | null>(null);
  const [html, setHtml] = useState("");
  const [selection, setSelection] = useState<SelectInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");

  const readTemplate = useMemo(() => createFetchTemplateReader(), []);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch(`/api/project/${projectId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          setLoadError(data.error);
          return;
        }
        setProduct(data.product);
        setConfiguration(data.project.configurationJson as StoreConfiguration);
      })
      .catch(() => setLoadError("Could not load this project"));
  }, [projectId]);

  // Always a fresh render() on every configuration/product change — never a DOM patch
  // (docs/product-spec/06-preview-architecture.md).
  useEffect(() => {
    if (!configuration) return;
    let cancelled = false;
    renderStorePreview({
      configuration,
      product: product ? toNormalizedProduct(product) : null,
      storeName: product?.vendor ?? product?.title ?? "Shopforge Demo",
      readTemplate,
    })
      .then((rendered) => {
        if (!cancelled) setHtml(rendered);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Render failed");
      });
    return () => {
      cancelled = true;
    };
  }, [configuration, product, readTemplate]);

  // Debounced persistence — configuration is never lost on reload (persistence test).
  useEffect(() => {
    if (!configuration) return;
    queueMicrotask(() => setSaveState("saving"));
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      fetch(`/api/project/${projectId}/configuration`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ configuration }),
      }).then(() => setSaveState("saved"));
    }, 500);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configuration]);

  const updateSetting = useCallback((sectionId: string, settingId: string, value: string | boolean) => {
    setConfiguration((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        pages: {
          product: {
            ...prev.pages.product,
            sections: prev.pages.product.sections.map((s) =>
              s.id === sectionId ? { ...s, settings: { ...s.settings, [settingId]: value } } : s,
            ),
          },
        },
      };
    });
  }, []);

  const handleSelect = useCallback((info: SelectInfo) => setSelection(info), []);
  const handleTextCommit = useCallback(
    (sectionId: string, settingId: string, value: string) => updateSetting(sectionId, settingId, value),
    [updateSetting],
  );

  if (loadError) return <p className="p-8 text-sm text-red-600">{loadError}</p>;
  if (!configuration) return <p className="p-8 text-sm text-neutral-500">Loading…</p>;

  const selectedInstance = configuration.pages.product.sections.find((s) => s.id === selection?.sectionId);
  const selectedDef = selectedInstance ? getSectionDefinition(selectedInstance.type) ?? null : null;

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-neutral-200 px-4 py-2 text-sm text-neutral-500">
        <span>{product?.title ?? "Untitled store"}</span>
        <span>{saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : ""}</span>
      </header>
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1">
          <PreviewFrame
            html={html}
            selectedSectionId={selection?.sectionId ?? null}
            onSelect={handleSelect}
            onTextCommit={handleTextCommit}
          />
        </div>
        <SettingsPanel
          definition={selectedDef}
          values={selectedInstance?.settings ?? {}}
          onChange={(settingId, value) => selectedInstance && updateSetting(selectedInstance.id, settingId, value)}
          onClose={() => setSelection(null)}
        />
      </div>
    </div>
  );
}
