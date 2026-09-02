"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronDown, Menu, Plus, Store as StoreIcon } from "lucide-react";
import type { StoreSummary } from "@/components/StoreCard";

interface StoreSwitcherMenuProps {
  /** The editor's current store — highlights that row in "Your stores" once expanded. */
  currentStoreId: string | null;
}

/**
 * The editor header's workspace switcher: one icon button opens "Back to Dashboard", an
 * expandable "Your stores" list, and "+ New Store" — same list/shape the dashboard itself
 * renders (GET /api/store, components/StoreCard.tsx's StoreSummary), fetched lazily the first
 * time the list is expanded. Purely navigational — router.push()s to /dashboard,
 * /editor/[projectId], or /dashboard/new — it never touches themeSettings or any editor state.
 */
export function StoreSwitcherMenu({ currentStoreId }: StoreSwitcherMenuProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [storesExpanded, setStoresExpanded] = useState(false);
  const [stores, setStores] = useState<StoreSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Same outside-click/Escape/blur dismissal as the editor's other floating panels
  // (HistoryPanel.tsx): a click inside the preview never reaches this window's "mousedown" —
  // it's a same-origin iframe, and clicking into it moves focus into the iframe's own browsing
  // context instead of bubbling here. That focus move fires "blur" on this window, which is
  // what actually catches the "clicked the preview" case (lib/hooks/use-outside-dismiss.ts's
  // plain mousedown/keydown version is for panels outside the editor, with no such iframe).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onBlur = () => setOpen(false);
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", onBlur);
    };
  }, [open]);

  async function toggleStores() {
    const next = !storesExpanded;
    setStoresExpanded(next);
    if (next && stores === null) {
      setLoading(true);
      try {
        const res = await fetch("/api/store");
        const data = await res.json();
        if (res.ok) setStores(data.stores);
      } finally {
        setLoading(false);
      }
    }
  }

  function goToStore(store: StoreSummary) {
    setOpen(false);
    const targetProjectId = store.activeThemeId ?? store.themes[0]?.id;
    router.push(targetProjectId ? `/editor/${targetProjectId}` : `/store/${store.id}`);
  }

  return (
    <div className="relative shrink-0" ref={rootRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="Switch store"
        aria-pressed={open}
        className={`rounded p-1.5 text-neutral-400 hover:bg-white/10 hover:text-white ${open ? "bg-white/10 text-white" : ""}`}
      >
        <Menu className="h-4 w-4" />
      </button>

      {open ? (
        <div className="absolute top-full left-0 z-30 mt-2 w-72 rounded-2xl bg-neutral-900 p-2 text-white shadow-2xl ring-1 ring-white/10">
          <button
            onClick={() => router.push("/dashboard")}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-medium hover:bg-neutral-800"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Dashboard
          </button>

          <div className="my-1 border-t border-white/10" />

          <button
            onClick={toggleStores}
            aria-expanded={storesExpanded}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-medium hover:bg-neutral-800"
          >
            <StoreIcon className="h-4 w-4" />
            <span className="flex-1">Your stores</span>
            <ChevronDown className={`h-4 w-4 text-neutral-400 transition-transform ${storesExpanded ? "rotate-180" : ""}`} />
          </button>

          {storesExpanded ? (
            <div className="sf-scroll-dark mt-1 flex max-h-64 flex-col gap-0.5 overflow-y-auto px-1">
              {loading ? (
                <p className="px-2 py-2 text-xs text-neutral-500">Loading…</p>
              ) : stores && stores.length > 0 ? (
                stores.map((store) => {
                  const active = store.id === currentStoreId;
                  return (
                    <button
                      key={store.id}
                      onClick={() => goToStore(store)}
                      aria-current={active}
                      className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs ${
                        active ? "bg-neutral-800 font-semibold text-white" : "text-neutral-300 hover:bg-neutral-800"
                      }`}
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-md bg-neutral-700">
                        {store.productImage ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={store.productImage} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <StoreIcon className="h-3.5 w-3.5 text-neutral-400" />
                        )}
                      </span>
                      <span className="flex-1 truncate">{store.name}</span>
                    </button>
                  );
                })
              ) : (
                <p className="px-2 py-2 text-xs text-neutral-500">No stores yet.</p>
              )}
            </div>
          ) : null}

          <div className="my-1 border-t border-white/10" />

          <button
            onClick={() => router.push("/dashboard/new")}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-medium hover:bg-neutral-800"
          >
            <Plus className="h-4 w-4" />
            New Store
          </button>
        </div>
      ) : null}
    </div>
  );
}
