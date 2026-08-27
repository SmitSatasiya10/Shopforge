import { NextResponse } from "next/server";
import { loadCatalog } from "@/lib/ai/catalog";

// GET /api/catalog/sections — the editor's Add Section picker's only server dependency: the
// same curated catalog AI generation already reads from (lib/ai/catalog.ts), exposed to the
// client since loadCatalog() reads from disk and can't run in the browser.
export async function GET() {
  const { sections } = await loadCatalog();
  return NextResponse.json({ sections });
}
