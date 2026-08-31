import { describe, expect, it } from "vitest";
import { ALL_STORE_LANGUAGES } from "./language";
import { speechLocaleFor, STORE_LANGUAGE_TO_SPEECH_LOCALE } from "./dictation-locale";

describe("speechLocaleFor", () => {
  it("maps a known store language code to its BCP-47 locale", () => {
    expect(speechLocaleFor("fr")).toBe("fr-FR");
    expect(speechLocaleFor("ja")).toBe("ja-JP");
  });

  it("is case/whitespace-insensitive, matching normalizeStoreLanguage's convention", () => {
    expect(speechLocaleFor(" FR ")).toBe("fr-FR");
  });

  it("falls back to the default store language's locale for an unknown code", () => {
    expect(speechLocaleFor("xx")).toBe("en-US");
  });

  it("falls back to the default store language's locale for undefined", () => {
    expect(speechLocaleFor(undefined)).toBe("en-US");
  });

  it("has a locale entry for every store-content language, so a future addition can't silently fall through", () => {
    for (const language of ALL_STORE_LANGUAGES) {
      expect(
        STORE_LANGUAGE_TO_SPEECH_LOCALE[language.code],
        `missing speech locale for store language "${language.code}"`,
      ).toBeDefined();
    }
  });
});
