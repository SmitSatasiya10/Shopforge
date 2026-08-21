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
