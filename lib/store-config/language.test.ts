import { describe, it, expect } from "vitest";
import {
  PRIMARY_STORE_LANGUAGES,
  OTHER_STORE_LANGUAGES,
  ALL_STORE_LANGUAGES,
  DEFAULT_STORE_LANGUAGE,
  findStoreLanguage,
  isStoreLanguageCode,
  normalizeStoreLanguage,
  languageInstruction,
} from "./language";

// The customer store-content language: the identifier the wizard persists and the prompt
// constraint every content-generation call receives
// (store-content-language-selection-implementation.md).

describe("store language lists", () => {
  it("offers exactly the spec's primary languages as cards, keyed by locale code", () => {
    expect(PRIMARY_STORE_LANGUAGES.map((l) => l.code)).toEqual([
      "en",
      "fr",
      "de",
      "es",
      "it",
      "pt",
      "nl",
      "pl",
    ]);
    expect(PRIMARY_STORE_LANGUAGES.map((l) => l.label)).toEqual([
      "English",
      "French",
      "German",
      "Spanish",
      "Italian",
      "Portuguese",
      "Dutch",
      "Polish",
    ]);
  });

  it("has no duplicate codes across primary and other languages", () => {
    const codes = ALL_STORE_LANGUAGES.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("reaches 'other' languages such as Japanese by their real code, never a literal 'other'", () => {
    expect(OTHER_STORE_LANGUAGES.some((l) => l.code === "ja")).toBe(true);
    expect(isStoreLanguageCode("ja")).toBe(true);
    expect(isStoreLanguageCode("other")).toBe(false);
  });

  it("defaults to English", () => {
    expect(DEFAULT_STORE_LANGUAGE).toBe("en");
    expect(findStoreLanguage("en")?.label).toBe("English");
  });
});

describe("normalizeStoreLanguage", () => {
  it("accepts supported codes, trimming and lowercasing", () => {
    expect(normalizeStoreLanguage("de")).toBe("de");
    expect(normalizeStoreLanguage(" DE ")).toBe("de");
    expect(normalizeStoreLanguage("ja")).toBe("ja");
  });

  it("rejects unsupported values instead of guessing a language", () => {
    expect(normalizeStoreLanguage("other")).toBeNull();
    expect(normalizeStoreLanguage("German")).toBeNull();
    expect(normalizeStoreLanguage("xx")).toBeNull();
    expect(normalizeStoreLanguage("")).toBeNull();
    expect(normalizeStoreLanguage(null)).toBeNull();
    expect(normalizeStoreLanguage(42)).toBeNull();
  });
});

describe("languageInstruction", () => {
  it("names the selected language and its code as an explicit constraint", () => {
    const de = languageInstruction("de");
    expect(de).toContain("German (de)");
    expect(de).toContain("must be written in German");

    const fr = languageInstruction("fr");
    expect(fr).toContain("French (fr)");
  });

  it("covers 'other' languages with their actual identifier", () => {
    expect(languageInstruction("ja")).toContain("Japanese (ja)");
  });

  it("falls back to English when no language was selected", () => {
    expect(languageInstruction(undefined)).toContain("English (en)");
    expect(languageInstruction("")).toContain("English (en)");
  });

  it("degrades to the raw code for an unknown language rather than silently to English", () => {
    const unknown = languageInstruction("tlh");
    expect(unknown).toContain("(tlh)");
    expect(unknown).not.toContain("English (en)");
  });

  it("never asks the model to translate structure, only copy", () => {
    expect(languageInstruction("de")).toContain("never translate those");
  });
});
