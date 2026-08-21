import type { Liquid } from "liquidjs";

// Shopify Liquid compatibility shim — docs/product-spec/02-base-theme-and-section-library.md §2.4
// and 07-liquidjs-vs-shopify-liquid.md confirm LiquidJS has no native `image_url`, `money`,
// `asset_url`, or `t` filters. Only what the prototype's 6 sections actually call is
// implemented here (plan §5's "smallest compatible behavior" rule) — no image resizing
// service, no pluralization, no currency-code-aware formatting.

/** LiquidJS passes Shopify-style named filter args (`width: 800`) as `[key, value]` pairs. */
function namedArgs(args: unknown[]): Record<string, unknown> {
  const hash: Record<string, unknown> = {};
  for (const arg of args) {
    if (Array.isArray(arg) && arg.length === 2 && typeof arg[0] === "string") {
      hash[arg[0]] = arg[1];
    }
  }
  return hash;
}

function readLocalePath(locale: Record<string, unknown>, key: string): string | null {
  const value = key.split(".").reduce<unknown>((node, segment) => {
    if (node && typeof node === "object") return (node as Record<string, unknown>)[segment];
    return undefined;
  }, locale);
  return typeof value === "string" ? value : null;
}

export function registerShopifyFilters(engine: Liquid, locale: Record<string, unknown>) {
  engine.registerFilter("money", (value: unknown) => {
    const n = typeof value === "number" ? value : Number.parseFloat(String(value));
    if (!Number.isFinite(n)) return "";
    return `$${n.toFixed(2)}`;
  });

  // Prototype images are already absolute URLs (scraped src / placeholder) — no
  // resizing service exists yet, so width/height args are accepted (for Shopify
  // syntax compatibility) but not applied.
  engine.registerFilter("image_url", (value: unknown) => {
    return typeof value === "string" ? value : "";
  });

  engine.registerFilter("asset_url", (value: unknown) => `/base-theme/assets/${value}`);

  engine.registerFilter("t", (key: unknown, ...args: unknown[]) => {
    const path = String(key);
    const translated = readLocalePath(locale, path);
    if (translated === null) return path; // missing key: fall back to the key itself, not silent garbage
    const vars = namedArgs(args);
    return translated.replace(/%\{(\w+)\}/g, (_match, name) => String(vars[name] ?? ""));
  });
}
