// Customer-facing store-content language (store-content-language-selection-implementation.md).
// This is the TARGET language for generated theme/store copy only — it is not an app/UI
// locale and must never drive the wizard, dashboard or admin language. Kept dependency-free
// so it is safe to import from both "use client" pages and API routes, mirroring
// lib/product/source.ts.

export interface StoreLanguage {
  /** Stable lowercase ISO 639-1 code — the persisted identifier. */
  code: string;
  /** English display name, also used in AI prompt instructions. */
  label: string;
  /** The language's own name, shown as the card description. */
  endonym: string;
  /** Flag emoji for the picker card. */
  flag: string;
}

/** The languages offered directly as cards on the customer-language step. */
export const PRIMARY_STORE_LANGUAGES: StoreLanguage[] = [
  { code: "en", label: "English", endonym: "English", flag: "🇬🇧" },
  { code: "fr", label: "French", endonym: "Français", flag: "🇫🇷" },
  { code: "de", label: "German", endonym: "Deutsch", flag: "🇩🇪" },
  { code: "es", label: "Spanish", endonym: "Español", flag: "🇪🇸" },
  { code: "it", label: "Italian", endonym: "Italiano", flag: "🇮🇹" },
  { code: "pt", label: "Portuguese", endonym: "Português", flag: "🇵🇹" },
  { code: "nl", label: "Dutch", endonym: "Nederlands", flag: "🇳🇱" },
  { code: "pl", label: "Polish", endonym: "Polski", flag: "🇵🇱" },
];

/** Additional languages reachable through the "Other language" search. */
export const OTHER_STORE_LANGUAGES: StoreLanguage[] = [
  { code: "ar", label: "Arabic", endonym: "العربية", flag: "🇸🇦" },
  { code: "bg", label: "Bulgarian", endonym: "Български", flag: "🇧🇬" },
  { code: "cs", label: "Czech", endonym: "Čeština", flag: "🇨🇿" },
  { code: "da", label: "Danish", endonym: "Dansk", flag: "🇩🇰" },
  { code: "el", label: "Greek", endonym: "Ελληνικά", flag: "🇬🇷" },
  { code: "fi", label: "Finnish", endonym: "Suomi", flag: "🇫🇮" },
  { code: "he", label: "Hebrew", endonym: "עברית", flag: "🇮🇱" },
  { code: "hi", label: "Hindi", endonym: "हिन्दी", flag: "🇮🇳" },
  { code: "hr", label: "Croatian", endonym: "Hrvatski", flag: "🇭🇷" },
  { code: "hu", label: "Hungarian", endonym: "Magyar", flag: "🇭🇺" },
  { code: "id", label: "Indonesian", endonym: "Bahasa Indonesia", flag: "🇮🇩" },
  { code: "ja", label: "Japanese", endonym: "日本語", flag: "🇯🇵" },
  { code: "ko", label: "Korean", endonym: "한국어", flag: "🇰🇷" },
  { code: "lt", label: "Lithuanian", endonym: "Lietuvių", flag: "🇱🇹" },
  { code: "lv", label: "Latvian", endonym: "Latviešu", flag: "🇱🇻" },
  { code: "ms", label: "Malay", endonym: "Bahasa Melayu", flag: "🇲🇾" },
  { code: "no", label: "Norwegian", endonym: "Norsk", flag: "🇳🇴" },
  { code: "ro", label: "Romanian", endonym: "Română", flag: "🇷🇴" },
  { code: "ru", label: "Russian", endonym: "Русский", flag: "🇷🇺" },
  { code: "sk", label: "Slovak", endonym: "Slovenčina", flag: "🇸🇰" },
  { code: "sl", label: "Slovenian", endonym: "Slovenščina", flag: "🇸🇮" },
  { code: "sv", label: "Swedish", endonym: "Svenska", flag: "🇸🇪" },
  { code: "th", label: "Thai", endonym: "ไทย", flag: "🇹🇭" },
  { code: "tr", label: "Turkish", endonym: "Türkçe", flag: "🇹🇷" },
  { code: "uk", label: "Ukrainian", endonym: "Українська", flag: "🇺🇦" },
  { code: "vi", label: "Vietnamese", endonym: "Tiếng Việt", flag: "🇻🇳" },
  { code: "zh", label: "Chinese", endonym: "中文", flag: "🇨🇳" },
];

export const ALL_STORE_LANGUAGES: StoreLanguage[] = [
  ...PRIMARY_STORE_LANGUAGES,
  ...OTHER_STORE_LANGUAGES,
];

export const DEFAULT_STORE_LANGUAGE = "en";

export function findStoreLanguage(code: string): StoreLanguage | undefined {
  return ALL_STORE_LANGUAGES.find((l) => l.code === code);
}

export function isStoreLanguageCode(value: unknown): value is string {
  return typeof value === "string" && ALL_STORE_LANGUAGES.some((l) => l.code === value);
}

/**
 * Normalizes an untrusted language value (query param / request body) to a persisted code.
 * Returns null for anything that is not a supported code — callers decide whether that is
 * a validation error or a fall-back to the default. "other" is deliberately not a code:
 * the picker must resolve it to the actual selected language before it gets here.
 */
export function normalizeStoreLanguage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toLowerCase();
  return isStoreLanguageCode(code) ? code : null;
}

/**
 * The explicit generation constraint given to every prompt that writes customer-facing
 * store copy. The language must reach the actual generation layer — never rely on the UI
 * selection alone. Unknown codes still produce a directive using the code itself, so a
 * future language addition degrades to "write in <code>" rather than silently to English.
 */
export function languageInstruction(code: string | undefined): string {
  const resolved = code?.trim().toLowerCase() || DEFAULT_STORE_LANGUAGE;
  const name = findStoreLanguage(resolved)?.label ?? resolved;
  return [
    `Target customer language: ${name} (${resolved}).`,
    `All customer-facing store content must be written in ${name}: hero headings and`,
    `descriptions, CTA/button labels, section headings, product descriptions,`,
    `feature/benefit text, announcements, promotional copy, footer content and`,
    `customer-facing navigation labels.`,
    `Do not mix English into customer-facing copy unless the source/product name is a`,
    `proper brand name, or the original wording is explicitly required.`,
    `Keep JSON structure, section types, ids, setting keys and allowed setting values`,
    `exactly as specified — never translate those.`,
  ].join("\n");
}
