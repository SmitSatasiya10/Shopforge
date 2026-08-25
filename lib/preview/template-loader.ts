export type TemplateReader = (relativePath: string) => Promise<string>;

/** Browser-side reader: fetches from /base-theme/... (public/ is served at the root), cached in memory. */
export function createFetchTemplateReader(baseUrl = "/base-theme"): TemplateReader {
  const cache = new Map<string, Promise<string>>();
  return (relativePath: string) => {
    let entry = cache.get(relativePath);
    if (!entry) {
      entry = fetch(`${baseUrl}/${relativePath}`).then((res) => {
        if (!res.ok) throw new Error(`Template not found: ${relativePath}`);
        return res.text();
      });
      cache.set(relativePath, entry);
    }
    return entry;
  };
}

/** Same idea as TemplateReader, but for binary assets (images) — text decoding would corrupt them. */
export type BinaryReader = (relativePath: string) => Promise<Uint8Array>;

/** Browser-side binary reader, same fetch/cache shape as createFetchTemplateReader. */
export function createFetchBinaryReader(baseUrl = "/base-theme"): BinaryReader {
  const cache = new Map<string, Promise<Uint8Array>>();
  return (relativePath: string) => {
    let entry = cache.get(relativePath);
    if (!entry) {
      entry = fetch(`${baseUrl}/${relativePath}`).then(async (res) => {
        if (!res.ok) throw new Error(`Asset not found: ${relativePath}`);
        return new Uint8Array(await res.arrayBuffer());
      });
      cache.set(relativePath, entry);
    }
    return entry;
  };
}
