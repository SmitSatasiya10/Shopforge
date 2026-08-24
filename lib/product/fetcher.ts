// ProductFetcher — the only place that reaches the network for a merchant's
// product URL. Never expose this to the browser directly (prototype-phase-plan.md §1).
//
// Supplier/competitor import points this at arbitrary third-party domains chosen by the
// user, not just a merchant's own Shopify store, so this module also owns basic SSRF
// hardening (supplier-competitor-import-prompt.md §15): reject non-http(s) and malformed
// URLs, reject hostnames that resolve to a loopback/private/link-local address (including
// cloud metadata endpoints like 169.254.169.254), and re-validate every hop of a redirect
// chain instead of letting fetch() follow redirects blindly.

import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

const FETCH_TIMEOUT_MS = 10_000;
const DNS_TIMEOUT_MS = 5_000;
const MAX_REDIRECTS = 5;
const USER_AGENT = "Shopforge-ProductImport/0.1 (+prototype)";

export class ProductFetchError extends Error {
  constructor(
    message: string,
    public readonly reason: "invalid_url" | "unreachable" | "http_error" | "blocked_host",
  ) {
    super(message);
    this.name = "ProductFetchError";
  }
}

function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  signal?.addEventListener("abort", () => controller.abort());
  controller.signal.addEventListener("abort", () => clearTimeout(timer));
  return controller.signal;
}

export function parseProductUrl(url: string): URL {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("not http(s)");
    }
    return parsed;
  } catch {
    throw new ProductFetchError(`"${url}" is not a valid URL`, "invalid_url");
  }
}

/** True for loopback, RFC1918 private, link-local (incl. 169.254.169.254 cloud metadata), and CGNAT ranges. */
function isDisallowedIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (isIP(ip) === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fe80:")) return true; // link-local
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local
    if (lower.startsWith("::ffff:")) {
      const v4 = lower.slice("::ffff:".length);
      return isIP(v4) === 4 ? isDisallowedIp(v4) : false;
    }
    return false;
  }
  return false;
}

async function assertHostnameIsPublic(hostname: string): Promise<void> {
  const lower = hostname.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".localhost") || lower.endsWith(".local")) {
    throw new ProductFetchError(`Refusing to fetch a local address ("${hostname}")`, "blocked_host");
  }
  // URL.hostname keeps the brackets around an IPv6 literal (e.g. "[::1]") — strip them
  // before the IP check, or an IPv6 loopback/link-local literal silently falls through to
  // (and fails) DNS resolution instead of being recognized and blocked.
  const bareHost = lower.startsWith("[") && lower.endsWith("]") ? lower.slice(1, -1) : lower;
  if (isIP(bareHost)) {
    if (isDisallowedIp(bareHost)) {
      throw new ProductFetchError(`Refusing to fetch a private network address ("${hostname}")`, "blocked_host");
    }
    return;
  }

  let addresses: { address: string }[];
  try {
    addresses = await Promise.race([
      lookup(hostname, { all: true }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DNS lookup timed out")), DNS_TIMEOUT_MS),
      ),
    ]);
  } catch {
    throw new ProductFetchError(`Could not resolve "${hostname}"`, "unreachable");
  }
  if (addresses.length === 0 || addresses.some((a) => isDisallowedIp(a.address))) {
    throw new ProductFetchError(`Refusing to fetch a private network address ("${hostname}")`, "blocked_host");
  }
}

/**
 * Fetches with a bounded, re-validated redirect chain: each hop's URL is re-parsed and its
 * hostname re-checked against the SSRF rules above before being followed, so a redirect
 * can't be used to smuggle a request to a private address past the initial check.
 */
async function fetchWithTimeout(
  url: string,
  headers: Record<string, string>,
  method: "GET" | "HEAD" = "GET",
): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const parsed = parseProductUrl(current);
    await assertHostnameIsPublic(parsed.hostname);

    let res: Response;
    try {
      res = await fetch(parsed.toString(), {
        method,
        headers,
        signal: withTimeout(undefined, FETCH_TIMEOUT_MS),
        redirect: "manual",
        // A merchant's product data (price, stock, images) can change between imports —
        // Next.js's fetch() cache defaults to caching GET requests indefinitely, which
        // would silently serve a stale snapshot of a product page forever.
        cache: "no-store",
      });
    } catch (err) {
      throw new ProductFetchError(
        `Could not reach "${current}": ${err instanceof Error ? err.message : String(err)}`,
        "unreachable",
      );
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new ProductFetchError(`Redirect with no location header from "${current}"`, "http_error");
      current = new URL(location, parsed).toString();
      continue;
    }
    return res;
  }
  throw new ProductFetchError(`Too many redirects for "${url}"`, "http_error");
}

/** Fetches raw HTML for a product page. Throws ProductFetchError, never returns a rejected promise for network issues. */
export async function fetchProductHtml(url: string): Promise<string> {
  const parsed = parseProductUrl(url);
  const res = await fetchWithTimeout(parsed.toString(), {
    "User-Agent": USER_AGENT,
    Accept: "text/html",
  });
  if (!res.ok) {
    throw new ProductFetchError(`Server responded ${res.status} for "${url}"`, "http_error");
  }
  return res.text();
}

const MAX_DISCOVERY_RESPONSE_BYTES = 5_000_000; // bounds products.json/sitemap/homepage fetches during store discovery

async function readTextWithLimit(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return res.text();
  const decoder = new TextDecoder();
  let received = 0;
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      throw new Error("Response exceeded the size limit");
    }
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

/**
 * Fetches a URL and returns size/time-bounded text, or null on any failure
 * (invalid URL, network, timeout, HTTP error, oversized response) — used by
 * store discovery (products.json / sitemap.xml / homepage HTML), never throws.
 */
export async function fetchTextWithLimits(url: string): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = parseProductUrl(url);
  } catch {
    return null;
  }
  try {
    const res = await fetchWithTimeout(parsed.toString(), {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xml,text/xml,application/json",
    });
    if (!res.ok) return null;
    return await readTextWithLimit(res, MAX_DISCOVERY_RESPONSE_BYTES);
  } catch {
    return null;
  }
}

/** Same bounds as fetchTextWithLimits, parsed as JSON. Returns null on any failure, including malformed JSON. */
export async function fetchJsonWithLimits(url: string): Promise<unknown | null> {
  const text = await fetchTextWithLimits(url);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Checks that a candidate image URL is a real, reachable image before it's ever shown to a
 * merchant or persisted (shopforge-personalization-image-selection-plan.md §12: "image URL is
 * reachable or usable"). A HEAD request through the same SSRF-safe fetch used for product
 * pages, checking only the status and content-type — the image bytes themselves are never
 * downloaded here. Never throws; an unreachable host, a non-2xx response, a host a HEAD
 * request can't reach, or a non-image content-type are all just "not valid" rather than an
 * error, since a broken/wrong-typed candidate should be silently dropped, not surfaced.
 */
export async function validateImageUrl(url: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = parseProductUrl(url);
  } catch {
    return false;
  }
  try {
    const res = await fetchWithTimeout(parsed.toString(), { "User-Agent": USER_AGENT, Accept: "image/*" }, "HEAD");
    if (!res.ok) return false;
    const contentType = res.headers.get("content-type") ?? "";
    return contentType.toLowerCase().startsWith("image/");
  } catch {
    return false;
  }
}

/**
 * Tries Shopify's public `{productUrl}.json` endpoint, which every Shopify
 * storefront exposes for a product page and returns structured data far more
 * reliable than DOM scraping. Returns null (never throws) on any failure so
 * callers can fall back to HTML extraction.
 */
export async function tryFetchShopifyProductJson(url: string): Promise<unknown | null> {
  let parsed: URL;
  try {
    parsed = parseProductUrl(url);
  } catch {
    return null;
  }
  if (!/\/products\//.test(parsed.pathname)) return null;

  const jsonUrl = new URL(parsed.toString());
  jsonUrl.search = "";
  jsonUrl.hash = "";
  jsonUrl.pathname = jsonUrl.pathname.replace(/\/?$/, "") + ".json";

  try {
    const res = await fetchWithTimeout(jsonUrl.toString(), {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) return null;
    const body = await res.json();
    if (!body || typeof body !== "object" || !("product" in body)) return null;
    return (body as { product: unknown }).product;
  } catch {
    return null;
  }
}
