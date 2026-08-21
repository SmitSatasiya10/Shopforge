import { describe, it, expect } from "vitest";
import { renderTemplate } from "@/lib/preview/template-renderer";
import { createFsTemplateReader } from "@/lib/preview/fs-template-reader";
import { loadSectionSchema, loadBlockSchema } from "@/lib/preview/section-schema";
import { setSettingsAtPath } from "@/lib/store-config/template-ops";
import { findTextControls, applyColor } from "./text-controls";
import type { ShopifyTemplate } from "@/lib/preview/shopify-template";

// End-to-end regression for "color is not getting applied": a custom-columns-new heading
// whose title is wrapped entirely in <strong> (the theme's own product template ships one).
// The theme's `.heading.title-with-highlight-1--color strong` rule colors the <strong> with
// the highlight color, beating the h2's inherited custom color — so picking a text color
// must move the highlight colors too, or nothing visibly changes.
describe("inline color pick reaches the rendered page", () => {
  it("applies the picked color to a strong-wrapped heading", async () => {
    const readTemplate = createFsTemplateReader();

    const template: ShopifyTemplate = {
      sections: {
        cc: {
          type: "custom-columns-new",
          settings: {},
          blocks: {
            col: {
              type: "column",
              settings: {},
              blocks: {
                h: {
                  type: "heading",
                  // Exactly the shape the Base Theme's product.json ships.
                  settings: {
                    title: "<strong>Hurry! Sale Ends Soon</strong>",
                    heading_size: "h0",
                    title_highlight_1: "solid-color",
                    title_highlight_1_color: "#93634a",
                    enable_custom_color: false,
                    custom_color: "#ff0000",
                  },
                },
              },
              block_order: ["h"],
            },
          },
          block_order: ["col"],
        },
      },
      order: ["cc"],
    };

    // Resolve controls exactly the way the editor does for this binding.
    const sectionSchema = await loadSectionSchema(readTemplate, "custom-columns-new");
    const declared = sectionSchema?.blocks?.find((b) => b.type === "heading")?.settings;
    const defs = declared ?? (await loadBlockSchema(readTemplate, "heading"))?.settings ?? [];
    const controls = findTextControls(defs);
    expect(controls.color?.companionIds).toContain("title_highlight_1_color");

    // The pick.
    const writes = applyColor(controls.color!, "#213778");
    template.sections.cc = setSettingsAtPath(template.sections.cc, ["col", "h"], writes);

    const html = await renderTemplate({
      template,
      product: null,
      storeName: "Test",
      readTemplate,
      templateName: "index",
    });

    // The strong-highlight variable now carries the picked color, so the visible <strong>
    // text actually changes — this is what "the color applied" means for this heading.
    // In gradient mode this variable is fed from title_highlight_1_gradient.
    expect(html).toMatch(/--hightlight-1--color:\s*#213778/);
    // The old brown gradient must be gone from the heading's style.
    expect(html).not.toContain("292deg");
    // And the plain custom color path is active too, for any text outside the <strong>.
    expect(html).toMatch(/color:\s*#213778/);
  });
});
