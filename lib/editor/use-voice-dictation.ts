"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  createVoiceDictation,
  getSpeechRecognitionCtor,
  type VoiceDictationController,
  type VoiceDictationErrorCode,
} from "./voice-dictation";

// Speech-recognition support never changes over a page's lifetime, so there is nothing to
// subscribe to — this store only exists to give useSyncExternalStore a server/client snapshot
// pair. That's what actually keeps server-rendered HTML in agreement with the client's first
// paint; a plain useState+useEffect flip would briefly disagree with the server-rendered markup
// (SSR always sees no `window`) before the effect runs.
function subscribe() {
  return () => {};
}
function getClientSnapshot() {
  return getSpeechRecognitionCtor() !== null;
}
function getServerSnapshot() {
  return false;
}

export interface UseVoiceDictationOptions {
  /** BCP-47 locale to bias recognition toward — see lib/store-config/dictation-locale.ts. */
  lang: string;
  /** Called live as the recognizer refines an in-progress utterance. */
  onInterim?: (text: string) => void;
  /** Called once an utterance is finalized — this is the text callers should actually keep. */
  onFinal: (text: string) => void;
}

export interface UseVoiceDictationResult {
  /** False on first render (SSR-safe) and on a browser with no speech recognizer at all. */
  supported: boolean;
  listening: boolean;
  error: VoiceDictationErrorCode | null;
  start: () => void;
  stop: () => void;
}

/**
 * Hold-to-talk dictation for one field (docs/VOICE-DICTATION-PLAN.md §3/§5). This hook owns only
 * the recognizer lifecycle and listening/error UI state — it never writes into a field itself, so
 * the same hook drives both a controlled textarea (AiRewritePopover) and a contenteditable DOM
 * node (InlineTextToolbar) purely through each caller's own onInterim/onFinal.
 *
 * `supported` is read via useSyncExternalStore rather than computed during render, so
 * server-rendered HTML never disagrees with the client's first paint (SpeechRecognition support
 * can only be feature-detected in the browser).
 */
export function useVoiceDictation({ lang, onInterim, onFinal }: UseVoiceDictationOptions): UseVoiceDictationResult {
  const supported = useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<VoiceDictationErrorCode | null>(null);
  const controllerRef = useRef<VoiceDictationController | null>(null);
  // Read through a ref so the recognizer is only recreated when `lang` actually changes, not on
  // every render a parent re-passes fresh onInterim/onFinal closures. Refs may only be written
  // outside of render, so the assignment itself lives in its own effect below.
  const callbacksRef = useRef({ onInterim, onFinal });
  useEffect(() => {
    callbacksRef.current = { onInterim, onFinal };
  });

  useEffect(() => {
    const controller = createVoiceDictation(lang, {
      onInterim: (text) => callbacksRef.current.onInterim?.(text),
      onFinal: (text) => callbacksRef.current.onFinal(text),
      onError: setError,
      onListeningChange: setListening,
    });
    controllerRef.current = controller;
    // Never leave the recognizer running against a field that's no longer mounted/visible
    // (docs/VOICE-DICTATION-PLAN.md §6, "navigates away mid-hold").
    return () => controller.stop();
  }, [lang]);

  return {
    supported,
    listening,
    error,
    start: () => {
      setError(null);
      controllerRef.current?.start();
    },
    stop: () => controllerRef.current?.stop(),
  };
}
