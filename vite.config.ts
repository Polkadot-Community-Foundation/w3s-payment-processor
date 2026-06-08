import { sentryVitePlugin } from "@sentry/vite-plugin";
/// <reference types="vitest" />
import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: "./",
  plugins: [react(), sentryVitePlugin({
    org: "paritytech",
    project: "w3spay"
  })],
  resolve: {
    // Absolute `@/` imports → `src/`, so moving a feature does not cascade
    // into relative-path churn across the tree.
    alias: {
      "@": path.resolve(here, "src"),
    },
  },
  build: {
    target: "es2022",
    sourcemap: true
  },
  esbuild: {
    target: "es2022",
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
