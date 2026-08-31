// Thin, framework-agnostic wrapper around the browser's SpeechRecognition API (docs/
// VOICE-DICTATION-PLAN.md §5). Deliberately has no React dependency so the recognizer lifecycle
// and error-mapping logic can be unit tested with a mock recognizer the same way every other
// lib/editor/*.ts module is tested — this repo has no jsdom/React-testing-library setup, so
// anything that needs a real DOM or component render to test lives outside this file.

export type VoiceDictationErrorCode = "not-allowed" | "no-speech" | "network" | "other";

export interface VoiceDictationCallbacks {
  /** Called with each non-final chunk as the recognizer refines an in-progress utterance. */
  onInterim?: (text: string) => void;
  /** Called once a chunk is finalized — this is the text callers should actually keep. */
  onFinal: (text: string) => void;
  onError?: (code: VoiceDictationErrorCode) => void;
  onListeningChange?: (listening: boolean) => void;
}

export interface VoiceDictationController {
  /** False when this browser has no speech recognizer at all (Firefox desktop, old Safari). */
  readonly supported: boolean;
  start(): void;
  stop(): void;
}

// The Web Speech API isn't part of TypeScript's "dom" lib (it's still non-standard), so these
// are the minimal shapes this module actually reads/writes, not a full spec typing.
interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionResultListLike {
  length: number;
  [index: number]: SpeechRecognitionResultLike;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: SpeechRecognitionResultListLike;
}
interface SpeechRecognitionErrorEventLike {
  error: string;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  }
}

/**
 * Feature-detects the browser's speech recognizer. Null on the server (SSR) and on unsupported
 * browsers — notably Firefox desktop, which ships neither global at all (docs/
 * VOICE-DICTATION-PLAN.md §6).
 */
export function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

function mapError(rawError: string): VoiceDictationErrorCode {
  if (rawError === "not-allowed" || rawError === "service-not-allowed") return "not-allowed";
  if (rawError === "no-speech") return "no-speech";
  if (rawError === "network") return "network";
  return "other";
}

/**
 * Creates a hold-to-talk controller for one field: start()/stop() map directly onto
 * pointerdown/pointerup (docs/VOICE-DICTATION-PLAN.md §3). An unsupported browser gets a no-op
 * controller (`supported: false`) rather than a throw, so callers can render nothing instead of
 * a button that would silently fail on press.
 */
export function createVoiceDictation(
  lang: string,
  callbacks: VoiceDictationCallbacks,
): VoiceDictationController {
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) {
    return { supported: false, start() {}, stop() {} };
  }

  let recognition: SpeechRecognitionLike | null = null;

  const start = () => {
    // A hold that's already listening (e.g. a duplicate pointerdown) reuses the in-flight
    // recognizer rather than starting a second one.
    if (recognition) return;

    const instance = new Ctor();
    instance.lang = lang;
    instance.continuous = true;
    instance.interimResults = true;

    instance.onresult = (event) => {
      let interim = "";
      let final = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) final += text;
        else interim += text;
      }
      if (interim) callbacks.onInterim?.(interim);
      if (final) callbacks.onFinal(final);
    };
    instance.onerror = (event) => callbacks.onError?.(mapError(event.error));
    instance.onend = () => {
      recognition = null;
      callbacks.onListeningChange?.(false);
    };

    recognition = instance;
    instance.start();
    callbacks.onListeningChange?.(true);
  };

  const stop = () => {
    recognition?.stop();
  };

  return { supported: true, start, stop };
}
