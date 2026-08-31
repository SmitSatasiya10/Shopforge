"use client";

import { useEffect, useRef, useState } from "react";
import { Mic } from "lucide-react";
import { useVoiceDictation, type UseVoiceDictationOptions } from "@/lib/editor/use-voice-dictation";
import type { VoiceDictationErrorCode } from "@/lib/editor/voice-dictation";

// A native title tooltip only reaches a mouse user who happens to hover first, and never a
// touch user at all — neither "hold, don't tap" nor "that didn't work" otherwise has any
// on-screen signal. Both get a brief on-screen correction exactly when they're needed, instead
// of a permanent label everyone else has to ignore.
const TAP_THRESHOLD_MS = 350;
const HINT_VISIBLE_MS = 2200;

interface VoiceDictationButtonProps extends UseVoiceDictationOptions {
  /** Overrides the button's default chrome — lets each host (AiRewritePopover's rounded white
   * pill vs. InlineTextToolbar's dark toolbar pill) match its own surrounding buttons exactly. */
  className?: string;
  title?: string;
  /**
   * Fired synchronously on pointerdown, before recognition actually starts — the host's only
   * reliable place to snapshot "the field's text right before this hold" for append semantics
   * (docs/VOICE-DICTATION-PLAN.md §3). Deliberately not derived from `listening` via an effect:
   * an effect keyed on a fresh callback prop would re-fire on every parent re-render a dictation
   * update itself causes, re-snapshotting mid-utterance and duplicating text.
   */
  onHoldStart?: () => void;
}

function errorMessage(code: VoiceDictationErrorCode): string {
  switch (code) {
    case "not-allowed":
      return "Microphone access denied";
    case "no-speech":
      return "Didn't catch any speech";
    case "network":
      return "Dictation network error";
    default:
      return "Dictation error";
  }
}

/**
 * Hold-to-talk mic button (docs/VOICE-DICTATION-PLAN.md §3): press and hold to dictate, release
 * to stop. Renders nothing on a browser with no speech recognizer (Firefox desktop, pre-14.5
 * Safari) instead of a disabled/dead control — see §6, "no support isn't broken UI."
 */
export function VoiceDictationButton({ className, title, onHoldStart, lang, onInterim, onFinal }: VoiceDictationButtonProps) {
  const [hint, setHint] = useState<string | null>(null);
  const holdStartedAtRef = useRef(0);
  // Whether any interim/final result arrived during the current hold — read once the hold ends
  // (see the effect below) to tell "held it, nothing recognized" (e.g. spoke too quietly) apart
  // from a normal successful dictation.
  const gotResultRef = useRef(false);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks the *previous* render's `listening` value so the end-of-hold effect below only fires
  // on a real true -> false transition, never on mount (where listening starts false).
  const wasListeningRef = useRef(false);

  const { supported, listening, error, start, stop } = useVoiceDictation({
    lang,
    onInterim: (text) => {
      gotResultRef.current = true;
      onInterim?.(text);
    },
    onFinal: (text) => {
      gotResultRef.current = true;
      onFinal(text);
    },
  });

  const flashHint = (text: string) => {
    setHint(text);
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    hintTimerRef.current = setTimeout(() => setHint(null), HINT_VISIBLE_MS);
  };

  // Runs once the recognizer session truly ends — `listening` only flips to false after any
  // trailing final result for already-captured audio has already been delivered (the browser's
  // own onend fires after onresult), so `gotResultRef` is never checked prematurely here.
  useEffect(() => {
    if (wasListeningRef.current && !listening) {
      const heldMs = Date.now() - holdStartedAtRef.current;
      if (heldMs < TAP_THRESHOLD_MS) {
        flashHint("Hold & speak");
      } else if (!gotResultRef.current) {
        flashHint(error ? errorMessage(error) : "Didn't catch that — try again");
      }
    }
    wasListeningRef.current = listening;
  }, [listening, error]);

  if (!supported) return null;

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        // preventDefault keeps focus (and any text selection/caret) on whatever field is being
        // dictated into — the mic button must never steal focus, since InlineTextToolbar's
        // eventual contenteditable target depends on its selection staying exactly where it was.
        onPointerDown={(e) => {
          e.preventDefault();
          holdStartedAtRef.current = Date.now();
          gotResultRef.current = false;
          setHint(null);
          onHoldStart?.();
          start();
        }}
        onPointerUp={stop}
        onPointerLeave={stop}
        onPointerCancel={stop}
        title={error ? errorMessage(error) : (title ?? (listening ? "Listening… release to stop" : "Hold to dictate"))}
        aria-label={listening ? "Listening… release to stop" : "Hold to dictate"}
        aria-pressed={listening}
        className={
          className ??
          `grid h-7 w-7 shrink-0 place-items-center rounded-full transition ${
            listening ? "bg-red-500 text-white animate-pulse" : "bg-neutral-700 text-white hover:bg-neutral-600"
          }`
        }
        style={{ touchAction: "none" }}
      >
        <Mic className="h-4 w-4" strokeWidth={listening ? 2 : 1.75} />
      </button>
      {hint ? (
        <span className="pointer-events-none absolute -top-8 left-1/2 z-30 -translate-x-1/2 whitespace-nowrap rounded-md bg-neutral-800 px-2 py-1 text-[11px] font-medium text-white shadow-lg ring-1 ring-white/10">
          {hint}
        </span>
      ) : null}
    </span>
  );
}
