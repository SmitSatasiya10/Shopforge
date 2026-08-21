// Patches a live element's subtree to match freshly rendered markup by touching only the
// nodes that actually differ. Replacing a section's whole innerHTML (the previous approach)
// recreates every element in it — each <img> re-decodes and repaints, which reads as the
// section "blinking" on every settings change. Morphing keeps unchanged elements alive, so
// images, videos and iframes never reload for a text or class change.
//
// The algorithm is deliberately index-based (no keys): a settings change re-renders the
// same structure with small differences, which is exactly the case index matching handles
// perfectly. When the structure really diverges (a block added or removed mid-list), the
// mismatched tail is replaced outright — never wrong, just less minimal.

function syncAttributes(from: Element, to: Element): void {
  for (const attr of Array.from(from.attributes)) {
    if (!to.hasAttribute(attr.name)) from.removeAttribute(attr.name);
  }
  for (const attr of Array.from(to.attributes)) {
    if (from.getAttribute(attr.name) !== attr.value) from.setAttribute(attr.name, attr.value);
  }
}

/** Makes `from`'s children equal to `to`'s. `to` is read only — nodes are cloned in. */
export function morphChildren(from: Element, to: Element): void {
  const fromNodes = Array.from(from.childNodes);
  const toNodes = Array.from(to.childNodes);
  const shared = Math.min(fromNodes.length, toNodes.length);

  for (let i = 0; i < shared; i++) {
    const live = fromNodes[i];
    const next = toNodes[i];
    if (live.nodeType !== next.nodeType || live.nodeName !== next.nodeName) {
      from.replaceChild(next.cloneNode(true), live);
    } else if (live.nodeType === Node.ELEMENT_NODE) {
      if (!live.isEqualNode(next)) {
        syncAttributes(live as Element, next as Element);
        morphChildren(live as Element, next as Element);
      }
    } else if (live.nodeValue !== next.nodeValue) {
      // Text and comment nodes.
      live.nodeValue = next.nodeValue;
    }
  }

  for (let i = fromNodes.length - 1; i >= shared; i--) from.removeChild(fromNodes[i]);
  for (let i = shared; i < toNodes.length; i++) from.appendChild(toNodes[i].cloneNode(true));
}
