// The preview iframe is `sandbox="allow-same-origin"` and never `allow-scripts`
// (docs/product-spec/08-preview-iframe.md — the theme's JavaScript is deliberately not run).
// The Base Theme, like every modern Shopify theme, ships markup that is hidden in CSS until
// its own JavaScript reveals it. Without these shims the page renders correctly and is then
// hidden by its own stylesheets, which reads as a blank preview.
//
// Each shim reproduces exactly what the theme's own JavaScript would have done on load —
// nothing more. They are applied to the final HTML, never to the theme's source files.

/**
 * The theme boots with `<html class="no-js">` and its first inline script swaps it for `js`
 * (layout/theme.liquid). `base.css` hides every `.no-js-hidden` element while `no-js` is
 * present — 22 of the theme's sections and snippets use that class — so without the swap
 * those elements are `display: none`.
 */
function applyJsClass(html: string): string {
  return html.replace(
    /(<html\b[^>]*\bclass=")([^"]*)(")/i,
    (_match, before: string, classes: string, after: string) => {
      const swapped = classes.includes("no-js")
        ? classes.replace(/\bno-js\b/g, "js")
        : `${classes} js`.trim();
      return `${before}${swapped}${after}`;
    },
  );
}

/**
 * Load animations. The theme renders sections as `.animate-section.animate--hidden` with
 * `.animate-item` children at `opacity: 0`, and an IntersectionObserver adds `animate--shown`
 * once the section scrolls into view. With no JavaScript nothing is ever shown, so the
 * preview pins every animated item to its final (revealed) state.
 *
 * The theme's own `<noscript>` fallback covers the same ground, but it is not reliable across
 * browsers inside a sandboxed iframe, so the preview does not depend on it.
 */
const PREVIEW_STYLES = `
    /* Shopforge preview: the theme's JavaScript does not run in the preview iframe, so
       anything it would have revealed is pinned to its revealed state. */
    .animate-section.animate--hidden .animate-item,
    .animate-section .animate-item {
      opacity: 1 !important;
      filter: none !important;
      transform: none !important;
    }

    /* The browser treats a sandboxed iframe as scripting-disabled, so it renders every
       <noscript> block. Those hold the theme's no-JS fallbacks — a plain numbered slider
       nav in place of the real one, for instance — which would appear alongside the real
       controls. The preview presents the JS-enabled storefront, so they stay hidden. */
    noscript {
      display: none !important;
    }

    /* Product media gallery. base.css hides every slide that is not .is-active, and the
       theme's media-gallery element assigns that class on load — so with no JavaScript the
       whole gallery is display:none and the product page shows slider arrows around an empty
       box, even though the images are present and loading. Pin the first real slide open;
       variant-specific slides stay hidden, as they are on a live storefront until a variant
       is selected. */
    .product--thumbnail .product__media-item:not(.product__media-item--variant):first-child,
    .product--thumbnail_slider .product__media-item:not(.product__media-item--variant):first-child {
      display: block !important;
    }

    /* Product media zoom-lightbox trigger (snippets/product-thumbnail.liquid). It sits on top
       of the media to open a modal on click — real Dawn behavior, driven entirely by JS that
       never runs in this sandboxed iframe, so it is already a dead click target here. Left
       alone it still intercepts pointer events, which swallows clicks meant for the editor's
       click-to-select (including image_picker settings like a trust badge rendered inside the
       same media item). Let clicks pass through it to the image underneath. */
    .product-media-container .product__modal-opener {
      pointer-events: none !important;
    }

    /* Banner/slideshow text overlay (.banner__content, base.css — image-banner, slideshow,
       slideshow-hero, etc). It's a full-width/height flex wrapper that centers its content box
       — as an ancestor spanning the whole banner, it intercepts clicks everywhere in the banner,
       even in the empty space around the visible text/button card, which blocks clicking
       through to the image_picker-backed image beneath. Let the wrapper itself pass clicks
       through; its direct child (the sized content card) stays clickable, and everything
       inside that card — heading, button, etc — keeps working exactly as before, since
       pointer-events: auto is inherited from there down without needing to repeat it. */
    .banner__content {
      pointer-events: none;
    }
    .banner__content > * {
      pointer-events: auto;
    }
`;

function injectPreviewStyles(html: string): string {
  const style = `<style data-shopforge-preview>${PREVIEW_STYLES}</style>`;
  return html.includes("</head>")
    ? html.replace("</head>", `${style}\n</head>`)
    : `${style}${html}`;
}

const HTML_ENTITIES: Record<string, string> = {
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#34;": '"',
  "&#39;": "'",
  "&amp;": "&",
};

/**
 * The product gallery's thumbnail list (snippets/product-media-gallery.liquid) pipes its
 * `<img>` markup through an extra `| escape` on top of `image_tag`'s own escaping — real Dawn
 * source, not a Shopforge edit. On a live storefront the theme's own JavaScript reads that
 * escaped text back out and injects it as the real thumbnail image on load; with no
 * JavaScript running, the escaped markup is left showing as literal `&lt;img ...&gt;` text
 * instead of an image. This reproduces exactly that JS step: decode the escaped tag back into
 * real markup so the thumbnail renders like it does on a live storefront.
 */
function unescapeThumbnailImages(html: string): string {
  return html.replace(/&lt;img\b[\s\S]*?&gt;/g, (escaped) =>
    escaped.replace(/&lt;|&gt;|&quot;|&#34;|&#39;|&amp;/g, (entity) => HTML_ENTITIES[entity]),
  );
}

/**
 * Results section stat counters (sections/results.liquid). Each `.results__percentage` block
 * always server-renders its visible `<p>` as the literal text "0%" (and, for the "circle"
 * style, the ring's `stroke-dasharray="0 100"`) — real Dawn behavior, not a Shopforge bug — and
 * relies on ResultsContainer (assets/secondary.js), an IntersectionObserver-triggered counter,
 * to animate it up to the block's real `data-percentage` value on scroll. The "number" style's
 * real value is server-rendered too, but into a second `<p>` that base.css hides with
 * `opacity: 0` purely to reserve layout width during the animation (base.css:16744-16752) — so
 * neither style has a visible fallback. This reproduces exactly what the animation would have
 * landed on: the visible `<p>` and the ring both jump straight to the real value.
 */
function settleResultsCounters(html: string): string {
  return html.replace(
    /(<div\b[^>]*\bclass="[^"]*\bresults__percentage\b[^"]*"[^>]*\bdata-percentage="(\d+)"[^>]*>)([\s\S]*?)(<\/div>)/g,
    (_match, openTag: string, percentage: string, body: string, closeTag: string) => {
      const settled = body
        .replace('stroke-dasharray="0 100"', `stroke-dasharray="${percentage} 100"`)
        .replace(/(<p>\s*)0%(\s*<\/p>)/, `$1${percentage}%$2`);
      return `${openTag}${settled}${closeTag}`;
    },
  );
}

/** Applies every preview shim to a fully rendered page. */
export function applyPreviewShims(html: string): string {
  return injectPreviewStyles(applyJsClass(settleResultsCounters(unescapeThumbnailImages(html))));
}
