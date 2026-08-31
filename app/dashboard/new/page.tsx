"use client";

import { useRouter } from "next/navigation";
import { StartStoreHero } from "@/components/StartStoreHero";

// The 3-option "where is your product coming from?" picker (Shopify / supplier / competitor),
// reached from the dashboard's "+ New store" button. Kept as its own route rather than a query
// param on /dashboard so back-navigation from later wizard steps (see app/import/page.tsx's
// onBack handlers) has a real URL to land on instead of racing dashboard's empty/non-empty
// state check.
export default function NewStorePage() {
  const router = useRouter();
  return <StartStoreHero onBack={() => router.push("/dashboard")} />;
}
