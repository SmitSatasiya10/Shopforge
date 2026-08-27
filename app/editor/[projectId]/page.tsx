"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { AlertCircle, Monitor, Plus, Redo2, Smartphone, Undo2, X } from "lucide-react";
import { PreviewFrame, SelectInfo, SelectionRect } from "@/components/PreviewFrame";
import { SettingsPanel } from "@/components/SettingsPanel";
import { MediaPanel } from "@/components/MediaPanel";
import { EditorRail } from "@/components/EditorRail";
import { AiRewritePopover } from "@/components/AiRewritePopover";
import { SectionToolbar } from "@/components/SectionToolbar";
import { SectionPicker } from "@/components/SectionPicker";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { HistoryPanel } from "@/components/HistoryPanel";
import { InlineTextToolbar } from "@/components/InlineTextToolbar";
import { ImageChangeButton } from "@/components/ImageChangeButton";
import { renderTemplate } from "@/lib/preview/template-renderer";
import { createFetchTemplateReader, createFetchBinaryReader } from "@/lib/preview/template-loader";
import {
  loadBlockSchema,
  loadSectionSchema,
  ShopifySectionSchema,
  ShopifySettingDef,
} from "@/lib/preview/section-schema";
import { PAGE_TEMPLATES, PageTemplate, parseConfiguration, StoreConfiguration } from "@/lib/store-config/store";
import { deriveStoreName } from "@/lib/store-config/store-name";
import {
  getBlockAt,
  insertSection,
  moveSection,
  removeBlockAt,
  removeSection,
  replaceSection,
  setSettingAtPath,
  setSettingsAtPath,
} from "@/lib/store-config/template-ops";
import { createSectionInstance, generateInstanceId, presetBlockTypes } from "@/lib/store-config/section-factory";
// Type-only: lib/ai/catalog.ts reads from disk (node:fs/promises) and must never be imported
// for its runtime code from this client component — GET /api/catalog/sections is how this
// page reaches loadCatalog()'s data instead.
import type { SectionSchema } from "@/lib/ai/catalog";
import { applyMagicBrush, cycleColorScheme, rollPalette, PALETTES } from "@/lib/editor/magic-brush";
import {
  locateBlockPathByType,
  locateTextSetting,
  normalizeText,
  PRODUCT_TITLE_SETTING,
  PRODUCT_DESCRIPTION_SETTING,
  TextBinding,
} from "@/lib/editor/setting-locator";
import { applyAlign, applyColor, cycleWeight, findTextControls, stepSize } from "@/lib/editor/text-controls";
import { buildThemePalette, parsePredefinedSwatches, FALLBACK_COMMON_COLORS, NamedColor, ThemeColorRow } from "@/lib/editor/color-palette";
import { loadThemeSettings } from "@/lib/preview/theme-settings";
import type { ProductDTO } from "@/lib/product/db-mapping";
import { toNormalizedProduct } from "@/lib/product/db-mapping";

interface Snapshot {
  configuration: StoreConfiguration;
  product: ProductDTO | null;
}

const HISTORY_LIMIT = 50;
// Edits within this window of the previous one ride on the same undo step, so dragging a
// slider or typing a sentence undoes as one action instead of one keystroke at a time.
const HISTORY_COALESCE_MS = 700;

// Builder/editor chrome. Selection comes from the iframe via PreviewFrame; edits go through
// the section toolbar (magic brush / AI rewrite / move / delete), the inline text toolbar,
// or the Inspector — and every one of them updates the template JSON, never the DOM
// (docs/product-spec/06-preview-architecture.md, docs/EDITOR-TOOLBARS.md).
export default function EditorPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [product, setProduct] = useState<ProductDTO | null>(null);
  const [configuration, setConfiguration] = useState<StoreConfiguration | null>(null);
  const [page, setPage] = useState<PageTemplate>("product");
  const [html, setHtml] = useState("");
  const [selection, setSelection] = useState<SelectInfo | null>(null);
  const [selectionRect, setSelectionRect] = useState<SelectionRect | null>(null);
  // The image_picker setting currently targeted by "Browse media" (MediaPanel) — cleared
  // whenever the selected section changes so a stale target can't be written to. blockPath is
  // set when the setting lives inside a block (e.g. a hotspot's own image), empty for a
  // section-level setting, so the picked url lands on the right node either way.
  const [mediaPickerTarget, setMediaPickerTarget] = useState<{ settingId: string; blockPath: string[] } | null>(
    null,
  );
  const [schema, setSchema] = useState<{ type: string; schema: ShopifySectionSchema | null } | null>(null);
  const [boundDefs, setBoundDefs] = useState<{ key: string; defs: ShopifySettingDef[] } | null>(null);
  const [schemaLocale, setSchemaLocale] = useState<Record<string, unknown>>({});
  // Feeds the inline toolbar's color picker ("Theme"/"Common Colors" tabs) from the store's
  // own settings_data.json, rather than the picker only ever offering a bare hex input.
  const [themeColorRows, setThemeColorRows] = useState<ThemeColorRow[]>([]);
  const [commonColors, setCommonColors] = useState<NamedColor[]>(FALLBACK_COMMON_COLORS);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [generating, setGenerating] = useState(false);
  const [rewriting, setRewriting] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [showRewrite, setShowRewrite] = useState(false);
  const [generateImages, setGenerateImages] = useState(false);
  // The import wizard's generation call is best-effort and never blocks navigation — if it
  // failed, it flags this via a query param rather than leaving the merchant looking at the
  // un-generated default store with no explanation. Read once, at mount, via the lazy
  // initializer rather than an effect (avoids a same-mount cascading re-render for a value
  // available synchronously on first render).
  const [notice, setNotice] = useState<string | null>(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("generationFailed") === "1"
      ? "AI generation didn't run for this store yet — click Generate to try again."
      : null,
  );
  // Which delete is awaiting confirmation in the ConfirmDialog (replaces window.confirm).
  const [confirmDelete, setConfirmDelete] = useState<"section" | "block" | null>(null);
  const [previewHeight, setPreviewHeight] = useState(600);
  const [viewport, setViewport] = useState<"desktop" | "mobile">("desktop");
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  // Transient toast for the inline toolbar's size stepper hitting either end of the scale —
  // separate from `notice` (a persistent banner for load/save errors), since this is a brief,
  // self-dismissing hint rather than something the user needs to act on or acknowledge.
  const [sizeLimitNotice, setSizeLimitNotice] = useState<string | null>(null);
  const [shopifyShopDomain, setShopifyShopDomain] = useState<string | null>(null);
  const [shopInput, setShopInput] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState<{ storeUrl: string } | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [sectionPickerOpen, setSectionPickerOpen] = useState(false);
  // Which section a new one should land after — set when the picker is opened from the inline
  // "+" below a selected section; null means the header's own Add Section button opened it,
  // which appends to the end of the page instead.
  const [insertAfterId, setInsertAfterId] = useState<string | null>(null);
  const [sectionCatalog, setSectionCatalog] = useState<SectionSchema[]>([]);
  // Left tool rail: AI's controls live in this inline panel; Media's rail entry opens
  // MediaPanel in a browse-only mode (no `image_picker` target to write into, unlike its other
  // two entry points below). Sections has no panel of its own — the rail button opens the
  // existing SectionPicker modal directly, same as the old header button did.
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [mediaPanelOpen, setMediaPanelOpen] = useState(false);

  const readTemplate = useMemo(() => createFetchTemplateReader(), []);
  const readBinary = useMemo(() => createFetchBinaryReader(), []);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const productSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The initial load's setProduct isn't a user edit — skip the debounced save it would
  // otherwise trigger. Also flipped true right before setProduct when the server already
  // persisted the new title itself (AI rewrite), so the client doesn't re-save the same value.
  const skipNextProductSave = useRef(true);
  const previewRef = useRef<HTMLDivElement>(null);
  const paletteIndex = useRef(-1);

  // Undo/history: `configRef`/`productRef` mirror the latest state synchronously (updated at
  // the same point as the setState calls, not via a separate effect) so a burst of edits
  // never reads a stale "current" value. History itself lives in a ref — it doesn't need to
  // re-render anything; `canUndo`/`canRedo` are the only reactive parts of it.
  const configRef = useRef<StoreConfiguration | null>(null);
  const productRef = useRef<ProductDTO | null>(null);
  const historyRef = useRef<{ past: Snapshot[]; future: Snapshot[] }>({ past: [], future: [] });
  const lastPushAtRef = useRef(0);

  useEffect(() => {
    fetch(`/api/project/${projectId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) return setLoadError(data.error);
        productRef.current = data.product;
        setProduct(data.product);
        setShopifyShopDomain(data.project.shopifyShopDomain ?? null);
        try {
          const parsed = parseConfiguration(data.project.configurationJson);
          configRef.current = parsed;
          setConfiguration(parsed);
        } catch {
          setLoadError("This project's configuration predates the current theme. Regenerate it.");
        }
      })
      .catch(() => setLoadError("Could not load this project"));
  }, [projectId]);

  // Strip the query param read by the `notice` initializer above so a refresh doesn't re-show it.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("generationFailed") === "1") {
      window.history.replaceState(null, "", `/editor/${projectId}`);
    }
  }, [projectId]);

  // The image toggle starts from the server's SHOPFORGE_GENERATE_IMAGES env default; the
  // checkbox then overrides it per run. Without this the checkbox's initial `false` would
  // always be sent in the generate body, silently overriding the env setting.
  useEffect(() => {
    fetch(`/api/project/${projectId}/generate`)
      .then((res) => res.json())
      .then((data) => {
        if (typeof data.generateImagesDefault === "boolean") setGenerateImages(data.generateImagesDefault);
      })
      .catch(() => {});
  }, [projectId]);

  // Schema labels are `t:` keys into the theme's schema locale file.
  useEffect(() => {
    readTemplate("locales/en.default.schema.json")
      .then((raw) => setSchemaLocale(JSON.parse(raw)))
      .catch(() => setSchemaLocale({}));
  }, [readTemplate]);

  // The Add Section picker's catalog — the same curated list AI generation reads from
  // (lib/ai/catalog.ts), fetched once via the server since it's a disk-backed module.
  useEffect(() => {
    fetch("/api/catalog/sections")
      .then((res) => res.json())
      .then((data) => setSectionCatalog(Array.isArray(data.sections) ? data.sections : []))
      .catch(() => setSectionCatalog([]));
  }, []);

  // The store's brand colors, for the inline toolbar's color-picker "Theme" tab.
  useEffect(() => {
    loadThemeSettings(readTemplate)
      .then((settings) => {
        setThemeColorRows(buildThemePalette(settings));
        const predefined = parsePredefinedSwatches(settings.swatches_predefined_colors ?? settings.swatches_predefined_colors_list);
        if (predefined.length) setCommonColors(predefined);
      })
      .catch(() => {});
  }, [readTemplate]);

  // The section toolbar clamps itself into the preview's height.
  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setPreviewHeight(el.clientHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!sizeLimitNotice) return;
    const timer = setTimeout(() => setSizeLimitNotice(null), 2200);
    return () => clearTimeout(timer);
  }, [sizeLimitNotice]);

  // Always a fresh render on every template/product change — never a DOM patch.
  useEffect(() => {
    if (!configuration) return;
    let cancelled = false;
    renderTemplate({
      template: configuration.templates[page],
      product: product ? toNormalizedProduct(product) : null,
      storeName: deriveStoreName(product),
      readTemplate,
      readBinary,
      templateName: page,
    })
      .then((rendered) => !cancelled && setHtml(rendered))
      .catch((err) => !cancelled && setLoadError(err instanceof Error ? err.message : "Render failed"));
    return () => {
      cancelled = true;
    };
  }, [configuration, page, product, readTemplate, readBinary]);

  // Debounced persistence — configuration is never lost on reload.
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

  // Debounced persistence for the product title/description — mirrors the configuration save
  // above, so inline edits, AI rewrites, and undo/redo of either all end up saved the same way.
  useEffect(() => {
    if (skipNextProductSave.current) {
      skipNextProductSave.current = false;
      return;
    }
    if (!product) return;
    queueMicrotask(() => setSaveState("saving"));
    if (productSaveTimer.current) clearTimeout(productSaveTimer.current);
    const { title, description } = product;
    productSaveTimer.current = setTimeout(() => {
      fetch(`/api/project/${projectId}/product`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, description }),
      })
        .then((res) => {
          if (!res.ok) throw new Error();
          setSaveState("saved");
        })
        .catch(() => setNotice("Could not save the product."));
    }, 500);
    return () => {
      if (productSaveTimer.current) clearTimeout(productSaveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.title, product?.description]);

  // The clicked section's schema drives the Inspector. The loaded schema is stored with the
  // type it belongs to, so a stale result for a previously-selected section is ignored by
  // derivation rather than by clearing state on every selection change.
  useEffect(() => {
    const type = selection?.sectionType;
    if (!type) return;
    let cancelled = false;
    loadSectionSchema(readTemplate, type).then((loaded) => {
      if (!cancelled) setSchema({ type, schema: loaded });
    });
    return () => {
      cancelled = true;
    };
  }, [selection?.sectionType, readTemplate]);

  const activeSchema = schema && schema.type === selection?.sectionType ? schema.schema : null;

  // Same rule as lib/ai/catalog.ts's sectionsForTemplate() + excluding locked sections — kept
  // as a local one-liner rather than importing that module, which is disk-backed (node:fs) and
  // cannot be bundled into this client component.
  const addableSections = useMemo(
    () => sectionCatalog.filter((s) => !s.locked && (!s.allowed_on || s.allowed_on.includes(page))),
    [sectionCatalog, page],
  );

  const currentTemplate = configuration?.templates[page] ?? null;
  const selectedSection = selection?.sectionId ? currentTemplate?.sections[selection.sectionId] : undefined;
  const binding = selection?.binding ?? null;
  // Set only when the click landed inside a block but didn't resolve to one text setting —
  // narrows a rewrite to that block instead of the whole section (docs/EDITOR-TOOLBARS.md).
  const blockScope = !binding ? (selection?.blockScope ?? null) : null;
  // A direct click on an image_picker-backed <img> (data-sf-editable="image") — shows
  // ImageChangeButton instead of the text toolbar.
  const imageSettingId = !binding && selection?.editable === "image" ? selection.settingId : null;
  const scopedBlockType =
    selectedSection && blockScope ? (getBlockAt(selectedSection, blockScope) as { type?: string } | undefined)?.type ?? null : null;
  // Product-name text binds to the Product record, not a template setting — the schema
  // controls that anchor to a real product_title block still apply, but AI rewrite goes
  // through its own endpoint instead of rewrite-section (docs/EDITOR-TOOLBARS.md). The product
  // description is the same story: rewrite-section can only ever read and write the section's
  // own JSON, and the description was never part of that JSON to begin with.
  const isProductTitleBinding = binding?.settingId === PRODUCT_TITLE_SETTING;
  const isProductDescriptionBinding = binding?.settingId === PRODUCT_DESCRIPTION_SETTING;
  const boundNode =
    selectedSection && binding ? getBlockAt(selectedSection, binding.blockPath) : undefined;

  // Schema settings for the bound text's owner: a nested block's come from the section's
  // own {% schema %} when declared there, else from the theme-block file blocks/<type>.liquid.
  const boundKey = binding
    ? `${selection!.sectionType}:${boundNode && "type" in boundNode ? boundNode.type : "section"}:${binding.blockPath.length}`
    : null;
  useEffect(() => {
    if (!binding || !selection?.sectionType || !boundNode) return;
    const key = boundKey!;
    if (binding.blockPath.length === 0) return; // section-level: activeSchema covers it
    const blockType = (boundNode as { type: string }).type;
    let cancelled = false;
    loadSectionSchema(readTemplate, selection.sectionType).then(async (sectionSchema) => {
      const declared = sectionSchema?.blocks?.find((b) => b.type === blockType)?.settings;
      const defs = declared ?? (await loadBlockSchema(readTemplate, blockType))?.settings ?? [];
      if (!cancelled) setBoundDefs({ key, defs });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boundKey, readTemplate]);

  // The section-level pseudo-binding (product title/description with no matching block found)
  // has no schema; anchored to a block, the block's own schema drives the controls as usual.
  const boundSettingDefs = binding &&
    !((isProductTitleBinding || isProductDescriptionBinding) && binding.blockPath.length === 0)
    ? binding.blockPath.length === 0
      ? (activeSchema?.settings ?? [])
      : boundDefs?.key === boundKey
        ? boundDefs.defs
        : []
    : [];
  const textControls = findTextControls(boundSettingDefs, binding?.settingId);
  const boundValues = useMemo(() => {
    const defaults: Record<string, unknown> = {};
    for (const def of boundSettingDefs) if (def.id && def.default !== undefined) defaults[def.id] = def.default;
    return { ...defaults, ...(boundNode?.settings ?? {}) };
  }, [boundSettingDefs, boundNode]);

  // Records the state *before* an edit, so undo can restore it. Rapid-fire edits (dragging a
  // slider, typing a sentence) land within HISTORY_COALESCE_MS of each other and are folded
  // into the same undo step instead of each getting their own.
  const pushHistory = useCallback(() => {
    if (!configRef.current) return;
    const now = Date.now();
    const h = historyRef.current;
    if (h.past.length > 0 && now - lastPushAtRef.current < HISTORY_COALESCE_MS) {
      lastPushAtRef.current = now;
      return;
    }
    lastPushAtRef.current = now;
    h.past.push({ configuration: configRef.current, product: productRef.current });
    if (h.past.length > HISTORY_LIMIT) h.past.shift();
    h.future = [];
    setCanUndo(true);
    setCanRedo(false);
  }, []);

  const commitConfiguration = useCallback(
    (next: StoreConfiguration) => {
      pushHistory();
      configRef.current = next;
      setConfiguration(next);
    },
    [pushHistory],
  );

  const commitProduct = useCallback(
    (next: ProductDTO) => {
      pushHistory();
      productRef.current = next;
      setProduct(next);
    },
    [pushHistory],
  );

  const undo = useCallback(() => {
    const h = historyRef.current;
    if (!h.past.length || !configRef.current) return;
    const snap = h.past.pop()!;
    h.future.push({ configuration: configRef.current, product: productRef.current });
    configRef.current = snap.configuration;
    productRef.current = snap.product;
    setConfiguration(snap.configuration);
    setProduct(snap.product);
    setSelection(null);
    setShowRewrite(false);
    lastPushAtRef.current = 0; // the next edit starts a fresh step, not coalesced with this jump
    setCanUndo(h.past.length > 0);
    setCanRedo(true);
  }, []);

  const redo = useCallback(() => {
    const h = historyRef.current;
    if (!h.future.length || !configRef.current) return;
    const snap = h.future.pop()!;
    h.past.push({ configuration: configRef.current, product: productRef.current });
    configRef.current = snap.configuration;
    productRef.current = snap.product;
    setConfiguration(snap.configuration);
    setProduct(snap.product);
    setSelection(null);
    setShowRewrite(false);
    lastPushAtRef.current = 0;
    setCanRedo(h.future.length > 0);
    setCanUndo(true);
  }, []);

  // Applies a checkpoint picked from the "recent changes" history panel. Goes through the
  // normal commit path (not a separate restore mechanism) so it autosaves, records its own
  // checkpoint afterward, and is itself undoable like any other edit.
  const restoreFromHistory = useCallback(
    ({ configuration: restored, productTitle }: { configuration: StoreConfiguration; productTitle: string | null }) => {
      commitConfiguration(restored);
      if (productTitle && productRef.current && productTitle !== productRef.current.title) {
        commitProduct({ ...productRef.current, title: productTitle });
      }
      setSelection(null);
      setShowRewrite(false);
    },
    [commitConfiguration, commitProduct],
  );

  // Ctrl/Cmd+Z to undo, Ctrl/Cmd+Shift+Z or Ctrl+Y to redo — skipped while focus is in a text
  // input, textarea, or contenteditable (the inline preview text, the AI prompt box) so the
  // browser's own native undo handles typing there instead of jumping the whole template back.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      const active = document.activeElement;
      const isEditableFocus =
        active instanceof HTMLElement &&
        (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable);
      if (isEditableFocus) return;
      if (key === "y") {
        e.preventDefault();
        redo();
        return;
      }
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo]);

  /** Every mutation of the current page's template funnels through here. */
  const updateTemplate = useCallback(
    (mutate: (template: NonNullable<typeof currentTemplate>) => NonNullable<typeof currentTemplate>) => {
      const prev = configRef.current;
      if (!prev) return;
      const template = prev.templates[page];
      const next = mutate(template);
      if (next === template) return;
      commitConfiguration({ ...prev, templates: { ...prev.templates, [page]: next } });
    },
    [page, commitConfiguration],
  );

  const updateSetting = useCallback(
    (sectionId: string, settingId: string, value: unknown, blockPath: string[] = []) => {
      updateTemplate((template) => {
        const section = template.sections[sectionId];
        if (!section) return template;
        return replaceSection(template, sectionId, setSettingAtPath(section, blockPath, settingId, value));
      });
    },
    [updateTemplate],
  );

  const generate = useCallback(async () => {
    setGenerating(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/project/${projectId}/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ generateImages }),
      });
      const data = await res.json();
      if (!res.ok) {
        setNotice(data.error ?? "Generation failed");
        return;
      }
      commitConfiguration(parseConfiguration(data.project.configurationJson));
      const g = data.generation;
      setNotice(
        `Generated with ${g.model}: ${g.index.sections} homepage sections, ${g.product.sections} product-page sections. ` +
          `Images — ${g.product.images.generated} generated, ${g.product.images.fromProduct} from the product.`,
      );
    } catch {
      setNotice("Generation failed");
    } finally {
      setGenerating(false);
    }
  }, [projectId, generateImages, commitConfiguration]);

  // Installs/reuses the project's Shopify theme, pushes the current Store Configuration onto
  // it, and publishes it live (lib/shopify/publish.ts). Only reachable once shopifyShopDomain
  // is set, i.e. after the Connect flow below has linked a ShopifyStore to this project.
  const publish = useCallback(async () => {
    setPublishing(true);
    setPublishError(null);
    setPublishResult(null);
    try {
      const res = await fetch(`/api/project/${projectId}/publish`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setPublishError(data.error ?? "Publish failed");
        return;
      }
      setPublishResult({ storeUrl: data.storeUrl });
    } catch {
      setPublishError("Something went wrong while publishing.");
    } finally {
      setPublishing(false);
    }
  }, [projectId]);

  // Purges the stored connection (lib/shopify/publish.ts's disconnect route deletes the
  // ShopifyStore row outright rather than marking it inactive) so a different store can be
  // connected in its place. Local state clears immediately rather than reloading, since the
  // server side is already done by the time this resolves.
  const disconnectStore = useCallback(async () => {
    if (!shopifyShopDomain) return;
    setDisconnecting(true);
    try {
      await fetch("/api/shopify/disconnect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shop: shopifyShopDomain }),
      });
      setShopifyShopDomain(null);
      setPublishResult(null);
      setPublishError(null);
    } finally {
      setDisconnecting(false);
    }
  }, [shopifyShopDomain]);

  // One section, one instruction — the server replaces just that section in the stored
  // configuration and returns the whole updated project (docs/SECTION-AI-EDITING.md).
  // When the popover was opened from the inline text toolbar, the request carries the
  // binding and the server guarantees only that one setting changes.
  const selectedSectionId = selection?.sectionId ?? null;
  const selectedSectionType = selection?.sectionType ?? null;
  const rewriteSection = useCallback(
    async (options: { prompt?: string; preset?: string }) => {
      if (!selectedSectionId) return;
      setRewriting(true);
      setNotice(null);
      try {
        // The product title/description are product data, not template settings
        // (docs/EDITOR-TOOLBARS.md) — each has its own AI endpoint and persists to the Product
        // record, not the template.
        if (isProductTitleBinding || isProductDescriptionBinding) {
          const res = await fetch(
            `/api/project/${projectId}/${isProductTitleBinding ? "rewrite-product-title" : "rewrite-product-description"}`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(options),
            },
          );
          const data = await res.json();
          if (!res.ok) {
            setNotice(data.error ?? "Rewrite failed");
            return;
          }
          // The server already persisted this — skip the debounced re-save it would otherwise
          // trigger.
          skipNextProductSave.current = true;
          commitProduct(data.product);
          return;
        }
        const res = await fetch(`/api/project/${projectId}/rewrite-section`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            page,
            sectionId: selectedSectionId,
            ...(binding
              ? { blockPath: binding.blockPath, settingId: binding.settingId }
              : blockScope
                ? { blockPath: blockScope }
                : {}),
            ...options,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setNotice(data.error ?? "Rewrite failed");
          return;
        }
        commitConfiguration(parseConfiguration(data.project.configurationJson));
      } catch {
        setNotice("Rewrite failed");
      } finally {
        setRewriting(false);
      }
    },
    [
      projectId,
      page,
      selectedSectionId,
      binding,
      blockScope,
      isProductTitleBinding,
      isProductDescriptionBinding,
      commitConfiguration,
      commitProduct,
    ],
  );

  // Magic brush: the section's own schema names its color settings; a random curated
  // palette (never the same one twice in a row) is written into them (docs/EDITOR-TOOLBARS.md).
  // No notice banner here: the recolored preview is its own feedback, and the notice bar
  // sits in normal document flow above the preview — showing/hiding it on every click shifted
  // the whole preview down and back up, reading as a blink on the section itself.
  const magicBrush = useCallback(async () => {
    if (!selectedSectionId || !selectedSectionType) return;
    const sectionSchema = await loadSectionSchema(readTemplate, selectedSectionType);
    const index = rollPalette(paletteIndex.current);
    const palette = PALETTES[index];
    let paletteApplied = false;
    updateTemplate((template) => {
      const section = template.sections[selectedSectionId];
      if (!section) return template;
      const brushed = applyMagicBrush(section, sectionSchema, palette);
      if (brushed !== section) {
        paletteApplied = true;
        return replaceSection(template, selectedSectionId, brushed);
      }
      // No custom color settings — fall back to stepping the section's color_scheme select.
      const cycled = cycleColorScheme(section, sectionSchema);
      if (!cycled) return template;
      return replaceSection(template, selectedSectionId, cycled.section);
    });
    if (paletteApplied) paletteIndex.current = index;
  }, [selectedSectionId, selectedSectionType, readTemplate, updateTemplate]);

  // Add Section: builds a real instance of the picked catalog entry from the theme's own
  // schema/presets (createSectionInstance), appends it, then selects it so its toolbar shows
  // up as soon as the preview re-renders. Goes through updateTemplate like every other
  // mutation, so undo/redo and the debounced autosave need nothing extra here.
  const addSection = useCallback(
    async (catalogEntry: SectionSchema) => {
      const sectionSchema = await loadSectionSchema(readTemplate, catalogEntry.id);
      if (!sectionSchema) {
        setNotice(`Couldn't add "${catalogEntry.label}" — its section file is missing from the theme.`);
        setSectionPickerOpen(false);
        return;
      }
      const blockSchemas = new Map(
        await Promise.all(
          presetBlockTypes(sectionSchema).map(
            async (type) => [type, await loadBlockSchema(readTemplate, type)] as const,
          ),
        ),
      );
      const sectionId = generateInstanceId(catalogEntry.id);
      const section = createSectionInstance(catalogEntry.id, sectionSchema, blockSchemas);
      updateTemplate((template) => insertSection(template, sectionId, section, insertAfterId));
      setSelection({
        sectionId,
        sectionType: catalogEntry.id,
        settingId: null,
        editable: null,
        binding: null,
        blockScope: null,
        rect: null,
      });
      setSelectionRect(null);
      setSectionPickerOpen(false);
      setInsertAfterId(null);
    },
    [readTemplate, updateTemplate, insertAfterId],
  );

  const handleMove = useCallback(
    (delta: -1 | 1) => {
      if (!selectedSectionId) return;
      updateTemplate((template) => moveSection(template, selectedSectionId, delta));
    },
    [selectedSectionId, updateTemplate],
  );

  const handleDeleteSection = useCallback(() => {
    if (!selectedSectionId) return;
    updateTemplate((template) => removeSection(template, selectedSectionId));
    setSelection(null);
    setShowRewrite(false);
  }, [selectedSectionId, updateTemplate]);

  const handleDeleteBlock = useCallback(() => {
    if (!selectedSectionId || !binding || binding.blockPath.length === 0) return;
    updateTemplate((template) => {
      const section = template.sections[selectedSectionId];
      if (!section) return template;
      return replaceSection(template, selectedSectionId, removeBlockAt(section, binding.blockPath));
    });
    // Keep the section selected; the text (and its block) is gone.
    setSelection((prev) => (prev ? { ...prev, binding: null, settingId: null, editable: null } : prev));
  }, [selectedSectionId, binding, updateTemplate]);

  const writeBoundSettings = useCallback(
    (values: Record<string, unknown> | null) => {
      if (!values || !selectedSectionId || !binding) return;
      updateTemplate((template) => {
        const section = template.sections[selectedSectionId];
        if (!section) return template;
        return replaceSection(template, selectedSectionId, setSettingsAtPath(section, binding.blockPath, values));
      });
    },
    [selectedSectionId, binding, updateTemplate],
  );

  // Selection resolver for PreviewFrame: does this rendered text belong to a setting?
  // The product name and description come first: text matching `product.title` or
  // `product.description` renders product DATA (`{{ product.title }}`/`{{ product.description
  // }}` in the theme), so editing it means updating the product record — even if some section
  // setting happens to hold the same string.
  const resolveText = useCallback(
    (sectionId: string, text: string): TextBinding | null => {
      const section = currentTemplate?.sections[sectionId];
      if (product?.title && normalizeText(product.title) === normalizeText(text)) {
        // Anchor to the section's product_title block when it has exactly one, so the
        // toolbar can offer that block's schema controls (size, alignment) alongside
        // the rename; text commits still go to the Product record either way.
        const blockPath = section ? locateBlockPathByType(section, "product_title") : null;
        return { blockPath: blockPath ?? [], settingId: PRODUCT_TITLE_SETTING };
      }
      if (product?.description && normalizeText(product.description) === normalizeText(text)) {
        const blockPath = section ? locateBlockPathByType(section, "product_description") : null;
        return { blockPath: blockPath ?? [], settingId: PRODUCT_DESCRIPTION_SETTING };
      }
      return section ? locateTextSetting(section, text) : null;
    },
    [currentTemplate, product?.title, product?.description],
  );

  const handleSelect = useCallback((info: SelectInfo) => {
    setSelection(info);
    setSelectionRect(info.rect);
    setShowRewrite(false);
    setMediaPickerTarget(null);
  }, []);
  const handleRectChange = useCallback((rect: SelectionRect | null) => setSelectionRect(rect), []);
  const handleTextCommit = useCallback(
    (sectionId: string, textBinding: TextBinding, value: string) => {
      if (textBinding.settingId === PRODUCT_TITLE_SETTING) {
        // Renaming the product: update local state (re-renders the preview everywhere the
        // title appears); the debounced effect above persists it to the Product record, not
        // the template JSON.
        if (!productRef.current) return;
        commitProduct({ ...productRef.current, title: value });
        return;
      }
      if (textBinding.settingId === PRODUCT_DESCRIPTION_SETTING) {
        if (!productRef.current) return;
        commitProduct({ ...productRef.current, description: value });
        return;
      }
      updateTemplate((template) => {
        const section = template.sections[sectionId];
        if (!section) return template;
        return replaceSection(
          template,
          sectionId,
          setSettingAtPath(section, textBinding.blockPath, textBinding.settingId, value),
        );
      });
    },
    [updateTemplate, commitProduct],
  );

  if (loadError) return <p className="flex-1 bg-white p-8 text-sm text-red-600">{loadError}</p>;
  if (!configuration) return <p className="flex-1 bg-white p-8 text-sm text-neutral-500">Loading…</p>;

  return (
    // `min-h-0` at every level of this column: a flex item defaults to `min-height: auto`,
    // which refuses to shrink below its content. Without it the Inspector's full height
    // pushes the editor past the viewport and the whole document scrolls instead of the panel.
    // Explicit light background: the editor chrome is designed light, and without this it
    // inherits the body background, which goes dark under `prefers-color-scheme: dark`.
    <div className="flex min-h-0 flex-1 flex-col bg-white text-neutral-900">
      <header className="flex items-center justify-between gap-4 border-b border-neutral-800 bg-neutral-900 px-4 py-2 text-sm text-white">
        <span className="text-neutral-400">{product?.title ?? "Untitled store"}</span>

        <div className="flex items-center gap-1 rounded border border-neutral-700 p-0.5">
          {PAGE_TEMPLATES.map((name) => (
            <button
              key={name}
              onClick={() => {
                setPage(name);
                setSelection(null);
                setShowRewrite(false);
              }}
              className={`rounded px-3 py-1 text-xs capitalize ${
                page === name ? "bg-white text-neutral-900" : "text-neutral-400 hover:bg-white/10 hover:text-white"
              }`}
            >
              {name === "index" ? "Homepage" : "Product page"}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-0.5 rounded border border-neutral-700 p-0.5">
            <button
              onClick={undo}
              disabled={!canUndo}
              title="Undo (Ctrl+Z)"
              className="rounded p-1.5 text-neutral-400 hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <Undo2 className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={redo}
              disabled={!canRedo}
              title="Redo (Ctrl+Shift+Z)"
              className="rounded p-1.5 text-neutral-400 hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <Redo2 className="h-3.5 w-3.5" />
            </button>
          </div>

          <HistoryPanel projectId={projectId} onRestore={restoreFromHistory} />

          <div className="flex items-center gap-0.5 rounded border border-neutral-700 p-0.5">
            <button
              onClick={() => setViewport("desktop")}
              title="Desktop preview"
              className={`rounded p-1.5 ${
                viewport === "desktop" ? "bg-white text-neutral-900" : "text-neutral-400 hover:bg-white/10 hover:text-white"
              }`}
            >
              <Monitor className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setViewport("mobile")}
              title="Mobile preview"
              className={`rounded p-1.5 ${
                viewport === "mobile" ? "bg-white text-neutral-900" : "text-neutral-400 hover:bg-white/10 hover:text-white"
              }`}
            >
              <Smartphone className="h-3.5 w-3.5" />
            </button>
          </div>

          <span className="w-14 text-right text-xs text-neutral-500">
            {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : ""}
          </span>

          <a
            href={`/api/project/${projectId}/export-zip`}
            title="Download the theme this project would publish to Shopify, as a zip"
            className="rounded border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-300 hover:bg-white/10 hover:text-white"
          >
            Download zip
          </a>

          <div className="h-4 w-px bg-neutral-700" aria-hidden="true" />

          {shopifyShopDomain ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-neutral-400" title={shopifyShopDomain}>
                {shopifyShopDomain}
              </span>
              <button
                onClick={publish}
                disabled={publishing}
                className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                {publishing ? "Publishing…" : "Publish"}
              </button>
              {publishResult && (
                <a
                  href={publishResult.storeUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-emerald-400 underline"
                >
                  View live store
                </a>
              )}
              {publishError && <span className="text-xs text-red-400">{publishError}</span>}
              <button
                onClick={disconnectStore}
                disabled={disconnecting}
                title="Disconnect this store so a different one can be connected"
                className="rounded border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-300 hover:bg-white/10 hover:text-white disabled:opacity-50"
              >
                {disconnecting ? "Disconnecting…" : "Disconnect"}
              </button>
            </div>
          ) : (
            <form
              action="/api/shopify/install"
              method="get"
              className="flex items-center gap-1.5"
            >
              <input type="hidden" name="projectId" value={projectId} />
              <input
                type="text"
                name="shop"
                value={shopInput}
                onChange={(e) => setShopInput(e.target.value)}
                placeholder="your-store.myshopify.com"
                className="w-48 rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-white placeholder:text-neutral-500"
              />
              <button
                type="submit"
                disabled={shopInput.trim() === ""}
                className="rounded border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-300 hover:bg-white/10 hover:text-white disabled:opacity-50"
              >
                Connect store
              </button>
            </form>
          )}
        </div>
      </header>

      {notice ? (
        <p className="border-b border-neutral-200 bg-neutral-50 px-4 py-2 text-xs text-neutral-600">{notice}</p>
      ) : null}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <EditorRail
          sectionsActive={sectionPickerOpen}
          aiActive={aiPanelOpen}
          mediaActive={mediaPickerTarget !== null || mediaPanelOpen}
          onSections={() => {
            setInsertAfterId(null);
            setSectionPickerOpen(true);
          }}
          onAI={() =>
            setAiPanelOpen((v) => {
              const next = !v;
              if (next) {
                setMediaPickerTarget(null);
                setMediaPanelOpen(false);
              }
              return next;
            })
          }
          onMedia={() => {
            if (mediaPickerTarget || mediaPanelOpen) {
              setMediaPickerTarget(null);
              setMediaPanelOpen(false);
            } else {
              setMediaPanelOpen(true);
              setAiPanelOpen(false);
            }
          }}
        />

        {/* Sections, AI, and Media are three views of the same left sidebar slot — only one
            renders at a time, right beside the rail, never as a separate floating overlay. */}
        {mediaPickerTarget !== null || mediaPanelOpen ? (
          <MediaPanel
            open
            images={product?.images ?? []}
            onSelect={(url) => {
              if (mediaPickerTarget && selection?.sectionId) {
                updateSetting(selection.sectionId, mediaPickerTarget.settingId, url, mediaPickerTarget.blockPath);
              }
              setMediaPickerTarget(null);
              setMediaPanelOpen(false);
            }}
            onClose={() => {
              setMediaPickerTarget(null);
              setMediaPanelOpen(false);
            }}
          />
        ) : aiPanelOpen ? (
          <div className="flex w-72 shrink-0 flex-col gap-3 border-r border-neutral-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-neutral-900">AI</p>
              <button
                onClick={() => setAiPanelOpen(false)}
                title="Close"
                className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-900"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-neutral-500">Regenerate this page&apos;s content from the imported product.</p>
            <label
              className="flex items-center gap-1.5 text-xs text-neutral-600"
              title="When off, image settings are filled from the imported product's own photos and no image model is called."
            >
              <input type="checkbox" checked={generateImages} onChange={(e) => setGenerateImages(e.target.checked)} />
              Generate images
            </label>
            <button
              onClick={generate}
              disabled={generating}
              className="rounded bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              {generating ? "Generating…" : "Generate content"}
            </button>
          </div>
        ) : null}

        <div
          ref={previewRef}
          className={`relative min-h-0 min-w-0 flex-1 ${
            viewport === "mobile" ? "flex justify-center overflow-auto bg-neutral-200" : "overflow-hidden"
          }`}
        >
          <div className={viewport === "mobile" ? "h-full w-97.5 shrink-0 border-x border-neutral-300 bg-white" : "h-full w-full"}>
            <PreviewFrame
              html={html}
              resetScrollKey={page}
              selectedSectionId={selection?.sectionId ?? null}
              onSelect={handleSelect}
              onTextCommit={handleTextCommit}
              resolveText={resolveText}
              onRectChange={handleRectChange}
              onUndo={undo}
              onRedo={redo}
            />
          </div>

          {selection?.sectionId && !binding && !showRewrite ? (
            <SectionToolbar
              rect={selectionRect}
              containerHeight={previewHeight}
              busy={rewriting}
              onMagicBrush={magicBrush}
              onRewrite={() => setShowRewrite((v) => !v)}
              onEditSection={() => setPanelOpen(true)}
              onMove={handleMove}
              onDelete={() => setConfirmDelete("section")}
            />
          ) : null}

          {selection?.sectionId && !binding && !showRewrite && selectionRect ? (
            <div
              className="pointer-events-none absolute inset-x-0 z-10"
              style={{ top: selectionRect.top + selectionRect.height }}
            >
              <div className="relative">
                <div className="h-px w-full bg-emerald-500" />
                <button
                  onClick={() => {
                    setInsertAfterId(selection.sectionId);
                    setSectionPickerOpen(true);
                  }}
                  className="pointer-events-auto absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white shadow-lg ring-1 ring-white/10 hover:bg-neutral-700"
                >
                  <Plus className="h-3 w-3" />
                  Add a section
                </button>
              </div>
            </div>
          ) : null}

          {selection?.sectionId && binding && selectionRect && !showRewrite ? (
            <InlineTextToolbar
              rect={selectionRect}
              controls={textControls}
              values={boundValues}
              busy={rewriting}
              canDeleteBlock={binding.blockPath.length > 0}
              themeColorRows={themeColorRows}
              commonColors={commonColors}
              onRewrite={() => setShowRewrite(true)}
              onStepSize={(direction) => {
                if (!textControls.size) return;
                const patch = stepSize(textControls.size, boundValues[textControls.size.settingId], direction);
                if (!patch) {
                  setSizeLimitNotice(direction === 1 ? "Cannot make text bigger" : "Cannot make text smaller");
                  return;
                }
                setSizeLimitNotice(null);
                writeBoundSettings(patch);
              }}
              onCycleWeight={() =>
                textControls.weight &&
                writeBoundSettings(cycleWeight(textControls.weight, boundValues[textControls.weight.settingId]))
              }
              onAlign={(value) => textControls.align && writeBoundSettings(applyAlign(textControls.align, value))}
              onPickColor={(hex) => textControls.color && writeBoundSettings(applyColor(textControls.color, hex))}
              onDeleteBlock={() => setConfirmDelete("block")}
              onClose={() => {
                setSelection(null);
                setShowRewrite(false);
              }}
            />
          ) : null}

          {imageSettingId && selectionRect && !showRewrite ? (
            <ImageChangeButton
              rect={selectionRect}
              onClick={() => {
                setMediaPickerTarget({ settingId: imageSettingId, blockPath: blockScope ?? [] });
                setAiPanelOpen(false);
              }}
            />
          ) : null}

          {selection?.sectionId && showRewrite ? (
            <AiRewritePopover
              sectionLabel={
                isProductTitleBinding
                  ? "the product title"
                  : isProductDescriptionBinding
                    ? "the product description"
                    : binding
                      ? `the "${binding.settingId}" text`
                      : blockScope
                        ? `the "${scopedBlockType ?? "selected"}" block`
                        : (selection.sectionType ?? "this section")
              }
              rect={selectionRect}
              containerHeight={previewHeight}
              // Opened from the inline text toolbar (a field selection): float below the
              // selected text itself, like that toolbar does, instead of the fixed slot next
              // to the section toolbar's pill — pinning it to the right edge regardless of
              // where the text sits used to park the popover directly on top of any wide
              // element (e.g. a full-width heading), hiding the very content being rewritten.
              anchorToElement={Boolean(binding)}
              busy={rewriting}
              onSubmit={rewriteSection}
              onClose={() => setShowRewrite(false)}
            />
          ) : null}

          {sizeLimitNotice ? (
            <div className="absolute right-4 bottom-4 z-30 flex items-center gap-2 rounded-full bg-red-50 py-2 pr-4 pl-2 text-xs font-medium text-red-700 shadow-lg ring-1 ring-red-200">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-red-500 text-white">
                <AlertCircle className="h-3 w-3" strokeWidth={2.5} />
              </span>
              {sizeLimitNotice}
            </div>
          ) : null}
        </div>
        {panelOpen ? (
          <SettingsPanel
            sectionType={selection?.sectionType ?? null}
            schema={activeSchema}
            schemaLocale={schemaLocale}
            values={selectedSection?.settings ?? {}}
            onChange={(settingId, value) =>
              selection?.sectionId && updateSetting(selection.sectionId, settingId, value)
            }
            onBrowseMedia={(settingId) => {
              setMediaPickerTarget({ settingId, blockPath: [] });
              setAiPanelOpen(false);
            }}
            onClose={() => {
              setSelection(null);
              setMediaPickerTarget(null);
            }}
            onCollapse={() => setPanelOpen(false)}
          />
        ) : (
          // Collapsed Inspector: a slim rail that reopens it, so the preview gets the width.
          <button
            onClick={() => setPanelOpen(true)}
            title="Open settings"
            className="flex w-8 shrink-0 flex-col items-center gap-2 border-l border-neutral-200 pt-4 text-neutral-500 hover:bg-neutral-50 hover:text-neutral-900"
          >
            <span aria-hidden>⚙</span>
            <span className="text-[10px] tracking-widest uppercase [writing-mode:vertical-rl]">Settings</span>
          </button>
        )}
      </div>

      <SectionPicker
        open={sectionPickerOpen}
        sections={addableSections}
        onSelect={addSection}
        templateName={page}
        readTemplate={readTemplate}
        readBinary={readBinary}
        product={product ? toNormalizedProduct(product) : null}
        storeName={deriveStoreName(product)}
        onClose={() => {
          setSectionPickerOpen(false);
          setInsertAfterId(null);
        }}
      />

      {confirmDelete ? (
        <ConfirmDialog
          title={confirmDelete === "section" ? "Delete this section?" : "Delete this block?"}
          message={
            confirmDelete === "section"
              ? "The section and everything in it will be removed from this page."
              : "This block will be removed from its section."
          }
          confirmLabel="Delete"
          onConfirm={() => {
            (confirmDelete === "section" ? handleDeleteSection : handleDeleteBlock)();
            setConfirmDelete(null);
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      ) : null}
    </div>
  );
}
