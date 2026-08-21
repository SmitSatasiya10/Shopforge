import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The Base Theme is vendored Shopify theme source, not Shopforge code — it is
    // authored and reviewed upstream, so our lint rules do not apply to it.
    "public/base-theme/**",
    // Curated AI section/block schemas, copied in as data.
    "lib/ai/catalog/**",
  ]),
]);

export default eslintConfig;
