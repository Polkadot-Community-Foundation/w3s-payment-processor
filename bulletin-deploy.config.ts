import { defineConfig } from "bulletin-deploy";

// Product manifest for the W3sPay Payment Processor SPA. `./deploy.sh` publishes
// this to DotNS as `w3spaymentprocessor.dot`; `domain` MUST equal that deploy
// target or `publishManifest` aborts. `icon.path` and `executables[].path` are
// resolved relative to THIS file; `./dist` is Vite's build output that
// `deploy.sh` uploads.
export default defineConfig({
  domain: "w3spaymentprocessor.dot",
  displayName: "W3sPay Payment Processor",
  description: "Per-merchant monitor for RFC6 (v1) and Coinage (v2) payments",
  icon: { path: "./icon.png", format: "png" },
  executables: [
    {
      kind: "app",
      path: "./dist",
      appVersion: [0, 1, 0],
    },
  ],
});
