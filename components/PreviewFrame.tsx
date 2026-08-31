"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { morphChildren } from "@/lib/editor/dom-morph";
import { createDictationInsertSession, insertDictatedText as applyDictatedTextInsert } from "@/lib/editor/dictation-insert";
import type { TextBinding } from "@/lib/editor/setting-locator";

/** Viewport-relative box of the selected element — the iframe fills its container, so these map 1:1 onto the overlay. */
export interface SelectionRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface SelectInfo {
  sectionId: string;
  sectionType: string | null;
  settingId: string | null;
  editable: string | null;
  /** Set when the click resolved to a text setting (docs/EDITOR-TOOLBARS.md). */
  binding: TextBinding | null;
  /**
   * Block ids from the section down to the clicked block, set when the click landed inside a
   * block (via its `data-shopify-editor-block` marker) but didn't resolve to a single text
   * setting — e.g. an image, icon or non-text area of the block. Null when `binding` is set
   * (field scope) or the click landed on the section but no block (section scope). Never set
   * together with `binding`: a resolved field always takes precedence.
   */
  blockScope: string[] | null;
  /** Box of the clicked text element (binding set), block (blockScope set), or the section itself. */
  rect: SelectionRect | null;
}

interface PreviewFrameProps {
  html: string;
  selectedSectionId: string | null;
  onSelect: (info: SelectInfo) => void;
  onTextCommit: (sectionId: string, binding: TextBinding, value: string) => void;
  /**
   * Synchronously names the setting a piece of rendered text belongs to, or null when it is
   * theme copy / ambiguous. Lives in the editor because only it holds the template JSON.
   */
  resolveText: (sectionId: string, text: string) => TextBinding | null;
  /** Fired when the selected element's box moves (iframe scroll/resize, re-render), so toolbars track it. */
  onRectChange: (rect: SelectionRect | null) => void;
  /**
   * Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z (or Ctrl+Y) inside the preview. A keydown fired while the
   * iframe holds focus (i.e. after any click inside it — the normal case, since selecting a
   * section or text focuses the iframe's browsing context) targets the iframe's own document
   * and never bubbles to the outer page, so the editor's own window-level shortcut handler
   * can't see it. This is the same shortcut, listened for from inside instead.
   */
  onUndo: () => void;
  onRedo: () => void;
  /**
   * Changing this value (e.g. the Homepage/Product Page tab) means the next `html` is a
   * different logical page, not a re-render of the same one — the viewport should land at the
   * top instead of carrying over the outgoing page's raw scroll offset, which otherwise can
   * land below the fold (even off the end) of a shorter page and hide its header.
   */
  resetScrollKey?: string | number;
}

export interface PreviewFrameHandle {
  /**
   * Inserts speech-recognized text into the field currently being inline-edited, at its live
   * caret (docs/VOICE-DICTATION-PLAN.md §5/§9) — a no-op if nothing is actively contenteditable
   * right now (the mic is only shown while a text field is selected, but the field can lose its
   * live edit state — e.g. the user tabbed away — between renders).
   */
  insertDictatedText(text: string, isFinal: boolean): void;
}

/**
 * Editor affordances injected into the preview document: the selected section's outline,
 * a dashed hover outline on any text the editor can bind to a setting (so "this is
 * editable" is visible before clicking), and the active inline-edit outline. `.sf-field-selected`
 * shares the contenteditable outline's look but survives the element losing focus — blurring
 * to type into the Rewrite popover, or the popover simply being open — so the field that a
 * rewrite will land on stays visibly marked the whole time, not just while it's mid-edit.
 *
 * `user-select: none` on the body: a click that drags even slightly (easy to do when the
 * intent is "select this paragraph to edit it") makes the browser highlight a native text
 * selection instead — that consumes the gesture, so no `click` reaches `handleClick` and the
 * editor looks like it silently ignored the click. Disabling native selection outside an
 * actively-editing element turns that same drag back into a plain click.
 */
const EDITOR_STYLES = `
  body { -webkit-user-select: none; user-select: none; }
  [contenteditable="true"] { -webkit-user-select: text; user-select: text; }
  [data-sf-section-id].sf-selected { outline: 3px solid #22c55e; outline-offset: -3px; box-shadow: inset 0 0 0 3px rgba(34, 197, 94, 0.25), 0 0 0 1px rgba(34, 197, 94, 0.35); }
  [data-sf-section-id]:hover:not(.sf-selected) { outline: 2px dashed rgba(34, 197, 94, 0.55); outline-offset: -2px; }
  .sf-text-hover { outline: 1.5px dashed #22c55e; outline-offset: max(3px, 0.25em); cursor: text; border-radius: 2px; background-color: rgba(34, 197, 94, 0.12); box-shadow: 0 0 0 max(3px, 0.25em) rgba(34, 197, 94, 0.12); }
  [contenteditable="true"], .sf-field-selected { outline: 2px solid #22c55e !important; outline-offset: max(3px, 0.25em); cursor: text; border-radius: 2px; background-color: rgba(34, 197, 94, 0.14) !important; box-shadow: 0 0 0 max(3px, 0.25em) rgba(34, 197, 94, 0.14) !important; }
`;

/**
 * `getBoundingClientRect()` on an element inside the iframe is relative to the iframe's own
 * viewport, not the outer page, so it needs the iframe's own offset folded back in — but the
 * toolbars/popover this feeds are `position: absolute` inside PreviewFrame's own container
 * (`previewRef` in the editor page), not the browser viewport, so that offset must be relative
 * to THAT container, not the viewport. `iframe.offsetTop`/`offsetLeft` are exactly that (the
 * iframe's position relative to its nearest positioned ancestor, which is that same container
 * — the wrapper div between them has no `position` of its own) — unlike
 * `iframe.getBoundingClientRect()`, which is viewport-relative and would double-count however
 * far the container itself sits below the viewport top (the app's header), pushing every
 * floating toolbar and the rewrite popover down by exactly that much. Still correct when the
 * iframe is narrower than its container (the mobile preview) and centered with gutters on
 * either side, since offsetLeft reflects that centering too.
 */
/** The iframe's offset within PreviewFrame's own container — see the comment on `toRect` above. */
function iframeOffset(iframe: HTMLIFrameElement | null | undefined): SelectionRect | null {
  return iframe ? { top: iframe.offsetTop, left: iframe.offsetLeft, width: iframe.offsetWidth, height: iframe.offsetHeight } : null;
}

function toRect(el: Element, frame?: SelectionRect | null): SelectionRect {
  const r = el.getBoundingClientRect();
  return {
    top: r.top + (frame?.top ?? 0),
    left: r.left + (frame?.left ?? 0),
    width: r.width,
    height: r.height,
  };
}

/** The deepest ancestor-chain element that directly owns text — what a text click/hover "means". */
function textElementAt(start: HTMLElement, boundary: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = start;
  while (node && node !== boundary) {
    const ownText = Array.from(node.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent ?? "")
      .join("")
      .trim();
    if (ownText || (node.childElementCount === 0 && node.textContent?.trim())) return node;
    node = node.parentElement;
  }
  return null;
}

/** Deepest element under `root` whose full text equals `text` — used to re-anchor after a re-render. */
function findByText(root: HTMLElement, text: string): HTMLElement | null {
  const matches = Array.from(root.querySelectorAll<HTMLElement>("*")).filter(
    (el) => (el.textContent ?? "").trim() === text,
  );
  return matches.filter((el) => !matches.some((other) => other !== el && el.contains(other))).pop() ?? null;
}

/**
 * Applies a freshly rendered page to the live document by swapping only the sections whose
 * markup changed, leaving everything else — above all the scroll position — untouched.
 * Returns false when the change is structural (sections added/removed/reordered, or the
 * head/layout changed), which needs a full reload instead. This is what keeps an inline
 * edit from "blinking and jumping to the top": the render is still always produced fresh
 * from the template JSON; only its *application* to the DOM is surgical.
 */
function trySwapSections(doc: Document, nextHtml: string): boolean {
  const next = new DOMParser().parseFromString(nextHtml, "text/html");
  const currentSections = Array.from(doc.querySelectorAll<HTMLElement>("[data-sf-section-id]"));
  const nextSections = Array.from(next.querySelectorAll<HTMLElement>("[data-sf-section-id]"));

  const ids = (els: HTMLElement[]) => els.map((el) => el.getAttribute("data-sf-section-id")).join("|");
  if (ids(currentSections) !== ids(nextSections)) return false;
  // The editor injects its own style element into head; ignore it when comparing.
  const headWithoutEditorStyles = (head: HTMLElement) => {
    const clone = head.cloneNode(true) as HTMLElement;
    clone.querySelector("#sf-editor-styles")?.remove();
    return clone.innerHTML;
  };
  if (headWithoutEditorStyles(doc.head) !== headWithoutEditorStyles(next.head)) return false;

  // Everything outside section bodies must be identical for a swap to be safe.
  const skeleton = (body: HTMLElement) => {
    const clone = body.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("[data-sf-section-id]").forEach((el) => {
      el.innerHTML = "";
      el.removeAttribute("class");
    });
    return clone.innerHTML;
  };
  if (skeleton(doc.body) !== skeleton(next.body)) return false;

  nextSections.forEach((section, i) => {
    if (currentSections[i].innerHTML !== section.innerHTML) {
      // Morph, don't replace: patching only the differing nodes keeps every unchanged
      // element alive — the wrapper (so its selection class and held references survive),
      // and above all the section's <img>/<video> elements, which would re-decode and
      // visibly blink if the whole innerHTML were rewritten for a one-setting change.
      morphChildren(currentSections[i], section);
    }
  });
  return true;
}

interface Tracked {
  el: HTMLElement;
  /** The bound text at selection time, used to re-find the element after its section re-renders. */
  text: string | null;
}

/**
 * Same-origin sandboxed preview iframe (docs/product-spec/08-preview-iframe.md,
 * prototype-phase-plan.md §3 — binding decision). `sandbox="allow-same-origin"` only,
 * set once, never mutated, never `allow-scripts`. React reaches directly into
 * `contentDocument` for click-to-select, hover affordances and inline text editing —
 * no postMessage, because same-origin gives direct DOM access without it.
 */
export const PreviewFrame = forwardRef<PreviewFrameHandle, PreviewFrameProps>(function PreviewFrame(
  {
    html,
    selectedSectionId,
    onSelect,
    onTextCommit,
    resolveText,
    onRectChange,
    onUndo,
    onRedo,
    resetScrollKey,
  },
  ref,
) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const trackedRef = useRef<Tracked | null>(null);
  // Voice dictation's insert-in-place state (docs/VOICE-DICTATION-PLAN.md §5) — keyed to
  // whichever element it was last used on, so switching fields between two mic holds starts a
  // fresh session instead of resuming a leftover interim node in the field just left behind.
  const dictationSessionRef = useRef(createDictationInsertSession());
  const dictationElRef = useRef<HTMLElement | null>(null);

  useImperativeHandle(ref, () => ({
    insertDictatedText(text, isFinal) {
      const el = trackedRef.current?.el ?? null;
      if (!el || !el.isContentEditable) return;
      if (dictationElRef.current !== el) {
        dictationSessionRef.current = createDictationInsertSession();
        dictationElRef.current = el;
      }
      el.focus();
      applyDictatedTextInsert(el.ownerDocument, dictationSessionRef.current, text, isFinal);
    },
  }), []);
  // The document loaded for mount key N; a bumped key remounts the iframe (full reload).
  // Starts with empty html — the iframe renders once real markup arrives.
  const [mount, setMount] = useState<{ key: number; html: string }>({ key: 0, html: "" });
  const loadedKeyRef = useRef(-1);
  const pendingScrollRef = useRef(0);
  const resetScrollKeyRef = useRef(resetScrollKey);
  /** The html currently reflected in the live document (srcDoc is not re-read for swaps). */
  const appliedHtmlRef = useRef("");

  const resolveTextRef = useRef(resolveText);
  const onRectChangeRef = useRef(onRectChange);
  const selectedRef = useRef(selectedSectionId);
  const onUndoRef = useRef(onUndo);
  const onRedoRef = useRef(onRedo);
  // Latest-prop refs, synced after render so the load-time listeners never go stale.
  useEffect(() => {
    resolveTextRef.current = resolveText;
    onRectChangeRef.current = onRectChange;
    selectedRef.current = selectedSectionId;
    onUndoRef.current = onUndo;
    onRedoRef.current = onRedo;
  });

  /** Re-points the toolbars at the (possibly re-created) selected element and reports its box. */
  const reanchor = useCallback((doc: Document) => {
    const frame = iframeOffset(iframeRef.current);
    const tracked = trackedRef.current;
    if (tracked && doc.contains(tracked.el)) {
      onRectChangeRef.current(toRect(tracked.el, frame));
      return;
    }
    const id = selectedRef.current;
    const section = id
      ? (doc.querySelector(`[data-sf-section-id="${id}"]`) as HTMLElement | null)
      : null;
    if (!section) {
      trackedRef.current = null;
      onRectChangeRef.current(null);
      return;
    }
    const el = (tracked?.text ? findByText(section, tracked.text) : null) ?? section;
    trackedRef.current = { el, text: el === section ? null : (tracked?.text ?? null) };
    onRectChangeRef.current(toRect(el, frame));
  }, []);

  // Apply html updates: in-place section swap when possible, full remount when structural
  // (the very first html lands through the remount path too — there is no document yet).
  useEffect(() => {
    if (!html || appliedHtmlRef.current === html) return;
    appliedHtmlRef.current = html;
    const doc = iframeRef.current?.contentDocument;
    if (doc && loadedKeyRef.current === mount.key && trySwapSections(doc, html)) {
      reanchor(doc);
      return;
    }
    const pageChanged = resetScrollKeyRef.current !== resetScrollKey;
    resetScrollKeyRef.current = resetScrollKey;
    pendingScrollRef.current = pageChanged ? 0 : (iframeRef.current?.contentWindow?.scrollY ?? 0);
    setMount((prev) => ({ key: prev.key + 1, html }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, resetScrollKey]);

  const handleLoad = useCallback(() => {
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!iframe || !doc) return;
    loadedKeyRef.current = Number(iframe.dataset.mountKey ?? 0);
    trackedRef.current = null;

    if (!doc.getElementById("sf-editor-styles")) {
      const style = doc.createElement("style");
      style.id = "sf-editor-styles";
      style.textContent = EDITOR_STYLES;
      doc.head.appendChild(style);
    }

    const enableInlineEdit = (node: HTMLElement, sectionId: string, binding: TextBinding) => {
      node.classList.remove("sf-text-hover");
      node.setAttribute("contenteditable", "true");
      node.focus();
      const initial = node.textContent?.trim() ?? "";
      const commit = () => {
        node.removeAttribute("contenteditable");
        node.removeEventListener("blur", commit);
        const value = node.textContent?.trim() ?? "";
        if (value === initial) return; // nothing typed — no template write, no re-render
        // Remember the new text so the toolbar can re-find this element after the re-render.
        if (trackedRef.current?.el === node) trackedRef.current = { el: node, text: value };
        onTextCommit(sectionId, binding, value);
      };
      node.addEventListener("blur", commit);
    };

    // The currently selected field or block's outline — the same mark either way, since both
    // are "the one thing a rewrite from here will touch." Kept separate from
    // `[contenteditable="true"]` (which the browser only honors while the element is actually
    // focused) so it survives losing focus to the Rewrite popover instead of disappearing the
    // moment it opens, and applied to the whole block wrapper (not a single line) when the
    // click resolved to block scope, so multi-line block content gets the same visible
    // selection a single bindable text field already does.
    let fieldSelectedEl: HTMLElement | null = null;
    const setFieldSelected = (el: HTMLElement | null) => {
      if (fieldSelectedEl === el) return;
      fieldSelectedEl?.classList.remove("sf-field-selected");
      el?.classList.add("sf-field-selected");
      fieldSelectedEl = el;
    };

    // Hover affordance: outline any text the editor could bind, so "this is editable" is
    // visible before the first click. Resolution results are memoised per element.
    const bindableCache = new WeakMap<HTMLElement, boolean>();
    let hovered: HTMLElement | null = null;
    const bindableTextAt = (target: HTMLElement, sectionEl: HTMLElement): HTMLElement | null => {
      const textEl = textElementAt(target, sectionEl);
      const text = textEl?.textContent?.trim();
      if (!textEl || !text) return null;
      let ok = bindableCache.get(textEl);
      if (ok === undefined) {
        ok = resolveTextRef.current(sectionEl.getAttribute("data-sf-section-id")!, text) !== null;
        bindableCache.set(textEl, ok);
      }
      return ok ? textEl : null;
    };
    const handleOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const sectionEl = target.closest?.("[data-sf-section-id]") as HTMLElement | null;
      const next = sectionEl ? bindableTextAt(target, sectionEl) : null;
      if (next !== hovered) {
        hovered?.classList.remove("sf-text-hover");
        if (next && !next.isContentEditable) next.classList.add("sf-text-hover");
        hovered = next;
      }
    };

    // Product media gallery thumbnails: theme markup for real Shopify themes, driven entirely
    // by media-gallery.js (customElements.define). The preview iframe never runs theme scripts
    // (sandbox has no allow-scripts — see the class doc comment above), so that custom element
    // never registers and clicking a thumbnail does nothing. Reproduce just enough of its
    // setActiveMedia/setActiveThumbnail behavior to make clicks work in the preview:
    //  - "thumbnail" layout: base.css hides every slide that isn't .is-active, so swapping the
    //    class is enough.
    //  - "thumbnail_slider" layout: every slide is display:block side by side in a scrolling
    //    strip and .is-active doesn't affect visibility at all — the real JS instead scrolls
    //    the strip so the target slide is the one in view.
    // Both cases are handled here so it works regardless of which layout a section is set to.
    const handleGalleryThumbnailClick = (e: MouseEvent) => {
      const item = (e.target as HTMLElement).closest("[data-target]") as HTMLElement | null;
      const gallery = item?.closest("media-gallery");
      const mediaId = item?.getAttribute("data-target");
      if (!item || !gallery || !mediaId) return;
      const viewer = gallery.querySelector('[id^="GalleryViewer"]');
      const activeMedia = Array.from(viewer?.querySelectorAll<HTMLElement>("[data-media-id]") ?? []).find(
        (el) => el.getAttribute("data-media-id") === mediaId,
      );
      if (!activeMedia) return;
      viewer?.querySelectorAll("[data-media-id]").forEach((el) => el.classList.remove("is-active"));
      activeMedia.classList.add("is-active");
      activeMedia.parentElement?.scrollTo({ left: activeMedia.offsetLeft, behavior: "smooth" });
      gallery.querySelector('[id^="GalleryThumbnails"]')
        ?.querySelectorAll("button")
        .forEach((btn) => btn.removeAttribute("aria-current"));
      item.querySelector("button")?.setAttribute("aria-current", "true");
    };

    // The preview is a same-origin srcDoc iframe with no <base> tag, so the theme's own
    // root-relative hrefs ("/", "/collections/all", ...) resolve against the *app's* URL, not a
    // real storefront. Left alone, clicking "Home" navigates the iframe to the app's own "/"
    // route. Block it in the capture phase, before section/text-selection handling runs, so
    // link clicks still select their section but never leave the preview.
    const handleLinkNavigation = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest("a")) e.preventDefault();
    };

    // Header search, nav dropdowns, the mobile menu drawer, and the share-button fallback are
    // all native <details>/<summary> disclosures — unlike media-gallery-style widgets, toggling
    // them needs no JS at all, so they *do* open here even though the preview iframe never runs
    // theme scripts. That's worse than not opening: the theme's <head> normally strips a
    // `no-js` class off <html> in an inline script that also never runs here, so `.no-js
    // .predictive-search { display: none }` (base.css) hides the search modal's actual input
    // while its close button stays visible — the merchant gets a full-screen modal that's just
    // a stray close icon on a gradient, with no JS left to close it either. Block the toggle at
    // the source, the same way link navigation is blocked above, so clicking a search/menu icon
    // in the preview does nothing rather than opening a modal it can't render or dismiss.
    const handleDetailsToggle = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest("summary")) e.preventDefault();
    };

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;

      // A data-sf-setting ancestor takes priority regardless of how deep the click landed
      // inside it (e.g. an <img> nested in a wrapper span that carries the marker, used for
      // image_picker settings rendered via a filter that can't take a custom attribute) — find
      // the NEAREST one first, rather than only checking the exact clicked node.
      const settingNode = target?.closest("[data-sf-setting]") as HTMLElement | null;
      const settingSectionEl = settingNode?.closest("[data-sf-section-id]") as HTMLElement | null;
      if (settingNode && settingSectionEl) {
        const sectionId = settingSectionEl.getAttribute("data-sf-section-id")!;
        const settingId = settingNode.getAttribute("data-sf-setting")!;
        const editable = settingNode.getAttribute("data-sf-editable");
        const binding: TextBinding = { blockPath: [], settingId };
        // The setting node may live inside a block's own markup (e.g. a hotspot's
        // block.settings.image) — walk up to the nearest data-shopify-editor-block ancestor,
        // same as the fallback branch below, so an image click carries its block path instead
        // of always being (wrongly) written to the section's own settings.
        const settingBlockEl = settingNode.closest("[data-shopify-editor-block]") as HTMLElement | null;
        const settingBlockPath: string[] = [];
        if (settingBlockEl && settingSectionEl.contains(settingBlockEl)) {
          let n: HTMLElement | null = settingBlockEl;
          while (n && n !== settingSectionEl) {
            const id = n.getAttribute("data-shopify-editor-block");
            if (id) settingBlockPath.unshift(id);
            n = n.parentElement;
          }
        }
        // The marker element itself may not be the visible one (e.g. a display:contents
        // wrapper around an image_tag filter's output) — track/highlight/position off the
        // actual clicked element instead, so the rect isn't a zero-size wrapper box.
        trackedRef.current = { el: target!, text: target!.textContent?.trim() ?? null };
        setFieldSelected(target);
        onSelect({
          sectionId,
          sectionType: settingSectionEl.getAttribute("data-sf-section-type"),
          settingId,
          editable,
          // An image setting isn't a text binding — keeping it null here stops the inline
          // text toolbar from popping up for an image click (it renders on binding alone).
          binding: editable === "image" ? null : binding,
          // Only carried for image settings — text keeps the section-root scope it always had.
          blockScope: editable === "image" && settingBlockPath.length > 0 ? settingBlockPath : null,
          rect: toRect(target!, iframeOffset(iframe)),
        });
        if (editable === "text" || editable === "richtext") {
          enableInlineEdit(target!, sectionId, binding);
        }
        return;
      }

      let node = target;
      while (node && node !== doc.body) {
        const sectionEl = node.closest("[data-sf-section-id]") as HTMLElement | null;
        if (sectionEl) {
          const sectionId = sectionEl.getAttribute("data-sf-section-id")!;
          const sectionType = sectionEl.getAttribute("data-sf-section-type");
          const frame = iframeOffset(iframe);

          // No metadata — try to bind the clicked text to a setting by matching its
          // content against the section's JSON (docs/EDITOR-TOOLBARS.md).
          const textEl = textElementAt(e.target as HTMLElement, sectionEl);
          const text = textEl?.textContent?.trim();
          const binding = textEl && text ? resolveTextRef.current(sectionId, text) : null;
          if (textEl && binding) {
            trackedRef.current = { el: textEl, text: text! };
            setFieldSelected(textEl);
            onSelect({ sectionId, sectionType, settingId: binding.settingId, editable: "text", binding, blockScope: null, rect: toRect(textEl, frame) });
            enableInlineEdit(textEl, sectionId, binding);
            return;
          }

          // Text didn't resolve to a unique setting (an image/icon area, ambiguous copy, …).
          // Themes mark each block's own wrapper with the (otherwise-inert) Shopify editor
          // attribute — walk up to the nearest one, then collect every such id between it and
          // the section root, so a click inside a nested block resolves the whole chain. This
          // is what lets a block-level click scope a rewrite to just that block instead of
          // silently falling back to the whole section.
          const blockEl = (e.target as HTMLElement).closest(
            "[data-shopify-editor-block]",
          ) as HTMLElement | null;
          const blockPath: string[] = [];
          if (blockEl && sectionEl.contains(blockEl)) {
            let n: HTMLElement | null = blockEl;
            while (n && n !== sectionEl) {
              const id = n.getAttribute("data-shopify-editor-block");
              if (id) blockPath.unshift(id);
              n = n.parentElement;
            }
          }

          if (blockPath.length > 0 && blockEl) {
            trackedRef.current = { el: blockEl, text: null };
            setFieldSelected(blockEl);
            onSelect({
              sectionId,
              sectionType,
              settingId: null,
              editable: null,
              binding: null,
              blockScope: blockPath,
              rect: toRect(blockEl, frame),
            });
          } else {
            trackedRef.current = { el: sectionEl, text: null };
            setFieldSelected(null);
            onSelect({ sectionId, sectionType, settingId: null, editable: null, binding: null, blockScope: null, rect: toRect(sectionEl, frame) });
          }
          return;
        }
        node = node.parentElement;
      }
    };

    const handleScroll = () => {
      onRectChangeRef.current(
        trackedRef.current ? toRect(trackedRef.current.el, iframeOffset(iframeRef.current)) : null,
      );
    };

    // Undo/redo: skipped while the key lands on a text field or the active inline edit — the
    // browser's native contenteditable undo handles typing there instead of jumping the whole
    // template back.
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      const target = e.target as HTMLElement | null;
      const isEditableFocus =
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (isEditableFocus) return;
      if (key === "y") {
        e.preventDefault();
        onRedoRef.current();
        return;
      }
      e.preventDefault();
      if (e.shiftKey) onRedoRef.current();
      else onUndoRef.current();
    };

    doc.addEventListener("click", handleLinkNavigation, true);
    doc.addEventListener("click", handleDetailsToggle, true);
    doc.addEventListener("click", handleGalleryThumbnailClick);
    doc.addEventListener("click", handleClick);
    doc.addEventListener("mouseover", handleOver);
    doc.addEventListener("keydown", handleKeyDown);
    // Capture-phase so inner scroll containers report too, not just the document.
    doc.addEventListener("scroll", handleScroll, { capture: true, passive: true });
    iframe.contentWindow?.addEventListener("resize", handleScroll);

    // A full reload replaced the document: restore the viewport, the selection outline
    // (via reanchor + the outline effect), and the toolbar anchor.
    if (pendingScrollRef.current > 0) {
      iframe.contentWindow?.scrollTo(0, pendingScrollRef.current);
      pendingScrollRef.current = 0;
    }
    const selected = selectedRef.current
      ? (doc.querySelector(`[data-sf-section-id="${selectedRef.current}"]`) as HTMLElement | null)
      : null;
    selected?.classList.add("sf-selected");
    reanchor(doc);
  }, [onSelect, onTextCommit, reanchor]);

  // Toggle the selection outline on the live document without a re-render.
  useEffect(() => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    doc.querySelectorAll("[data-sf-section-id]").forEach((el) => {
      el.classList.toggle(
        "sf-selected",
        el.getAttribute("data-sf-section-id") === selectedSectionId,
      );
    });
    // The field-selected outline is otherwise owned entirely inside handleClick's closure, so
    // it can't react to the selection being cleared from outside a click in the iframe (the
    // toolbar's close button, deleting the section). Strip any leftover here when that happens
    // — but ONLY when selection was cleared entirely: this effect also re-runs on the very
    // first click of a session (selectedSectionId going from null to that click's own section),
    // and stripping unconditionally there would erase the class handleClick had just set for
    // that same click, moments earlier in the same tick.
    if (!selectedSectionId) {
      doc.querySelectorAll(".sf-field-selected").forEach((el) => el.classList.remove("sf-field-selected"));
      trackedRef.current = null;
    }
  }, [selectedSectionId, html]);

  if (!mount.html) return <div className="h-full w-full bg-white" />;

  return (
    <iframe
      key={mount.key}
      ref={iframeRef}
      data-mount-key={mount.key}
      onLoad={handleLoad}
      sandbox="allow-same-origin"
      srcDoc={mount.html}
      title="Store preview"
      className="h-full w-full border-0 bg-white"
    />
  );
});
