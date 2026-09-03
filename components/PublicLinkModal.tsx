"use client";

import { useState } from "react";
import { Copy } from "lucide-react";

function LinkRow({ label, url }: { label: string; url: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="mt-2">
      <span className="text-[11px] text-neutral-400">{label}</span>
      <div className="mt-1 flex items-center gap-1.5">
        <input
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="w-full min-w-0 truncate rounded-lg border border-white/15 bg-neutral-800 px-2.5 py-1.5 font-mono text-xs text-white"
        />
        <button
          onClick={copy}
          className="flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-neutral-300 ring-1 ring-white/15 hover:bg-neutral-700 hover:text-white"
        >
          <Copy className="h-3.5 w-3.5" /> {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

// Enable/disable and share this theme's public storefront preview link. Shown from the theme
// card's kebab menu, matching DuplicateThemeModal/ConfirmDialog's dark-modal conventions.
export function PublicLinkModal({
  themeName,
  enabled,
  token,
  expiresAt,
  busy,
  onClose,
  onToggle,
  onRotate,
}: {
  themeName: string;
  enabled: boolean;
  token: string | null;
  expiresAt: string | null;
  busy: boolean;
  onClose: () => void;
  onToggle: (enabled: boolean) => void;
  onRotate: () => void;
}) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const expiresLabel = expiresAt
    ? new Date(expiresAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    : null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-neutral-950/50 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Public link"
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl bg-neutral-900 p-5 text-white shadow-2xl ring-1 ring-white/10"
      >
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold">Public link for &quot;{themeName}&quot;</p>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label="Public link"
            onClick={() => onToggle(!enabled)}
            disabled={busy}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
              enabled ? "bg-[#8B5CF6]" : "bg-white/15"
            } disabled:opacity-50`}
          >
            <span
              className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                enabled ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>

        {enabled && token ? (
          <>
            <p className="mt-3 text-[11px] text-neutral-400">
              Anyone with these links can view your storefront. No Shopify connection or login is required.
            </p>
            <LinkRow label="Homepage" url={`${origin}/preview/${token}`} />
            <LinkRow label="Product page" url={`${origin}/preview/${token}/product`} />
            <div className="mt-3 flex items-center justify-between gap-3">
              {expiresLabel ? (
                <span className="text-[11px] text-neutral-500">Expires {expiresLabel}</span>
              ) : (
                <span />
              )}
              <button
                onClick={onRotate}
                disabled={busy}
                className="shrink-0 text-[11px] font-medium text-neutral-300 hover:text-white disabled:opacity-50"
              >
                Get a new link
              </button>
            </div>
          </>
        ) : (
          <p className="mt-3 text-[11px] text-neutral-400">
            Share this theme with anyone without requiring a Shopify connection.
          </p>
        )}

        <div className="mt-5 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-full px-4 py-1.5 text-xs font-medium text-neutral-300 ring-1 ring-white/15 hover:bg-neutral-700 hover:text-white"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
