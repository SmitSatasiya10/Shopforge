import * as cheerio from "cheerio";
import { fetchJsonWithLimits, fetchTextWithLimits } from "./fetcher";

// StoreProductDiscovery — turns a store/homepage URL into a bounded list of candidate
// product URLs (docs: store-homepage-product-discovery-prompt.md). Tries the strongest
// source first and falls through; never crawls beyond these three deterministic sources.

export type DiscoverySource = "products_json" | "sitemap" | "homepage_links" | "none";

export const MAX_DISCOVERED_URLS = 30;
export const MAX_FETCHED_PRODUCTS = 20;
export const DISCOVERY_CONCURRENCY = 5;

function normalizeProductUrl(href: string, origin: string): string | null {
  try {
    const u = new URL(href, origin);
    if (u.origin !== origin) return null; // stay on the same store — no cross-site discovery
    if (!/\/(products|product|p)\//.test(u.pathname)) return null;
    u.search = "";
    u.hash = "";
    u.pathname = u.pathname.replace(/\/+$/, "");
    return u.toString();
  } catch {
    return null;
  }
}

function dedupe(urls: string[]): string[] {
  return Array.from(new Set(urls));
}

async function discoverViaProductsJson(origin: string): Promise<string[]> {
  const data = await fetchJsonWithLimits(`${origin}/products.json?limit=${MAX_DISCOVERED_URLS}`);
  if (!data || typeof data !== "object" || !Array.isArray((data as { products?: unknown }).products)) return [];
  const handles = (data as { products: { handle?: unknown }[] }).products
    .map((p) => p.handle)
    .filter((h): h is string => typeof h === "string" && h.length > 0);
  return dedupe(handles.map((h) => `${origin}/products/${h}`)).slice(0, MAX_DISCOVERED_URLS);
}

async function discoverViaSitemap(origin: string): Promise<string[]> {
  const index = await fetchTextWithLimits(`${origin}/sitemap.xml`);
  if (!index) return [];
  const $ = cheerio.load(index, { xmlMode: true });
  const locs = $("loc")
    .map((_, el) => $(el).text().trim())
    .toArray();
  if (locs.length === 0) return [];

  // A plain urlset (not an index) — loc entries are already pages.
  const direct = locs.map((l) => normalizeProductUrl(l, origin)).filter((u): u is string => !!u);
  if (direct.length > 0) return dedupe(direct).slice(0, MAX_DISCOVERED_URLS);

  // A sitemap index — fetch a bounded number of the product sub-sitemaps it links to.
  const productSitemaps = locs.filter((l) => /sitemap_products/i.test(l)).slice(0, 2);
  const collected: string[] = [];
  for (const sitemapUrl of productSitemaps) {
    const xml = await fetchTextWithLimits(sitemapUrl);
    if (!xml) continue;
    const $$ = cheerio.load(xml, { xmlMode: true });
    $$("loc").each((_, el) => {
      const u = normalizeProductUrl($$(el).text().trim(), origin);
      if (u) collected.push(u);
    });
    if (collected.length >= MAX_DISCOVERED_URLS) break;
  }
  return dedupe(collected).slice(0, MAX_DISCOVERED_URLS);
}

async function discoverViaHomepageLinks(origin: string): Promise<string[]> {
  const html = await fetchTextWithLimits(origin);
  if (!html) return [];
  const $ = cheerio.load(html);
  const hrefs = $("a[href]")
    .map((_, el) => $(el).attr("href") ?? "")
    .toArray();
  const found = hrefs.map((h) => normalizeProductUrl(h, origin)).filter((u): u is string => !!u);
  return dedupe(found).slice(0, MAX_DISCOVERED_URLS);
}

/** products.json -> sitemap.xml -> homepage <a> links, in that order; stops at the first source that yields anything. */
export async function discoverProductUrls(origin: string): Promise<{ urls: string[]; source: DiscoverySource }> {
  const viaJson = await discoverViaProductsJson(origin);
  if (viaJson.length > 0) return { urls: viaJson, source: "products_json" };

  const viaSitemap = await discoverViaSitemap(origin);
  if (viaSitemap.length > 0) return { urls: viaSitemap, source: "sitemap" };

  const viaLinks = await discoverViaHomepageLinks(origin);
  if (viaLinks.length > 0) return { urls: viaLinks, source: "homepage_links" };

  return { urls: [], source: "none" };
}

/** Bounded-concurrency map — avoids an unbounded Promise.all over discovered URLs. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
