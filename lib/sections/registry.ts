import { SectionDefinition } from "@/lib/store-config/types";

// Stand-in for the production Section Library's generated catalog.json
// (docs/product-spec/02-base-theme-and-section-library.md §2.3) — hardcoded
// because this prototype's 6 sections don't warrant the contract.json/
// editor.meta.json codegen pipeline yet (prototype-phase-plan.md §19).
export const SECTION_REGISTRY: SectionDefinition[] = [
  {
    type: "announcement-bar",
    name: "Announcement Bar",
    liquidPath: "sections/announcement-bar.liquid",
    settings: [
      { id: "message", type: "text", label: "Message", default: "Free shipping on all orders" },
      { id: "link_url", type: "url", label: "Link", default: "" },
    ],
  },
  {
    type: "header",
    name: "Header",
    liquidPath: "sections/header.liquid",
    settings: [{ id: "store_name", type: "text", label: "Store name", default: "Shopforge Demo" }],
  },
  {
    type: "product-hero",
    name: "Product Hero",
    liquidPath: "sections/product-hero.liquid",
    settings: [
      { id: "heading_override", type: "text", label: "Heading override (optional)", default: "" },
      { id: "cta_label", type: "text", label: "Add-to-cart button label", default: "Add to cart" },
    ],
  },
  {
    type: "rich-text",
    name: "Rich Text",
    liquidPath: "sections/rich-text.liquid",
    settings: [
      { id: "heading", type: "text", label: "Heading", default: "Why you'll love it" },
      {
        id: "body",
        type: "richtext",
        label: "Body",
        default: "Add a few sentences about your product or brand story here.",
      },
    ],
  },
  {
    type: "image-with-text",
    name: "Image With Text",
    liquidPath: "sections/image-with-text.liquid",
    settings: [
      { id: "heading", type: "text", label: "Heading", default: "Made to last" },
      {
        id: "body",
        type: "richtext",
        label: "Body",
        default: "Describe the materials, craftsmanship, or story behind this product.",
      },
      { id: "image_url", type: "image_picker", label: "Image", default: "" },
    ],
  },
  {
    type: "footer",
    name: "Footer",
    liquidPath: "sections/footer.liquid",
    settings: [
      {
        id: "copyright_text",
        type: "text",
        label: "Copyright line",
        default: "© 2026 Shopforge Demo. All rights reserved.",
      },
    ],
  },
];

export function getSectionDefinition(type: string): SectionDefinition | undefined {
  return SECTION_REGISTRY.find((s) => s.type === type);
}
