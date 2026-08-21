// The theme renders `shop.name` in the header logo, the <title> and the footer
// (snippets/header-logo.liquid). A product's own title is not a store name: an Amazon-style
// listing title ("Gurubhai Equipments Round Catering Burner 10x10 Inch Heavy Duty LPG Gas
// Stove Commercial Cooktop for Hotel Restaurant Kitchen") rendered as one fills the entire
// header. The brand is the right answer when the import found one; otherwise the leading
// brand-like words of the title are a much better guess than the whole string, since
// marketplace titles lead with the brand and trail off into specifications.

export const DEFAULT_STORE_NAME = "Shopforge Demo";

/** Past this, it stops reading as a store name and starts reading as a product title. */
const MAX_WORDS = 2;
const MAX_CHARS = 28;

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed : null;
}

/**
 * Takes the leading words of a product title, stopping at the first one that reads as a
 * specification rather than part of a name — a number, a size ("10x10"), or a unit. Returns
 * null when the very first word already looks like one, since there is no name to salvage.
 */
function leadingBrandWords(title: string): string | null {
  const words: string[] = [];
  for (const word of title.split(" ")) {
    if (/\d/.test(word)) break;
    const candidate = [...words, word].join(" ");
    if (candidate.length > MAX_CHARS) break;
    words.push(word);
    if (words.length === MAX_WORDS) break;
  }
  return words.length > 0 ? words.join(" ") : null;
}

/**
 * The store name for the preview and for publishing: the product's brand, else a brand-like
 * prefix of its title, else the default. Never the full product title.
 */
export function deriveStoreName(
  product: { vendor?: string | null; title?: string | null } | null | undefined,
): string {
  const vendor = clean(product?.vendor);
  if (vendor) return vendor.length > MAX_CHARS ? (leadingBrandWords(vendor) ?? DEFAULT_STORE_NAME) : vendor;

  const title = clean(product?.title);
  if (title) {
    const lead = leadingBrandWords(title);
    if (lead) return lead;
  }

  return DEFAULT_STORE_NAME;
}
