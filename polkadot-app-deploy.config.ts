// `defineConfig` is vendored as an identity function rather than imported from
// the deploy CLI: the tool (`@polkadot-community-foundation/polkadot-app-deploy`)
// is a global/npx CLI, not a package.json dependency, so importing from it makes
// config resolution fragile. The CLI auto-discovers this file by name
// (`polkadot-app-deploy.config.{ts,js,mjs}`, walking up from the build dir) and
// reads the default export to publish the product manifest. A file named
// anything else is silently ignored (manifest publish skipped, no error).
const defineConfig = <T>(config: T): T => config;

declare const process: { env?: Record<string, string | undefined> };

// VITE_DOTNS_PRODUCT_DOMAIN is the single source of the product domain; deploy.sh
// exports it (with the `.dot` suffix) before invoking the CLI, so this MUST equal
// the domain the CLI is invoked with or the manifest publish aborts.
const domain = process.env?.VITE_DOTNS_PRODUCT_DOMAIN;
if (!domain) {
  throw new Error(
    "VITE_DOTNS_PRODUCT_DOMAIN is not set. This env var must be set to the target DotNS domain for the deploy, and it is also embedded into the build as the product identity.",
  );
}
export default defineConfig({
  domain,
  displayName: "W3sPay Payment Processor",
  description: "Per-merchant monitor for payments",
  icon: { path: "./icon.png", format: "png" },
  executables: [
    {
      kind: "app",
      path: "./dist",
      appVersion: [0, 1, 0],
    },
  ],
});
