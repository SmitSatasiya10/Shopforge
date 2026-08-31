"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MoreVertical, Pencil, Store as StoreIcon, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { formatRelativeTime } from "@/lib/format/relative-time";
import { useOutsideDismiss } from "@/lib/hooks/use-outside-dismiss";

export interface StoreSummary {
  id: string;
  name: string;
  productTitle: string | null;
  productImage: string | null;
  shopifyShopDomain: string | null;
  activeThemeId: string | null;
  themes: { id: string; name: string }[];
  updatedAt: string;
}

interface StoreCardProps {
  store: StoreSummary;
  onRenamed: (name: string) => void;
  onDeleted: () => void;
}

export function StoreCard({ store, onRenamed, onDeleted }: StoreCardProps) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameInput, setNameInput] = useState(store.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useOutsideDismiss(menuRef, menuOpen, () => {
    setMenuOpen(false);
    setRenaming(false);
  });

  const activeTheme = store.themes.find((t) => t.id === store.activeThemeId) ?? null;
  const themeCount = store.themes.length;
  const editHref = `/editor/${store.activeThemeId ?? store.themes[0]?.id ?? ""}`;

  async function submitRename() {
    const name = nameInput.trim();
    if (!name || name === store.name) {
      setRenaming(false);
      setMenuOpen(false);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/store/${store.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok) onRenamed(name);
    } finally {
      setBusy(false);
      setRenaming(false);
      setMenuOpen(false);
    }
  }

  async function confirmDeleteStore() {
    setBusy(true);
    try {
      const res = await fetch(`/api/store/${store.id}`, { method: "DELETE" });
      if (res.ok) onDeleted();
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#111113] transition-all duration-200 hover:-translate-y-1 hover:border-white/20 hover:bg-[#151518] hover:shadow-[0_12px_32px_-16px_rgba(0,0,0,0.6)]">
      <button
        type="button"
        onClick={() => router.push(`/store/${store.id}`)}
        className="flex flex-1 flex-col text-left focus-visible:outline-none"
      >
        <div className="flex aspect-[16/9] items-center justify-center overflow-hidden border-b border-white/[0.08] bg-white/[0.02]">
          {store.productImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={store.productImage} alt="" className="h-full w-full object-cover" />
          ) : (
            <StoreIcon className="h-8 w-8 text-[#52525B]" strokeWidth={1.5} aria-hidden="true" />
          )}
        </div>

        <div className="flex flex-col gap-1 px-4 py-3.5">
          <span className="truncate text-[15px] font-semibold text-[#FAFAFA]">{store.name}</span>
          <span className="text-[12px] text-[#A1A1AA]">
            {themeCount} theme{themeCount === 1 ? "" : "s"}
            {activeTheme ? ` · Active: ${activeTheme.name}` : ""}
          </span>
          <span className="text-[11px] text-[#52525B]">Updated {formatRelativeTime(new Date(store.updatedAt))}</span>
        </div>
      </button>

      <div className="flex items-center justify-between border-t border-white/[0.08] px-3 py-2">
        <a
          href={editHref}
          onClick={(e) => e.stopPropagation()}
          className="rounded-md px-2 py-1 text-[12px] font-medium text-[#D4D4D8] hover:bg-white/[0.06] hover:text-white"
        >
          Edit
        </a>

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
            title="Store actions"
            className={`rounded-md p-1.5 text-[#71717A] hover:bg-white/[0.06] hover:text-white ${menuOpen ? "bg-white/[0.06] text-white" : ""}`}
          >
            <MoreVertical className="h-3.5 w-3.5" />
          </button>

          {menuOpen ? (
            <div
              onClick={(e) => e.stopPropagation()}
              className="absolute top-full right-0 z-20 mt-2 w-56 rounded-2xl bg-neutral-900 p-2 text-white shadow-2xl ring-1 ring-white/10"
            >
              {renaming ? (
                <div className="p-1.5">
                  <input
                    autoFocus
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submitRename();
                      if (e.key === "Escape") setRenaming(false);
                    }}
                    className="w-full rounded-lg border border-white/15 bg-neutral-800 px-2 py-1 text-xs text-white"
                  />
                  <div className="mt-1.5 flex justify-end gap-1.5">
                    <button
                      onClick={() => setRenaming(false)}
                      className="rounded-md px-2 py-1 text-[11px] text-neutral-400 hover:text-white"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={submitRename}
                      disabled={busy}
                      className="rounded-md bg-white px-2 py-1 text-[11px] font-medium text-neutral-900 disabled:opacity-50"
                    >
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                <ul className="space-y-0.5">
                  <li>
                    <button
                      onClick={() => {
                        setNameInput(store.name);
                        setRenaming(true);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-neutral-700"
                    >
                      <Pencil className="h-3.5 w-3.5" /> Rename store
                    </button>
                  </li>
                  <li>
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        setConfirmDelete(true);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-red-400 hover:bg-red-500/10"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Delete store
                    </button>
                  </li>
                </ul>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {confirmDelete ? (
        <ConfirmDialog
          title={`Delete "${store.name}"?`}
          message={`This deletes all ${themeCount} theme${themeCount === 1 ? "" : "s"} and their edit history. This cannot be undone.`}
          confirmLabel={busy ? "Deleting…" : "Delete"}
          onConfirm={confirmDeleteStore}
          onCancel={() => setConfirmDelete(false)}
        />
      ) : null}
    </div>
  );
}
