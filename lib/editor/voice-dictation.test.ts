import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVoiceDictation, getSpeechRecognitionCtor } from "./voice-dictation";

interface FakeResultAlternative {
  transcript: string;
}
interface FakeResult {
  isFinal: boolean;
  length: number;
  0: FakeResultAlternative;
}
interface FakeResultEvent {
  resultIndex: number;
  results: { length: number; [index: number]: FakeResult };
}

class MockRecognition {
  lang = "";
  continuous = false;
  interimResults = false;
  onresult: ((event: FakeResultEvent) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn(() => this.onend?.());
}

function fakeResultEvent(text: string, isFinal: boolean): FakeResultEvent {
  return {
    resultIndex: 0,
    results: { length: 1, 0: { isFinal, length: 1, 0: { transcript: text } } },
  };
}

describe("getSpeechRecognitionCtor", () => {
  afterEach(() => {
    // @ts-expect-error test-only global cleanup
    delete globalThis.window;
  });

  it("returns null when window is undefined (SSR)", () => {
    expect(getSpeechRecognitionCtor()).toBeNull();
  });

  it("returns null when neither global is defined (Firefox desktop)", () => {
    // @ts-expect-error minimal test window
    globalThis.window = {};
    expect(getSpeechRecognitionCtor()).toBeNull();
  });

  it("prefers the standard SpeechRecognition global over the webkit-prefixed one", () => {
    class Standard {}
    class Webkit {}
    // @ts-expect-error minimal test window
    globalThis.window = { SpeechRecognition: Standard, webkitSpeechRecognition: Webkit };
    expect(getSpeechRecognitionCtor()).toBe(Standard);
  });

  it("falls back to the webkit-prefixed global (Chrome/Safari today)", () => {
    class Webkit {}
    // @ts-expect-error minimal test window
    globalThis.window = { webkitSpeechRecognition: Webkit };
    expect(getSpeechRecognitionCtor()).toBe(Webkit);
  });
});

describe("createVoiceDictation", () => {
  let instances: MockRecognition[] = [];

  beforeEach(() => {
    instances = [];
    class Ctor extends MockRecognition {
      constructor() {
        super();
        instances.push(this);
      }
    }
    // @ts-expect-error minimal test window
    globalThis.window = { webkitSpeechRecognition: Ctor };
  });

  afterEach(() => {
    // @ts-expect-error test-only global cleanup
    delete globalThis.window;
  });

  it("is unsupported when no recognizer global exists, and start() is a safe no-op", () => {
    // @ts-expect-error minimal test window
    globalThis.window = {};
    const controller = createVoiceDictation("en-US", { onFinal: vi.fn() });
    expect(controller.supported).toBe(false);
    expect(() => controller.start()).not.toThrow();
  });

  it("start() constructs a recognizer with the requested language in continuous+interim mode", () => {
    const controller = createVoiceDictation("fr-FR", { onFinal: vi.fn() });
    controller.start();
    expect(instances).toHaveLength(1);
    expect(instances[0].lang).toBe("fr-FR");
    expect(instances[0].continuous).toBe(true);
    expect(instances[0].interimResults).toBe(true);
    expect(instances[0].start).toHaveBeenCalledOnce();
  });

  it("a second start() while already listening reuses the recognizer instead of creating another", () => {
    const controller = createVoiceDictation("en-US", { onFinal: vi.fn() });
    controller.start();
    controller.start();
    expect(instances).toHaveLength(1);
    expect(instances[0].start).toHaveBeenCalledOnce();
  });

  it("routes interim results to onInterim and final results to onFinal", () => {
    const onInterim = vi.fn();
    const onFinal = vi.fn();
    createVoiceDictation("en-US", { onInterim, onFinal }).start();
    const recognizer = instances[0];

    recognizer.onresult?.(fakeResultEvent("hello wor", false));
    expect(onInterim).toHaveBeenCalledWith("hello wor");
    expect(onFinal).not.toHaveBeenCalled();

    recognizer.onresult?.(fakeResultEvent("hello world", true));
    expect(onFinal).toHaveBeenCalledWith("hello world");
  });

  it("calls onListeningChange(true) on start and (false) once the recognizer ends", () => {
    const onListeningChange = vi.fn();
    createVoiceDictation("en-US", { onFinal: vi.fn(), onListeningChange }).start();
    expect(onListeningChange).toHaveBeenCalledWith(true);
    instances[0].onend?.();
    expect(onListeningChange).toHaveBeenCalledWith(false);
  });

  it("after ending, a new start() creates a fresh recognizer (not stuck 'already listening')", () => {
    const controller = createVoiceDictation("en-US", { onFinal: vi.fn() });
    controller.start();
    instances[0].onend?.();
    controller.start();
    expect(instances).toHaveLength(2);
  });

  it("maps not-allowed / service-not-allowed / no-speech / network / unknown error codes", () => {
    const onError = vi.fn();
    createVoiceDictation("en-US", { onFinal: vi.fn(), onError }).start();
    const recognizer = instances[0];

    recognizer.onerror?.({ error: "not-allowed" });
    recognizer.onerror?.({ error: "service-not-allowed" });
    recognizer.onerror?.({ error: "no-speech" });
    recognizer.onerror?.({ error: "network" });
    recognizer.onerror?.({ error: "aborted" });

    expect(onError.mock.calls.map((call) => call[0])).toEqual([
      "not-allowed",
      "not-allowed",
      "no-speech",
      "network",
      "other",
    ]);
  });

  it("stop() calls the underlying recognizer's stop()", () => {
    const controller = createVoiceDictation("en-US", { onFinal: vi.fn() });
    controller.start();
    controller.stop();
    expect(instances[0].stop).toHaveBeenCalledOnce();
  });

  it("stop() before any start() is a safe no-op", () => {
    const controller = createVoiceDictation("en-US", { onFinal: vi.fn() });
    expect(() => controller.stop()).not.toThrow();
  });
});
