import { readFile } from "node:fs/promises";
import path from "node:path";
import { BinaryReader, TemplateReader } from "./template-loader";

/** Node-side reader (tests, and any future server-rendered thumbnail/share-link path) — reads straight off disk. */
export function createFsTemplateReader(): TemplateReader {
  const root = path.join(process.cwd(), "public", "base-theme");
  const cache = new Map<string, Promise<string>>();
  return (relativePath: string) => {
    let entry = cache.get(relativePath);
    if (!entry) {
      entry = readFile(path.join(root, relativePath), "utf-8");
      cache.set(relativePath, entry);
    }
    return entry;
  };
}

/** Node-side binary reader, same shape as createFsTemplateReader. */
export function createFsBinaryReader(): BinaryReader {
  const root = path.join(process.cwd(), "public", "base-theme");
  const cache = new Map<string, Promise<Uint8Array>>();
  return (relativePath: string) => {
    let entry = cache.get(relativePath);
    if (!entry) {
      entry = readFile(path.join(root, relativePath)).then((buf) => new Uint8Array(buf));
      cache.set(relativePath, entry);
    }
    return entry;
  };
}
