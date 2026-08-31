"use client";

import { useRef, useState } from "react";
import { Copy, LayoutTemplate, MoreVertical, Pencil, Star, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useOutsideDismiss } from "@/lib/hooks/use-outside-dismiss";

export interface ThemeSummary {
  id: string;
  name: string;
}

interface ThemeCardProps {
  theme: ThemeSummary;
  isActive: boolean;
  busy: boolean;
  onRename: (name: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMakeActive: () => void;
}

export function ThemeCard({ theme, isActive, busy, onRename, onDuplicate, onDelete, onMakeActive }: ThemeCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameInput, setNameInput] = useState(theme.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useOutsideDismiss(menuRef, menuOpen, () => {
    setMenuOpen(false);
    setRenaming(false);
  });

  function submitRename() {
    const name = nameInput.trim();
    setRenaming(false);
    setMenuOpen(false);
    if (name && name !== theme.name) onRename(name);
  }

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#111113] transition-all duration-200 hover:-translate-y-1 hover:border-white/20 hover:bg-[#151518] hover:shadow-[0_12px_32px_-16px_rgba(0,0,0,0.6)]">
      <div className="flex aspect-[16/9] items-center justify-center border-b border-white/[0.08] bg-white/[0.02]">
        <LayoutTemplate className="h-8 w-8 text-[#52525B]" strokeWidth={1.5} aria-hidden="true" />
      </div>

      <div className="flex flex-col gap-1.5 px-4 py-3.5">
        <span className="truncate text-[15px] font-semibold text-[#FAFAFA]">{theme.name}</span>
        {isActive ? (
          <span className="w-fit rounded-full border border-[#8B5CF6]/30 bg-[#1B1530] px-2.5 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-[#A78BFA] uppercase">
            Active
          </span>
        ) : (
          <span className="w-fit rounded-full border border-white/10 px-2.5 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-[#A1A1AA] uppercase">
            Draft
          </span>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-white/[0.08] px-3 py-2">
        <a
          href={`/editor/${theme.id}`}
          className="rounded-md px-2 py-1 text-[12px] font-medium text-[#D4D4D8] hover:bg-white/[0.06] hover:text-white"
        >
          Edit
        </a>

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            title="Theme actions"
            className={`rounded-md p-1.5 text-[#71717A] hover:bg-white/[0.06] hover:text-white ${menuOpen ? "bg-white/[0.06] text-white" : ""}`}
          >
            <MoreVertical className="h-3.5 w-3.5" />
          </button>

          {menuOpen ? (
            <div className="absolute top-full right-0 z-20 mt-2 w-56 rounded-2xl bg-neutral-900 p-2 text-white shadow-2xl ring-1 ring-white/10">
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
                      className="rounded-md bg-white px-2 py-1 text-[11px] font-medium text-neutral-900"
                    >
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                <ul className="space-y-0.5">
                  {!isActive && (
                    <li>
                      <button
                        onClick={() => {
                          setMenuOpen(false);
                          onMakeActive();
                        }}
                        disabled={busy}
                        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-neutral-700 disabled:opacity-50"
                      >
                        <Star className="h-3.5 w-3.5" /> Make active
                      </button>
                    </li>
                  )}
                  <li>
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        onDuplicate();
                      }}
                      disabled={busy}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-neutral-700 disabled:opacity-50"
                    >
                      <Copy className="h-3.5 w-3.5" /> Duplicate
                    </button>
                  </li>
                  <li>
                    <button
                      onClick={() => {
                        setNameInput(theme.name);
                        setRenaming(true);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-neutral-700"
                    >
                      <Pencil className="h-3.5 w-3.5" /> Rename
                    </button>
                  </li>
                  <li>
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        if (!isActive) setConfirmDelete(true);
                      }}
                      disabled={isActive}
                      title={isActive ? "Make another theme active before deleting this one" : undefined}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-red-400 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:text-neutral-600 disabled:hover:bg-transparent"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Delete
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
          title={`Delete "${theme.name}"?`}
          message="This removes the theme's edit history and publish records permanently."
          confirmLabel="Delete"
          onConfirm={() => {
            setConfirmDelete(false);
            onDelete();
          }}
          onCancel={() => setConfirmDelete(false)}
        />
      ) : null}
    </div>
  );
}
