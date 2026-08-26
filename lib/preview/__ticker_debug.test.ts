import { describe, it } from "vitest";
import { writeFileSync } from "node:fs";
import { renderTemplate } from "@/lib/preview/template-renderer";
import { createFsTemplateReader, createFsBinaryReader } from "@/lib/preview/fs-template-reader";
import { ShopifyTemplate } from "@/lib/preview/shopify-template";

const readTemplate = createFsTemplateReader();
const readBinary = createFsBinaryReader();

describe("ticker debug", () => {
  it("renders the ring project's actual horizontal-ticker section", async () => {
    const template: ShopifyTemplate = {
      sections: {
        horizontal_ticker_4zLVcV: {
          type: "horizontal-ticker",
          name: "Horizontal Ticker",
          settings: {
            speed: 3,
            bold_text: true,
            direction: "normal",
            pattern_bg: "none",
            visibility: "mobile-hidden",
            italic_text: true,
            color_scheme: "custom",
            pattern_size: 42,
            pattern_angle: 45,
            pattern_color: "#ffffff",
            stop_on_hover: true,
            item_padding_x: 32,
            item_padding_y: 6,
            mobile_spacing: 20,
            uppercase_text: true,
            desktop_spacing: 20,
            hidden_products: "",
            item_background: "#fff9f5",
            mobile_text_size: 16,
            desktop_text_size: 40,
            pattern_thickness: 2,
            custom_colors_text: "#b06338",
            displayed_products: "",
            mobile_padding_top: 4,
            desktop_padding_top: 32,
            mobile_image_height: 26,
            mobile_video_height: 150,
            pattern_opacity_low: 20,
            desktop_image_height: 40,
            desktop_video_height: 250,
            mobile_reviews_width: 300,
            pattern_opacity_mode: "low",
            desktop_reviews_width: 400,
            mobile_padding_bottom: 4,
            desktop_padding_bottom: 32,
            pattern_opacity_normal: 35,
            enable_specific_display: false,
            custom_colors_background: "#9b5c2b",
            custom_gradient_background: "",
          },
          blocks: {
            text_1: { type: "text", settings: { text: "", title: "Perfect Anniversary Gift" } },
            text_2: { type: "text", settings: { text: "", title: "Luxury Quality" } },
          },
          block_order: ["text_1", "text_2"],
        },
      },
      order: ["horizontal_ticker_4zLVcV"],
    } as unknown as ShopifyTemplate;

    const html = await renderTemplate({
      template,
      product: null,
      storeName: "Test Store",
      readTemplate,
      readBinary,
      templateName: "index",
    });

    writeFileSync("/tmp/claude-1000/-home-master-Smit-Shopforge/30ff63a0-b87b-4284-b8f2-aa9258cf2d7e/scratchpad/ticker-check/rendered-full.html", html);

    // Extract just the ticker's own <style> and container markup for quick inspection.
    const styleMatches = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
      .map((m) => m[1])
      .filter((css) => css.includes("horizontal-ticker") || css.includes("HorTicker"));
    writeFileSync(
      "/tmp/claude-1000/-home-master-Smit-Shopforge/30ff63a0-b87b-4284-b8f2-aa9258cf2d7e/scratchpad/ticker-check/rendered-ticker-css.txt",
      styleMatches.join("\n\n---\n\n"),
    );

    const containerMatch = html.match(/<div class="horizontal-ticker[\s\S]*?<\/div>\s*<\/div>/);
    writeFileSync(
      "/tmp/claude-1000/-home-master-Smit-Shopforge/30ff63a0-b87b-4284-b8f2-aa9258cf2d7e/scratchpad/ticker-check/rendered-ticker-html.txt",
      containerMatch?.[0] ?? "NOT FOUND",
    );
  });
});
