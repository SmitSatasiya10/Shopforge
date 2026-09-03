"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { StartStoreHero } from "@/components/StartStoreHero";
import { StoreCard, type StoreSummary } from "@/components/StoreCard";
import { useCurrentUser } from "@/lib/hooks/use-current-user";

function UserMenu() {
  const router = useRouter();
  const { user } = useCurrentUser();
  const [loggingOut, setLoggingOut] = useState(false);

  async function logout() {
    setLoggingOut(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  if (!user) return null;
  return (
    <div className="flex items-center gap-3 text-[13px] text-neutral-400">
      <span className="truncate">{user.email}</span>
      <button
        type="button"
        onClick={logout}
        disabled={loggingOut}
        className="rounded-full px-3 py-1.5 text-xs font-medium ring-1 ring-white/15 hover:bg-neutral-800 hover:text-white disabled:opacity-50"
      >
        {loggingOut ? "Logging out…" : "Log out"}
      </button>
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [stores, setStores] = useState<StoreSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/store")
      .then((res) => res.json())
      .then((data) => setStores(data.stores ?? []))
      .catch(() => setLoadError("Could not load your stores"));
  }, []);

  if (stores === null) {
    return (
      <div className="flex flex-1 items-center justify-center bg-[#09090B] text-[#71717A]">
        {loadError ?? "Loading…"}
      </div>
    );
  }

  if (stores.length === 0) {
    return <StartStoreHero />;
  }

  return (
    <div className="relative isolate flex flex-1 flex-col overflow-y-auto bg-[#09090B] text-[#FAFAFA]">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[#09090B]" aria-hidden="true" />
      <div className="bg-grain pointer-events-none fixed inset-0 -z-10 opacity-[0.025]" aria-hidden="true" />
      <div
        className="pointer-events-none fixed inset-x-0 top-0 -z-10 h-[420px] bg-[radial-gradient(ellipse_60%_50%_at_50%_0%,rgba(139,92,246,0.14),transparent_70%)]"
        aria-hidden="true"
      />

      <div className="mx-auto w-full max-w-[1200px] flex-1 px-6 py-10 sm:px-8 sm:py-12">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-[26px] font-semibold tracking-[-0.01em]">Your stores</h1>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => router.push("/dashboard/new")}
              className="rounded-full bg-neutral-50 px-4 py-2 text-[13px] font-medium text-neutral-900 hover:bg-neutral-200"
            >
              + New store
            </button>
            <UserMenu />
          </div>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {stores.map((store) => (
            <StoreCard
              key={store.id}
              store={store}
              onRenamed={(name) =>
                setStores((prev) => prev?.map((s) => (s.id === store.id ? { ...s, name } : s)) ?? null)
              }
              onDeleted={() => setStores((prev) => prev?.filter((s) => s.id !== store.id) ?? null)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
