"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { AlertCircle, Copy, Link, Monitor, Plus, Redo2, Smartphone, Undo2, X } from "lucide-react";
import { PreviewFrame, PreviewFrameHandle, SelectInfo, SelectionRect } from "@/components/PreviewFrame";
import { SettingsPanel } from "@/components/SettingsPanel";
import { MediaPanel } from "@/components/MediaPanel";
import { EditorRail } from "@/components/EditorRail";
import { AiRewritePopover } from "@/components/AiRewritePopover";
import { SectionToolbar } from "@/components/SectionToolbar";
import { SectionNameBadge } from "@/components/SectionNameBadge";
import { SectionPicker } from "@/components/SectionPicker";
import { BlockPicker } from "@/components/BlockPicker";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { HistoryPanel } from "@/components/HistoryPanel";
import { DuplicateThemeModal } from "@/components/DuplicateThemeModal";
import { PublicLinkModal } from "@/components/PublicLinkModal";
import { InlineTextToolbar } from "@/components/InlineTextToolbar";
import { ImageChangeButton } from "@/components/ImageChangeButton";
import { AiImageEditPanel } from "@/components/AiImageEditPanel";
import type { GeneratedImage } from "@/lib/product/generated-images";
import { renderTemplate } from "@/lib/preview/template-renderer";
import { createFetchTemplateReader, createFetchBinaryReader } from "@/lib/preview/template-loader";
import {
  loadBlockSchema,
  loadSectionSchema,
  resolveSchemaLabel,
  ShopifySectionSchema,
  ShopifySettingDef,
} from "@/lib/preview/section-schema";
import { PAGE_TEMPLATES, PageTemplate, parseConfiguration, StoreConfiguration } from "@/lib/store-config/store";
import { speechLocaleFor } from "@/lib/store-config/dictation-locale";
import { deriveStoreName } from "@/lib/store-config/store-name";
import {
  addBlockAt,
  getBlockAt,
  insertSection,
  moveBlockAt,
  moveSection,
  removeBlockAt,
  removeSection,
  replaceSection,
  setSettingAtPath,
  setSettingsAtPath,
} from "@/lib/store-config/template-ops";
import {
  createBlockInstance,
  createSectionInstance,
  generateInstanceId,
  presetBlockTypes,
} from "@/lib/store-config/section-factory";
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
import { classifySaveResponseStatus } from "@/lib/editor/save-state";
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
  const router = useRouter();
  const [product, setProduct] = useState<ProductDTO | null>(null);
  const [configuration, setConfiguration] = useState<StoreConfiguration | null>(null);
  const [page, setPage] = useState<PageTemplate>("product");
  const [html, setHtml] = useState("");
  const [selection, setSelection] = useState<SelectInfo | null>(null);
  const [selectionRect, setSelectionRect] = useState<SelectionRect | null>(null);
  /** The selected section's own root box — distinct from `selectionRect` (whatever field/block
   * inside it was actually clicked) — so the name badge anchors to the whole section. */
  const [sectionRect, setSectionRect] = useState<SelectionRect | null>(null);
  // The image_picker setting currently targeted by "Browse media" (MediaPanel) — cleared
  // whenever the selected section changes so a stale target can't be written to. blockPath is
  // set when the setting lives inside a block (e.g. a hotspot's own image), empty for a
  // section-level setting, so the picked url lands on the right node either way.
  const [mediaPickerTarget, setMediaPickerTarget] = useState<{ settingId: string; blockPath: string[] } | null>(
    null,
  );
  const [schema, setSchema] = useState<{ type: string; schema: ShopifySectionSchema | null } | null>(null);
  const [boundDefs, setBoundDefs] = useState<{ key: string; defs: ShopifySettingDef[] } | null>(null);
  // The selected *nested* block's own schema (blocks/<type>.liquid) — a container block like
  // Column declares its own `blocks` list there, same as a section does, so "Add block" needs
  // this to offer the right menu when a block-inside-a-block (not the section itself) is
  // selected (docs/EDITOR-TOOLBARS.md).
  const [scopedBlockSchema, setScopedBlockSchema] = useState<{ type: string; schema: ShopifySectionSchema | null } | null>(
    null,
  );
  const [schemaLocale, setSchemaLocale] = useState<Record<string, unknown>>({});
  // Feeds the inline toolbar's color picker ("Theme"/"Common Colors" tabs) from the store's
  // own settings_data.json, rather than the picker only ever offering a bare hex input.
  const [themeColorRows, setThemeColorRows] = useState<ThemeColorRow[]>([]);
  const [commonColors, setCommonColors] = useState<NamedColor[]>(FALLBACK_COMMON_COLORS);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error" | "conflict">("idle");
  const [conflict, setConflict] = useState<{ currentUpdatedAt: string } | null>(null);
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
  // The store this theme belongs to, and which of the store's themes is currently the live
  // one — used for the breadcrumb and to decide whether publishing needs a confirm step
  // (publishing a theme that isn't already active flips the store's live theme).
  const [storeId, setStoreId] = useState<string | null>(null);
  const [storeName, setStoreName] = useState<string | null>(null);
  const [themeName, setThemeName] = useState<string | null>(null);
  const [storeActiveThemeId, setStoreActiveThemeId] = useState<string | null>(null);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [showDuplicateTheme, setShowDuplicateTheme] = useState(false);
  const [publicPreviewEnabled, setPublicPreviewEnabled] = useState(false);
  const [publicPreviewToken, setPublicPreviewToken] = useState<string | null>(null);
  const [showPublicLink, setShowPublicLink] = useState(false);
  const [publicLinkBusy, setPublicLinkBusy] = useState(false);

  const setPublicPreview = useCallback(
    async (enabled: boolean) => {
      if (!storeId) return;
      setPublicLinkBusy(true);
      try {
        const res = await fetch(`/api/store/${storeId}/theme/${projectId}/public-link`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ enabled }),
        });
        if (res.ok) {
          const data = await res.json();
          setPublicPreviewEnabled(data.publicPreviewEnabled);
          setPublicPreviewToken(data.publicPreviewToken);
        }
      } finally {
        setPublicLinkBusy(false);
      }
    },
    [storeId, projectId],
  );

  const duplicateTheme = useCallback(
    async (name: string) => {
      setShowDuplicateTheme(false);
      if (!storeId) return;
      const res = await fetch(`/api/store/${storeId}/theme`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, duplicateFrom: projectId }),
      });
      const data = await res.json();
      if (res.ok) router.push(`/editor/${data.project.id}`);
    },
    [storeId, projectId, router],
  );
  const [disconnecting, setDisconnecting] = useState(false);
  const [sectionPickerOpen, setSectionPickerOpen] = useState(false);
  // Which section a new one should land after — set when the picker is opened from the inline
  // "+" below a selected section; null means the header's own Add Section button opened it,
  // which appends to the end of the page instead.
  const [insertAfterId, setInsertAfterId] = useState<string | null>(null);
  const [blockPickerOpen, setBlockPickerOpen] = useState(false);
  const [sectionCatalog, setSectionCatalog] = useState<SectionSchema[]>([]);
  // Left tool rail: AI's controls live in this inline panel; Media's rail entry opens
  // MediaPanel in a browse-only mode (no `image_picker` target to write into, unlike its other
  // two entry points below). Sections has no panel of its own — the rail button opens the
  // existing SectionPicker modal directly, same as the old header button did.
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [mediaPanelOpen, setMediaPanelOpen] = useState(false);
  // "Edit with AI" (ImageChangeButton's second action) — a fourth view of the same left
  // sidebar slot. aiImageTarget mirrors mediaPickerTarget: which image_picker setting "Use
  // image" writes into. aiReferenceUrl is the panel's current reference image, seeded from the
  // clicked image and swappable via aiReferencePicking, which reopens MediaPanel to pick a
  // different one without touching aiImageTarget.
  const [aiImagePanelOpen, setAiImagePanelOpen] = useState(false);
  const [aiImageTarget, setAiImageTarget] = useState<{ settingId: string; blockPath: string[] } | null>(null);
  const [aiReferenceUrl, setAiReferenceUrl] = useState<string>("");
  const [aiReferencePicking, setAiReferencePicking] = useState(false);
  // The project's target store-content language (ISO 639-1, e.g. "fr") — read once at load,
  // used only to bias the AI prompt's voice-dictation mic toward the right speech locale
  // (docs/VOICE-DICTATION-PLAN.md §4); never drives anything else on this page.
  const [projectLanguage, setProjectLanguage] = useState("en");

  const readTemplate = useMemo(() => createFetchTemplateReader(), []);
  const readBinary = useMemo(() => createFetchBinaryReader(), []);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const productSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The initial load's setProduct isn't a user edit — skip the debounced save it would
  // otherwise trigger. Also flipped true right before setProduct when the server already
  // persisted the new title itself (AI rewrite), so the client doesn't re-save the same value.
  const skipNextProductSave = useRef(true);
  // Optimistic-concurrency token for the configuration PATCH — the server rejects a save whose
  // expectedUpdatedAt no longer matches Project.updatedAt (another tab/device saved since),
  // rather than silently letting a stale save overwrite a newer one.
  const lastKnownUpdatedAtRef = useRef<string | null>(null);
  // True whenever there's a configuration/product change not yet confirmed saved by the server
  // (covers both "not sent yet" and "sent but the response hasn't come back"). Drives the
  // flush-on-hide/unmount/unload logic below and gates the beforeunload prompt.
  const configDirtyRef = useRef(false);
  const productDirtyRef = useRef(false);
  // Neither debounce cancels an in-flight request — these guard against two overlapping saves
  // racing each other; a flush that lands while one is already in flight just marks dirty and
  // lets that request's own completion trigger the next send.
  const configSaveInFlightRef = useRef(false);
  const productSaveInFlightRef = useRef(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const previewFrameRef = useRef<PreviewFrameHandle>(null);
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
        setProjectLanguage(data.project.language ?? "en");
        setStoreId(data.project.storeId ?? null);
        setStoreName(data.project.storeName ?? null);
        setThemeName(data.project.name ?? null);
        setStoreActiveThemeId(data.project.storeActiveThemeId ?? null);
        setPublicPreviewEnabled(data.project.publicPreviewEnabled ?? false);
        setPublicPreviewToken(data.project.publicPreviewToken ?? null);
        lastKnownUpdatedAtRef.current = data.project.updatedAt;
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

  // Holds the latest flushConfigurationSave so its own "a newer edit arrived mid-request"
  // continuation below can call back into it without referencing the useCallback-bound const
  // from inside its own initializer (which the React Compiler's ESLint plugin flags as an
  // unsafe self-reference for memoization purposes).
  const flushConfigurationSaveRef = useRef<() => void>(() => {});

  // Sends whatever configuration is currently held, guarded by optimistic concurrency
  // (expectedUpdatedAt) so a stale save can't silently overwrite a newer one. Called by the
  // debounce timer below, and directly by the hide/unmount flush effects further down so a
  // pending change isn't lost on refresh/navigation.
  const flushConfigurationSave = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (configSaveInFlightRef.current) {
      // Another save is already in flight — it'll notice configDirtyRef is still true and
      // send this update itself once it resolves, rather than racing it here.
      configDirtyRef.current = true;
      return;
    }
    const config = configRef.current;
    if (!config) return;
    configSaveInFlightRef.current = true;
    setSaveState("saving");
    fetch(`/api/project/${projectId}/configuration`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ configuration: config, expectedUpdatedAt: lastKnownUpdatedAtRef.current }),
    })
      .then(async (res) => {
        const outcome = classifySaveResponseStatus(res.status);
        if (outcome === "conflict") {
          const data = await res.json().catch(() => null);
          setConflict({ currentUpdatedAt: data?.currentUpdatedAt ?? new Date().toISOString() });
          setSaveState("conflict");
          return outcome;
        }
        if (outcome === "error") throw new Error();
        const data = await res.json();
        lastKnownUpdatedAtRef.current = data.project.updatedAt;
        configDirtyRef.current = false;
        setSaveState("saved");
        return outcome;
      })
      .catch((): "error" => {
        setSaveState("error");
        return "error";
      })
      .then((outcome) => {
        configSaveInFlightRef.current = false;
        // A newer edit landed while this request was in flight — send it now instead of
        // waiting out a fresh debounce window. Only auto-continues after a real success;
        // an error or conflict waits for the user (Retry / Reload / Keep my version).
        if (outcome === "saved" && configDirtyRef.current) flushConfigurationSaveRef.current();
      });
  }, [projectId]);
  useEffect(() => {
    flushConfigurationSaveRef.current = flushConfigurationSave;
  }, [flushConfigurationSave]);

  // Debounced persistence — configuration is never lost on reload (barring the sub-500ms
  // window before the timer fires, which the hide/unmount/unload flush effects below cover).
  useEffect(() => {
    if (!configuration) return;
    configDirtyRef.current = true;
    queueMicrotask(() => setSaveState("saving"));
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flushConfigurationSave, 500);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [configuration, flushConfigurationSave]);

  // Product title/description equivalent of flushConfigurationSave above. No optimistic
  // concurrency here — the product record isn't subject to the same multi-tab race in practice
  // (it's a single title/description pair, not a whole template), so this stays as simple as
  // the original debounced save, just factored out so the hide/unmount flush can reuse it.
  const flushProductSaveRef = useRef<() => void>(() => {});
  const flushProductSave = useCallback(() => {
    if (productSaveTimer.current) {
      clearTimeout(productSaveTimer.current);
      productSaveTimer.current = null;
    }
    if (productSaveInFlightRef.current) {
      productDirtyRef.current = true;
      return;
    }
    const current = productRef.current;
    if (!current) return;
    productSaveInFlightRef.current = true;
    const { title, description } = current;
    setSaveState("saving");
    fetch(`/api/project/${projectId}/product`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, description }),
    })
      .then((res) => {
        if (!res.ok) throw new Error();
        productDirtyRef.current = false;
        setSaveState("saved");
        return "saved" as const;
      })
      .catch((): "error" => {
        setNotice("Could not save the product.");
        return "error";
      })
      .then((outcome) => {
        productSaveInFlightRef.current = false;
        if (outcome === "saved" && productDirtyRef.current) flushProductSaveRef.current();
      });
  }, [projectId]);
  useEffect(() => {
    flushProductSaveRef.current = flushProductSave;
  }, [flushProductSave]);

  // Debounced persistence for the product title/description — mirrors the configuration save
  // above, so inline edits, AI rewrites, and undo/redo of either all end up saved the same way.
  useEffect(() => {
    if (skipNextProductSave.current) {
      skipNextProductSave.current = false;
      return;
    }
    if (!product) return;
    productDirtyRef.current = true;
    queueMicrotask(() => setSaveState("saving"));
    if (productSaveTimer.current) clearTimeout(productSaveTimer.current);
    productSaveTimer.current = setTimeout(flushProductSave, 500);
    return () => {
      if (productSaveTimer.current) clearTimeout(productSaveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.title, product?.description, flushProductSave]);

  // Flush a pending save as soon as the tab is hidden (switched away from, backgrounded) or
  // the editor unmounts (SPA navigation away from this route) — both still allow a normal
  // fetch to complete, unlike an actual page close/reload, which beforeunload below covers.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState !== "hidden") return;
      if (configDirtyRef.current) flushConfigurationSave();
      if (productDirtyRef.current) flushProductSave();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [flushConfigurationSave, flushProductSave]);

  useEffect(() => {
    return () => {
      if (configDirtyRef.current) flushConfigurationSave();
      if (productDirtyRef.current) flushProductSave();
    };
    // Empty deps deliberately — this must run only on true unmount, not on every
    // configuration/product change (flushConfigurationSave/flushProductSave only close over
    // `projectId`, which never changes for a mounted editor, so the captured versions stay
    // current).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Last-resort backstop for a hard reload/close that happens before the above get a chance to
  // run. navigator.sendBeacon is the one mechanism reliably delivered during actual unload;
  // it can only POST, hence the route's POST alias. Payloads are capped (~64KB in most
  // browsers) — an unusually large configuration could still fail to flush this way, a known,
  // accepted limitation. Also nudges the browser's native "leave site?" prompt as a human
  // backstop, but only when there's a real unsaved change.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!configDirtyRef.current || !configRef.current) return;
      const payload = JSON.stringify({
        configuration: configRef.current,
        expectedUpdatedAt: lastKnownUpdatedAtRef.current,
      });
      navigator.sendBeacon(
        `/api/project/${projectId}/configuration`,
        new Blob([payload], { type: "application/json" }),
      );
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [projectId]);

  // The conflict dialog's explicit, user-approved overwrite: take the fresher timestamp the
  // server just reported and save the local draft over it. Deliberately not automatic — the
  // whole point of the 409 is that silently overwriting someone else's save is exactly what
  // this feature exists to prevent.
  const keepMyVersion = useCallback(() => {
    if (!conflict) return;
    lastKnownUpdatedAtRef.current = conflict.currentUpdatedAt;
    configDirtyRef.current = true;
    setConflict(null);
    flushConfigurationSave();
  }, [conflict, flushConfigurationSave]);

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
  const selectedSectionName =
    resolveSchemaLabel(activeSchema?.name, schemaLocale) || selection?.sectionType || "Section";

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
  // Whichever block the current selection is actually scoped to, regardless of *how* it got
  // there — a bound text field inside a block, or a non-text click (image, plain wrapper) that
  // only resolved to blockScope. `binding` and `blockScope` are mutually exclusive (PreviewFrame
  // never sets both), so this is never ambiguous. Null means the section root itself is selected.
  const activeBlockPath = binding && binding.blockPath.length > 0 ? binding.blockPath : blockScope;
  // A direct click on an image_picker-backed <img> (data-sf-editable="image") — shows
  // ImageChangeButton instead of the text toolbar.
  const imageSettingId = !binding && selection?.editable === "image" ? selection.settingId : null;
  // The clicked image's current value — seeds AiImageEditPanel's reference image when "Edit
  // with AI" opens, read the same way boundValues reads a bound text setting's current value.
  const currentImageNode =
    imageSettingId && selectedSection
      ? ((blockScope && blockScope.length > 0 ? getBlockAt(selectedSection, blockScope) : selectedSection) as
          | { settings?: Record<string, unknown> }
          | undefined)
      : undefined;
  const currentImageUrl =
    imageSettingId && currentImageNode ? String(currentImageNode.settings?.[imageSettingId] ?? "") : "";
  const scopedBlockType =
    selectedSection && blockScope ? (getBlockAt(selectedSection, blockScope) as { type?: string } | undefined)?.type ?? null : null;
  const activeScopedBlockSchema =
    scopedBlockSchema && scopedBlockSchema.type === scopedBlockType ? scopedBlockSchema.schema : null;

  useEffect(() => {
    const type = scopedBlockType;
    if (!type) return;
    let cancelled = false;
    loadBlockSchema(readTemplate, type).then((loaded) => {
      if (!cancelled) setScopedBlockSchema({ type, schema: loaded });
    });
    return () => {
      cancelled = true;
    };
  }, [scopedBlockType, readTemplate]);

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
  const doPublish = useCallback(async () => {
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
      // This theme is now the store's live one.
      setStoreActiveThemeId(projectId);
    } catch {
      setPublishError("Something went wrong while publishing.");
    } finally {
      setPublishing(false);
    }
  }, [projectId]);

  // Re-publishing the theme that's already live is the common case and skips the confirm step;
  // publishing a different, currently-draft theme replaces the store's live theme, so that gets
  // a confirmation first since it's a real behavior change for the merchant's storefront.
  const publish = useCallback(() => {
    if (storeActiveThemeId && storeActiveThemeId !== projectId) {
      setConfirmPublish(true);
      return;
    }
    doPublish();
  }, [storeActiveThemeId, projectId, doPublish]);

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

  // Add Block: same shape as addSection, but for one block type from the *currently relevant
  // container's* own schema — the selected section's top level, or (when a nested container
  // block like a Custom Columns "Column" is scoped) that block's own `{% schema %}` blocks
  // array one level deeper. Real Shopify lets a merchant add a block at either level the same
  // way, so this targets `blockScope` when set instead of always the section root.
  const addBlockToSection = useCallback(
    (blockDef: NonNullable<ShopifySectionSchema["blocks"]>[number]) => {
      if (!selectedSectionId) return;
      const id = generateInstanceId(blockDef.type);
      const block = createBlockInstance(blockDef.type, blockDef);
      const path = blockScope ?? [];
      updateTemplate((template) => {
        const section = template.sections[selectedSectionId];
        if (!section) return template;
        return replaceSection(template, selectedSectionId, addBlockAt(section, path, id, block));
      });
      setBlockPickerOpen(false);
    },
    [selectedSectionId, blockScope, updateTemplate],
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

  const handleMoveBlock = useCallback(
    (delta: -1 | 1) => {
      if (!selectedSectionId || !activeBlockPath) return;
      updateTemplate((template) => {
        const section = template.sections[selectedSectionId];
        if (!section) return template;
        return replaceSection(template, selectedSectionId, moveBlockAt(section, activeBlockPath, delta));
      });
    },
    [selectedSectionId, activeBlockPath, updateTemplate],
  );

  const handleDeleteBlock = useCallback(() => {
    if (!selectedSectionId || !activeBlockPath) return;
    updateTemplate((template) => {
      const section = template.sections[selectedSectionId];
      if (!section) return template;
      return replaceSection(template, selectedSectionId, removeBlockAt(section, activeBlockPath));
    });
    // Keep the section selected; the block (and any bound text within it) is gone.
    setSelection((prev) =>
      prev ? { ...prev, binding: null, settingId: null, editable: null, blockScope: null } : prev,
    );
  }, [selectedSectionId, activeBlockPath, updateTemplate]);

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
  const handleSectionRectChange = useCallback((rect: SelectionRect | null) => setSectionRect(rect), []);
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
        <span className="flex min-w-0 items-center gap-1.5 text-neutral-400">
          {storeId ? (
            <a href={`/store/${storeId}`} className="truncate hover:text-white hover:underline">
              {storeName ?? product?.title ?? "Untitled store"}
            </a>
          ) : (
            <span className="truncate">{storeName ?? product?.title ?? "Untitled store"}</span>
          )}
          <span aria-hidden="true">/</span>
          <span className="truncate text-neutral-200">{themeName ?? "Theme"}</span>
        </span>

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

          <button
            onClick={() => setShowDuplicateTheme(true)}
            title="Duplicate this theme"
            className="rounded p-1.5 text-neutral-400 hover:bg-white/10 hover:text-white"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>

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

          <span className="whitespace-nowrap text-right text-xs text-neutral-500">
            {saveState === "saving" ? (
              "Saving…"
            ) : saveState === "saved" ? (
              "Saved"
            ) : saveState === "conflict" ? (
              <span className="text-amber-500">Conflict</span>
            ) : saveState === "error" ? (
              <button
                onClick={() => flushConfigurationSave()}
                className="text-red-500 underline decoration-dotted hover:text-red-400"
              >
                Save failed — Retry
              </button>
            ) : (
              ""
            )}
          </span>

          <a
            href={`/api/project/${projectId}/export-zip`}
            title="Download the theme this project would publish to Shopify, as a zip"
            className="rounded border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-300 hover:bg-white/10 hover:text-white"
          >
            Download zip
          </a>

          <button
            onClick={() => setShowPublicLink(true)}
            title="Share a public link to this theme's storefront"
            className={`flex items-center gap-1.5 rounded border px-3 py-1.5 text-xs font-medium ${
              publicPreviewEnabled
                ? "border-[#8B5CF6]/40 bg-[#1B1530] text-[#A78BFA] hover:bg-[#241a3d]"
                : "border-neutral-700 text-neutral-300 hover:bg-white/10 hover:text-white"
            }`}
          >
            <Link className="h-3.5 w-3.5" />
            Public link
          </button>

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
                setAiImagePanelOpen(false);
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
              setAiImagePanelOpen(false);
            }
          }}
        />

        {/* Sections, AI, Media, and AI-image-edit are four views of the same left sidebar
            slot — only one renders at a time, right beside the rail, never as a separate
            floating overlay. */}
        {mediaPickerTarget !== null || mediaPanelOpen || aiReferencePicking ? (
          <MediaPanel
            open
            images={product?.images ?? []}
            generatedImages={(product?.generatedImages ?? []).map((g) => ({ url: g.url, altText: g.prompt }))}
            onSelect={(url) => {
              if (aiReferencePicking) {
                setAiReferenceUrl(url);
                setAiReferencePicking(false);
                return;
              }
              if (mediaPickerTarget && selection?.sectionId) {
                updateSetting(selection.sectionId, mediaPickerTarget.settingId, url, mediaPickerTarget.blockPath);
              }
              setMediaPickerTarget(null);
              setMediaPanelOpen(false);
            }}
            onClose={() => {
              setMediaPickerTarget(null);
              setMediaPanelOpen(false);
              setAiReferencePicking(false);
            }}
          />
        ) : aiImagePanelOpen ? (
          <AiImageEditPanel
            productId={product?.id ?? null}
            sourceImageUrl={aiReferenceUrl}
            onChooseReference={() => setAiReferencePicking(true)}
            onGenerated={(image: GeneratedImage) =>
              setProduct((prev) => (prev ? { ...prev, generatedImages: [...prev.generatedImages, image] } : prev))
            }
            onUseImage={(url) => {
              if (aiImageTarget && selection?.sectionId) {
                updateSetting(selection.sectionId, aiImageTarget.settingId, url, aiImageTarget.blockPath);
              }
              setAiImagePanelOpen(false);
            }}
            onClose={() => setAiImagePanelOpen(false)}
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
              ref={previewFrameRef}
              html={html}
              resetScrollKey={page}
              selectedSectionId={selection?.sectionId ?? null}
              onSelect={handleSelect}
              onTextCommit={handleTextCommit}
              resolveText={resolveText}
              onRectChange={handleRectChange}
              onSectionRectChange={handleSectionRectChange}
              onUndo={undo}
              onRedo={redo}
            />
          </div>

          {selection?.sectionId && sectionRect ? (
            <SectionNameBadge rect={sectionRect} name={selectedSectionName} />
          ) : null}

          {selection?.sectionId && !binding && !showRewrite ? (
            <SectionToolbar
              rect={selectionRect}
              containerHeight={previewHeight}
              busy={rewriting}
              onMagicBrush={magicBrush}
              onRewrite={() => setShowRewrite((v) => !v)}
              onEditSection={() => setPanelOpen(true)}
              // A click that only resolved to blockScope (an image, or a plain non-text area of
              // a block) still selects the whole section for Magic brush/Re-write/Edit section —
              // but Move/Delete should act on that specific block instead of the section it
              // lives in, same as a bound text field's block already does.
              onMove={blockScope ? handleMoveBlock : handleMove}
              onDelete={() => setConfirmDelete(blockScope ? "block" : "section")}
              deleteLabel={blockScope ? "Delete block" : "Delete section"}
              canAddBlock={Boolean((blockScope ? activeScopedBlockSchema : activeSchema)?.blocks?.length)}
              onAddBlock={() => setBlockPickerOpen(true)}
            />
          ) : null}

          {selection?.sectionId && !binding && !showRewrite && sectionRect ? (
            <div
              className="pointer-events-none absolute inset-x-0 z-10"
              style={{ top: sectionRect.top + sectionRect.height }}
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
              dictationLang={speechLocaleFor(projectLanguage)}
              onDictate={(text, isFinal) => previewFrameRef.current?.insertDictatedText(text, isFinal)}
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
              onMoveBlock={handleMoveBlock}
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
              aiEnabled={generateImages}
              onChooseMedia={() => {
                setMediaPickerTarget({ settingId: imageSettingId, blockPath: blockScope ?? [] });
                setAiPanelOpen(false);
                setAiImagePanelOpen(false);
              }}
              onEditWithAI={() => {
                setAiImageTarget({ settingId: imageSettingId, blockPath: blockScope ?? [] });
                setAiReferenceUrl(currentImageUrl);
                setAiImagePanelOpen(true);
                setAiPanelOpen(false);
                setMediaPickerTarget(null);
                setMediaPanelOpen(false);
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
              dictationLang={speechLocaleFor(projectLanguage)}
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
              setAiImagePanelOpen(false);
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

      <BlockPicker
        open={blockPickerOpen}
        blocks={(blockScope ? activeScopedBlockSchema : activeSchema)?.blocks ?? []}
        schemaLocale={schemaLocale}
        readTemplate={readTemplate}
        onSelect={addBlockToSection}
        onClose={() => setBlockPickerOpen(false)}
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

      {confirmPublish ? (
        <ConfirmDialog
          tone="info"
          title="Make this the active theme?"
          message={`"${themeName ?? "This theme"}" will become live on ${shopifyShopDomain}. The theme currently live becomes a draft you can still edit and republish.`}
          confirmLabel="Publish"
          onConfirm={() => {
            setConfirmPublish(false);
            doPublish();
          }}
          onCancel={() => setConfirmPublish(false)}
        />
      ) : null}

      {showDuplicateTheme ? (
        <DuplicateThemeModal
          sourceName={themeName ?? "This theme"}
          onClose={() => setShowDuplicateTheme(false)}
          onConfirm={duplicateTheme}
        />
      ) : null}

      {showPublicLink ? (
        <PublicLinkModal
          themeName={themeName ?? "This theme"}
          enabled={publicPreviewEnabled}
          token={publicPreviewToken}
          busy={publicLinkBusy}
          onClose={() => setShowPublicLink(false)}
          onToggle={setPublicPreview}
        />
      ) : null}

      {conflict ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-neutral-950/50 p-4">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-label="This project changed elsewhere"
            className="w-full max-w-sm rounded-2xl bg-neutral-900 p-5 text-white shadow-2xl ring-1 ring-white/10"
          >
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-amber-500/15 text-amber-400">
                <AlertCircle className="h-4.5 w-4.5" strokeWidth={1.75} />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold">This project changed elsewhere</p>
                <p className="mt-1 text-xs leading-relaxed text-neutral-400">
                  It looks like this project was edited in another tab or device since you last saved. Reload to
                  see the latest version, or keep editing and save your version over it.
                </p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => window.location.reload()}
                className="rounded-full px-4 py-1.5 text-xs font-medium text-neutral-300 ring-1 ring-white/15 hover:bg-neutral-700 hover:text-white"
              >
                Reload latest
              </button>
              <button
                onClick={keepMyVersion}
                className="rounded-full bg-amber-500 px-4 py-1.5 text-xs font-medium text-neutral-900 hover:bg-amber-400"
              >
                Keep my version
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
