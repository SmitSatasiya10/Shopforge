// Inserts speech-recognized text into a live contenteditable element at the current caret
// (docs/VOICE-DICTATION-PLAN.md §5) — the harder half of voice dictation, since a contenteditable
// field has no React-controlled `value` the way a textarea does; this manipulates the DOM
// Selection/Range API directly against whatever document the element lives in (the preview
// iframe's own document, not the app's). There is no jsdom in this repo, so unlike the rest of
// the feature this is verified by manual browser testing only, not a unit test.

export interface DictationInsertSession {
  /** The text node holding the current utterance's not-yet-finalized guess, if any. */
  interimNode: Text | null;
}

export function createDictationInsertSession(): DictationInsertSession {
  return { interimNode: null };
}

/**
 * Inserts `text` at the current selection inside `doc`. An interim result overwrites the
 * previous interim guess in place (same text node, `.data` reassigned) so a recognizer refining
 * "hello wor" into "hello world" never leaves "hello worhello world" behind — only the final
 * result of each utterance is meant to stick. A final result commits that node and clears the
 * session, so the next interim chunk (the next utterance, if the mic is held again) starts a
 * fresh node positioned after it, rather than overwriting already-finalized words.
 *
 * No-ops if `doc` has no live selection inside the field — this must only be called while the
 * target element is actually focused and contenteditable, which is the caller's responsibility.
 */
export function insertDictatedText(
  doc: Document,
  session: DictationInsertSession,
  text: string,
  isFinal: boolean,
): void {
  const sel = doc.getSelection();
  if (!sel) return;

  if (session.interimNode?.isConnected) {
    session.interimNode.data = text;
  } else {
    if (sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    session.interimNode = doc.createTextNode(text);
    range.insertNode(session.interimNode);
  }

  const caretRange = doc.createRange();
  caretRange.setStartAfter(session.interimNode);
  caretRange.collapse(true);
  sel.removeAllRanges();
  sel.addRange(caretRange);

  if (isFinal) session.interimNode = null;
}
