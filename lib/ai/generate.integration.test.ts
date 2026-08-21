import "dotenv/config";
import { describe, it, expect } from "vitest";
import { generateTemplate } from "./content-generator";
import { renderTemplate } from "@/lib/preview/template-renderer";
import { createFsTemplateReader } from "@/lib/preview/fs-template-reader";
import { NormalizedProduct } from "@/lib/product/types";

const product: NormalizedProduct = {
  title: "Aurora Merino Crew",
  description:
    "A midweight 100% merino wool crew neck knit. Temperature regulating, naturally odour resistant, and machine washable.",
  price: 128,
  compareAtPrice: 160,
  currency: "USD",
  images: [
    { url: "https://example.com/front.jpg", altText: "Front" },
    { url: "https://example.com/detail.jpg", altText: "Detail" },
    { url: "https://example.com/worn.jpg", altText: "Worn" },
  ],
  variants: [
    { title: "Small / Fog", price: 128, sku: "AMC-S-FOG" },
    { title: "Medium / Fog", price: 128, sku: "AMC-M-FOG" },
  ],
  options: [
    { name: "Size", values: ["Small", "Medium", "Large"] },
    { name: "Colour", values: ["Fog", "Ink"] },
  ],
  vendor: "Northwake",
  productUrl: "https://example.com/products/aurora-merino-crew",
  source: "shopify",
};

// Live API test: costs money and takes ~2 minutes, so it runs only on request.
//   RUN_AI_TESTS=1 npx vitest run lib/ai/generate.integration.test.ts
const hasKey = Boolean(process.env.OPENROUTER_API_KEY) && process.env.RUN_AI_TESTS === "1";

describe.skipIf(!hasKey)("AI generation against the real theme", () => {
  for (const name of ["product", "index"] as const) {
    it(`generates and renders ${name}.json`, async () => {
      const result = await generateTemplate({ product, templateName: name });
      console.log(
        `[${name}] model=${result.model} sections=${result.template.order?.length} ` +
          `images: ${result.images.fromProduct}/${result.images.targets} from product, ` +
          `${result.images.generated} generated; dropped=[${result.droppedSections.join(", ")}]`,
      );
      console.log(`[${name}] order: ${result.template.order?.join(" -> ")}`);
      // artefacts are inspected by hand when debugging a prompt change

      const readTemplate = createFsTemplateReader();
      const html = await renderTemplate({
        template: result.template,
        product,
        storeName: product.vendor!,
        readTemplate,
        templateName: name,
      });
      const failures = [...html.matchAll(/shopforge: [^\n]*?-->/g)].map((m) => m[0]);
      console.log(`[${name}] rendered ${html.length} chars, ${failures.length} section failures`);
      for (const f of failures.slice(0, 5)) console.log(`   ${f.slice(0, 140)}`);
      

      expect(result.template.order?.length ?? 0).toBeGreaterThan(2);
      expect(failures.length).toBe(0);
    }, 180000);
  }
});
