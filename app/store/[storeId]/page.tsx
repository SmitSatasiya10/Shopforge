"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ThemeCard, type ThemeSummary } from "@/components/ThemeCard";
import { DuplicateThemeModal } from "@/components/DuplicateThemeModal";
import { PublicLinkModal } from "@/components/PublicLinkModal";

interface StoreDetail {
  id: string;
  name: string;
  shopifyShopDomain: string | null;
  activeThemeId: string | null;
  themes: ThemeSummary[];
}

// Non-destructive "start a new theme" flow: pick blank vs. duplicate an existing theme, then
// name it, then POST /api/store/:id/theme. Kept inline (not its own component) since it's
// entirely specific to this one page's composition, same as the import wizard's own steps.
function CreateThemeModal({
  storeId,
  themes,
  onClose,
  onCreated,
}: {
  storeId: string;
  themes: ThemeSummary[];
  onClose: () => void;
  onCreated: (theme: ThemeSummary) => void;
}) {
  const [duplicateFrom, setDuplicateFrom] = useState<string | null>(null);
  const [name, setName] = useState("New theme");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function selectDuplicateFrom(themeId: string) {
    setDuplicateFrom(themeId);
    const source = themes.find((t) => t.id === themeId);
    setName(source ? `${source.name} (Copy)` : "New theme");
  }

  async function create() {
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(`/api/store/${storeId}/theme`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), ...(duplicateFrom ? { duplicateFrom } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not create the theme");
        return;
      }
      onCreated({
        id: data.project.id,
        name: data.project.name,
        publicPreviewEnabled: false,
        publicPreviewToken: null,
        publicPreviewExpiresAt: null,
      });
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-neutral-950/50 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Create theme"
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl bg-neutral-900 p-5 text-white shadow-2xl ring-1 ring-white/10"
      >
        <p className="text-sm font-semibold">Create theme</p>

        <div className="mt-4 space-y-2">
          <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-white/10 p-3 has-[:checked]:border-[#8B5CF6]/50 has-[:checked]:bg-[#8B5CF6]/[0.07]">
            <input
              type="radio"
              name="start"
              checked={duplicateFrom === null}
              onChange={() => {
                setDuplicateFrom(null);
                setName("New theme");
              }}
              className="mt-0.5"
            />
            <span>
              <span className="block text-xs font-medium">Blank theme</span>
              <span className="block text-[11px] text-neutral-400">Starts from the default theme layout.</span>
            </span>
          </label>

          {themes.length > 0 && (
            <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-white/10 p-3 has-[:checked]:border-[#8B5CF6]/50 has-[:checked]:bg-[#8B5CF6]/[0.07]">
              <input
                type="radio"
                name="start"
                checked={duplicateFrom !== null}
                onChange={() => selectDuplicateFrom(themes[0].id)}
                className="mt-0.5"
              />
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium">Duplicate an existing theme</span>
                {duplicateFrom !== null && (
                  <select
                    value={duplicateFrom}
                    onChange={(e) => selectDuplicateFrom(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    className="mt-1.5 w-full rounded-lg border border-white/15 bg-neutral-800 px-2 py-1 text-xs text-white"
                  >
                    {themes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                )}
              </span>
            </label>
          )}
        </div>

        <label className="mt-4 block">
          <span className="text-[11px] text-neutral-400">Theme name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-lg border border-white/15 bg-neutral-800 px-2.5 py-1.5 text-xs text-white"
          />
        </label>

        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-full px-4 py-1.5 text-xs font-medium text-neutral-300 ring-1 ring-white/15 hover:bg-neutral-700 hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={create}
            disabled={creating || !name.trim()}
            className="rounded-full bg-[#8B5CF6] px-4 py-1.5 text-xs font-medium text-white hover:bg-[#7C3AED] disabled:opacity-50"
          >
            {creating ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function StoreThemesPage() {
  const { storeId } = useParams<{ storeId: string }>();
  const router = useRouter();
  const [store, setStore] = useState<StoreDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [duplicatingTheme, setDuplicatingTheme] = useState<ThemeSummary | null>(null);
  const [publicLinkTheme, setPublicLinkTheme] = useState<ThemeSummary | null>(null);
  const [busyThemeId, setBusyThemeId] = useState<string | null>(null);

  function load() {
    fetch(`/api/store/${storeId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) return setLoadError(data.error);
        setStore(data.store);
      })
      .catch(() => setLoadError("Could not load this store"));
  }

  useEffect(load, [storeId]);

  async function renameTheme(themeId: string, name: string) {
    setBusyThemeId(themeId);
    try {
      const res = await fetch(`/api/project/${themeId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok) load();
    } finally {
      setBusyThemeId(null);
    }
  }

  async function duplicateTheme(themeId: string, name: string) {
    setBusyThemeId(themeId);
    setDuplicatingTheme(null);
    try {
      const res = await fetch(`/api/store/${storeId}/theme`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, duplicateFrom: themeId }),
      });
      if (res.ok) load();
    } finally {
      setBusyThemeId(null);
    }
  }

  async function deleteTheme(themeId: string) {
    setBusyThemeId(themeId);
    try {
      const res = await fetch(`/api/store/${storeId}/theme/${themeId}`, { method: "DELETE" });
      if (res.ok) load();
    } finally {
      setBusyThemeId(null);
    }
  }

  async function setPublicPreview(themeId: string, enabled: boolean, rotate = false) {
    setBusyThemeId(themeId);
    try {
      const res = await fetch(`/api/store/${storeId}/theme/${themeId}/public-link`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled, ...(rotate ? { rotate: true } : {}) }),
      });
      if (res.ok) {
        const data = await res.json();
        setPublicLinkTheme((cur) =>
          cur && cur.id === themeId
            ? {
                ...cur,
                publicPreviewEnabled: data.publicPreviewEnabled,
                publicPreviewToken: data.publicPreviewToken,
                publicPreviewExpiresAt: data.publicPreviewExpiresAt,
              }
            : cur,
        );
        load();
      }
    } finally {
      setBusyThemeId(null);
    }
  }

  // Once Shopify is connected, "active" is a real publish, not just a local marker — the
  // theme currently live on the shop gets replaced with this one.
  async function makeActive(themeId: string) {
    if (!store) return;
    setBusyThemeId(themeId);
    try {
      if (store.shopifyShopDomain) {
        await fetch(`/api/project/${themeId}/publish`, { method: "POST" });
      } else {
        await fetch(`/api/store/${storeId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ activeThemeId: themeId }),
        });
      }
      load();
    } finally {
      setBusyThemeId(null);
    }
  }

  if (loadError) {
    return <div className="flex flex-1 items-center justify-center bg-[#09090B] text-red-400">{loadError}</div>;
  }
  if (!store) {
    return <div className="flex flex-1 items-center justify-center bg-[#09090B] text-[#71717A]">Loading…</div>;
  }

  return (
    <div className="relative isolate flex flex-1 flex-col overflow-y-auto bg-[#09090B] text-[#FAFAFA]">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[#09090B]" aria-hidden="true" />
      <div className="bg-grain pointer-events-none fixed inset-0 -z-10 opacity-[0.025]" aria-hidden="true" />

      <div className="mx-auto w-full max-w-[1200px] flex-1 px-6 py-10 sm:px-8 sm:py-12">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.push("/dashboard")}
            aria-label="Back to your stores"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-[#A1A1AA] hover:border-white/20 hover:bg-white/5 hover:text-[#FAFAFA]"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.75">
              <path d="M12.5 4.5 7 10l5.5 5.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            onClick={() => router.push("/dashboard")}
            className="text-[15px] font-medium text-[#A1A1AA] hover:text-white hover:underline"
          >
            Your stores
          </button>
        </div>

        <div className="mt-4 flex items-center justify-between gap-4">
          <h1 className="text-[26px] font-semibold tracking-[-0.01em]">{store.name}</h1>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="rounded-full bg-neutral-50 px-4 py-2 text-[13px] font-medium text-neutral-900 hover:bg-neutral-200"
          >
            + Create theme
          </button>
        </div>

        <p className="mt-1 text-[13px] text-[#71717A]">Themes</p>

        <div className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {store.themes.map((theme) => (
            <ThemeCard
              key={theme.id}
              theme={theme}
              isActive={theme.id === store.activeThemeId}
              busy={busyThemeId === theme.id}
              onRename={(name) => renameTheme(theme.id, name)}
              onDuplicate={() => setDuplicatingTheme(theme)}
              onDelete={() => deleteTheme(theme.id)}
              onMakeActive={() => makeActive(theme.id)}
              onOpenPublicLink={() => setPublicLinkTheme(theme)}
            />
          ))}
        </div>
      </div>

      {duplicatingTheme ? (
        <DuplicateThemeModal
          sourceName={duplicatingTheme.name}
          onClose={() => setDuplicatingTheme(null)}
          onConfirm={(name) => duplicateTheme(duplicatingTheme.id, name)}
        />
      ) : null}

      {publicLinkTheme ? (
        <PublicLinkModal
          themeName={publicLinkTheme.name}
          enabled={publicLinkTheme.publicPreviewEnabled}
          token={publicLinkTheme.publicPreviewToken}
          expiresAt={publicLinkTheme.publicPreviewExpiresAt}
          busy={busyThemeId === publicLinkTheme.id}
          onClose={() => setPublicLinkTheme(null)}
          onToggle={(enabled) => setPublicPreview(publicLinkTheme.id, enabled)}
          onRotate={() => setPublicPreview(publicLinkTheme.id, true, true)}
        />
      ) : null}

      {showCreate ? (
        <CreateThemeModal
          storeId={store.id}
          themes={store.themes}
          onClose={() => setShowCreate(false)}
          onCreated={(theme) => {
            setShowCreate(false);
            router.push(`/editor/${theme.id}`);
          }}
        />
      ) : null}
    </div>
  );
}
