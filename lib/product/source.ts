// ProductImportSource — which Start-screen entry point a product came in through.
// Kept separate from NormalizedProduct.source (the extraction method: shopify/generic_html/
// sample) — see supplier-competitor-import-prompt.md §2/§12. A supplier-imported product is
// still extracted via generic JSON-LD/Open Graph, so its NormalizedProduct.source stays
// "generic_html"; SupplierPlatform is tracked alongside it, not folded into that enum.
export type ProductImportSource = "shopify" | "supplier" | "competitor";

export type SupplierPlatform = "aliexpress" | "amazon" | "zendrop" | "teemdrop" | "etsy";

export const SUPPORTED_SUPPLIER_PLATFORMS: SupplierPlatform[] = [
  "aliexpress",
  "amazon",
  "zendrop",
  "teemdrop",
  "etsy",
];

export const SUPPLIER_PLATFORM_LABELS: Record<SupplierPlatform, string> = {
  aliexpress: "AliExpress",
  amazon: "Amazon",
  zendrop: "Zendrop",
  teemdrop: "Teemdrop",
  etsy: "Etsy",
};

export const SUPPORTED_SUPPLIER_LABEL_LIST = SUPPORTED_SUPPLIER_PLATFORMS.map(
  (p) => SUPPLIER_PLATFORM_LABELS[p],
).join(", ");

// Matches "<platform>.<tld>" or "*.<platform>.<tld>", where <tld> is a short TLD
// (optionally with a 2-letter country code, e.g. "com", "co.uk") — NOT an open-ended
// "[a-z.]+", which would also match an attacker-controlled host like "amazon.evil.com"
// (a suffix that merely *starts* with the platform's domain).
const SUPPLIER_HOSTNAME_PATTERNS: Record<SupplierPlatform, RegExp> = {
  aliexpress: /(^|\.)aliexpress\.[a-z]{2,3}(\.[a-z]{2})?$/i,
  amazon: /(^|\.)amazon\.[a-z]{2,3}(\.[a-z]{2})?$/i,
  zendrop: /(^|\.)zendrop\.com$/i,
  teemdrop: /(^|\.)teemdrop\.com$/i,
  etsy: /(^|\.)etsy\.com$/i,
};

/** Hostname-based platform detection — the "canHandle" dispatch every supplier URL goes through. */
export function detectSupplierPlatform(url: URL): SupplierPlatform | null {
  for (const platform of SUPPORTED_SUPPLIER_PLATFORMS) {
    if (SUPPLIER_HOSTNAME_PATTERNS[platform].test(url.hostname)) return platform;
  }
  return null;
}

export function unsupportedSupplierMessage(): string {
  return `This supplier isn't supported yet. Supported suppliers: ${SUPPORTED_SUPPLIER_LABEL_LIST}.`;
}
