// BCP-47 locale for each store-content language (lib/store-config/language.ts), used only to
// bias the browser's speech recognizer toward the right language/region (docs/
// VOICE-DICTATION-PLAN.md §4). This is an input hint for what the user is *speaking* — it never
// translates, the same way languageInstruction() only steers AI-written copy.

import { DEFAULT_STORE_LANGUAGE } from "./language";

export const STORE_LANGUAGE_TO_SPEECH_LOCALE: Record<string, string> = {
  en: "en-US",
  fr: "fr-FR",
  de: "de-DE",
  es: "es-ES",
  it: "it-IT",
  pt: "pt-PT",
  nl: "nl-NL",
  pl: "pl-PL",
  ar: "ar-SA",
  bg: "bg-BG",
  cs: "cs-CZ",
  da: "da-DK",
  el: "el-GR",
  fi: "fi-FI",
  he: "he-IL",
  hi: "hi-IN",
  hr: "hr-HR",
  hu: "hu-HU",
  id: "id-ID",
  ja: "ja-JP",
  ko: "ko-KR",
  lt: "lt-LT",
  lv: "lv-LV",
  ms: "ms-MY",
  // Speech engines don't generally recognize the bare "no" macrolanguage tag — nb-NO (Norwegian
  // Bokmål) is the de facto BCP-47 tag actually used for Norwegian speech input.
  no: "nb-NO",
  ro: "ro-RO",
  ru: "ru-RU",
  sk: "sk-SK",
  sl: "sl-SI",
  sv: "sv-SE",
  th: "th-TH",
  tr: "tr-TR",
  uk: "uk-UA",
  vi: "vi-VN",
  zh: "zh-CN",
};

const FALLBACK_LOCALE = STORE_LANGUAGE_TO_SPEECH_LOCALE[DEFAULT_STORE_LANGUAGE] ?? "en-US";

/**
 * Resolves a store-content language code to the BCP-47 locale the recognizer should be biased
 * toward. An unknown/unmapped code falls back to the default store language's locale rather than
 * throwing or leaving `lang` unset — mirrors languageInstruction()'s "degrade, never break".
 */
export function speechLocaleFor(code: string | undefined): string {
  const resolved = code?.trim().toLowerCase();
  if (!resolved) return FALLBACK_LOCALE;
  return STORE_LANGUAGE_TO_SPEECH_LOCALE[resolved] ?? FALLBACK_LOCALE;
}
