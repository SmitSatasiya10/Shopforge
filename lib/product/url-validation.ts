// Client-side URL validation for immediate feedback (docs/product-phases/02-product-import.md).
// The server remains the source of truth for fetch/SSRF safety — this only improves UX and
// must stay safe to bundle into client code (no fetch, no server-only imports).
export type UrlValidationResult = { valid: true } | { valid: false; error: string };

export function validateProductUrl(input: string): UrlValidationResult {
  const trimmed = input.trim();
  if (!trimmed) return { valid: false, error: "Enter a product URL" };

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, error: "Enter a valid URL, e.g. https://store.com/products/example" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { valid: false, error: "Only http and https URLs are supported" };
  }

  return { valid: true };
}
