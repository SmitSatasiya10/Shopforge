// Applies a freshly rendered page to the live preview document by patching only what actually
// changed, so an edit never costs an iframe reload. The render itself is always full and fresh
// (lib/preview/template-renderer.ts) — only its *application* to the DOM is surgical.
//
// Two kinds of change are handled here:
//   - a section's own markup changed (a setting edit) — morphed in place (lib/editor/dom-morph.ts);
//   - the sections themselves moved, appeared or disappeared (move / add / delete section) —
//     reconciled by `data-sf-section-id`, so a moved section is *relocated*, not rebuilt: its
//     <img>/<video> elements stay decoded and the page never blinks or jumps to the top.
// Anything else (the <head> or the non-section page skeleton changing) still falls back to a
// full remount, which is always correct, just visible.

import { morphChildren } from "@/lib/editor/dom-morph";

const SECTION_SELECTOR = "[data-sf-section-id]";
/** Stand-in for a whole run of sibling sections while comparing the page skeleton. */
const SLOT_TAG = "sf-section-slot";

function sectionId(el: Element): string {
  return el.getAttribute("data-sf-section-id") ?? "";
}

function isBlankText(node: Node): boolean {
  return node.nodeType === Node.TEXT_NODE && !(node.nodeValue ?? "").trim();
}

/** True when nothing but whitespace separates two siblings — i.e. they sit in the same run. */
function onlyWhitespaceBetween(prev: Node, next: Node): boolean {
  for (let node = prev.nextSibling; node && node !== next; node = node.nextSibling) {
    if (!isBlankText(node)) return false;
  }
  return true;
}

/** A maximal group of section elements that are whitespace-separated siblings of one parent. */
interface SectionRun {
  parent: Element;
  sections: HTMLElement[];
}

function sectionRuns(root: Document): SectionRun[] {
  const runs: SectionRun[] = [];
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(SECTION_SELECTOR))) {
    const parent = el.parentElement;
    if (!parent) continue;
    const run = runs[runs.length - 1];
    const prev = run?.sections[run.sections.length - 1];
    if (run && prev && run.parent === parent && onlyWhitespaceBetween(prev, el)) run.sections.push(el);
    else runs.push({ parent, sections: [el] });
  }
  return runs;
}

/** The editor injects its own style element into head; ignore it when comparing. */
function headWithoutEditorStyles(head: HTMLElement): string {
  const clone = head.cloneNode(true) as HTMLElement;
  clone.querySelector("#sf-editor-styles")?.remove();
  return clone.innerHTML;
}

/**
 * The page with every *run* of sections collapsed to a single placeholder. Collapsing runs
 * rather than keeping one placeholder per section is what makes reordering, adding and
 * deleting sections look identical here — those are exactly the changes reconcileRun handles.
 * Everything outside the runs must still match exactly for a patch to be safe.
 */
function skeleton(body: HTMLElement): string {
  const clone = body.cloneNode(true) as HTMLElement;
  const doc = clone.ownerDocument;
  clone.querySelectorAll(SECTION_SELECTOR).forEach((el) => el.replaceWith(doc.createElement(SLOT_TAG)));
  clone.querySelectorAll(SLOT_TAG).forEach((slot) => {
    for (let node = slot.nextSibling; node; ) {
      const mergeable = isBlankText(node) || (node.nodeType === Node.ELEMENT_NODE && (node as Element).localName === SLOT_TAG);
      if (!mergeable) break;
      const next = node.nextSibling;
      node.parentNode?.removeChild(node);
      node = next;
    }
  });
  return clone.innerHTML;
}

/**
 * Makes one run of live sections match the freshly rendered one, keyed on section id: sections
 * that survive are moved (never re-created) and morphed, sections that are gone are removed, and
 * new ones are imported. Minimal moves — an unchanged order performs no DOM mutation at all.
 */
function reconcileRun(doc: Document, live: SectionRun, next: SectionRun): void {
  const { parent } = live;
  const nextIds = new Set(next.sections.map(sectionId));
  // Both captured before any mutation: `end` bounds the run (inserting before it appends to the
  // run), `before` is the node the run starts after. Neither is ever moved or removed.
  const end = live.sections[live.sections.length - 1].nextSibling;
  const before = live.sections[0].previousSibling;

  const byId = new Map<string, HTMLElement>();
  for (const el of live.sections) {
    if (nextIds.has(sectionId(el))) byId.set(sectionId(el), el);
    else el.remove();
  }

  /** The next live section still awaiting placement, or the run's end marker. */
  const advance = (from: Node | null): Node | null => {
    for (let node = from; node && node !== end; node = node.nextSibling) {
      if (node.nodeType === Node.ELEMENT_NODE && byId.get(sectionId(node as Element)) === node) return node;
    }
    return end;
  };

  let cursor = advance(before ? before.nextSibling : parent.firstChild);
  for (const nextSection of next.sections) {
    const existing = byId.get(sectionId(nextSection));
    if (existing) {
      // Morph, don't replace: patching only the differing nodes keeps every unchanged element
      // alive — the wrapper (so its selection class and held references survive), and above all
      // the section's <img>/<video> elements, which would re-decode and visibly blink if the
      // whole innerHTML were rewritten for a one-setting change.
      if (existing.innerHTML !== nextSection.innerHTML) morphChildren(existing, nextSection);
      if (existing === cursor) {
        cursor = advance(cursor.nextSibling);
        continue;
      }
    }
    parent.insertBefore(existing ?? doc.importNode(nextSection, true), cursor);
  }
}

/**
 * Patches the live document to match `nextHtml`, leaving everything it doesn't have to touch —
 * above all the scroll position and already-loaded media — untouched. Returns false when the
 * change is one this can't do safely (the head or the page skeleton around the sections
 * changed), meaning the caller must remount the iframe instead.
 */
export function trySwapSections(doc: Document, nextHtml: string): boolean {
  const next = new DOMParser().parseFromString(nextHtml, "text/html");
  if (headWithoutEditorStyles(doc.head) !== headWithoutEditorStyles(next.head)) return false;
  if (skeleton(doc.body) !== skeleton(next.body)) return false;

  const liveRuns = sectionRuns(doc);
  const nextRuns = sectionRuns(next);
  // Guaranteed by the skeleton match above, but reconcileRun pairs runs positionally — never
  // patch on an assumption the comparison didn't actually establish.
  if (liveRuns.length !== nextRuns.length) return false;
  // Reconciliation is keyed on the section id, so a repeated id would silently drop a section.
  const hasDuplicateIds = (runs: SectionRun[]) => {
    const ids = runs.flatMap((run) => run.sections.map(sectionId));
    return new Set(ids).size !== ids.length;
  };
  if (hasDuplicateIds(liveRuns) || hasDuplicateIds(nextRuns)) return false;

  liveRuns.forEach((run, i) => reconcileRun(doc, run, nextRuns[i]));
  return true;
}
