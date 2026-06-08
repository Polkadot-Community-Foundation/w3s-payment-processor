// Deploy preflight: validate the STATIC / build-time config only — chain/token/host
// env wiring in src/config.ts and the credentialMap group entries. The per-merchant
// credential bundles (profile + v1/v2 terminals incl. PEM) are NOT bundled; they
// are fetched + AES-GCM-decrypted at unlock time. Validate / re-provision encrypted
// bundles separately with:
//   REMOTE_CREDENTIALS_PASSKEY=… npm run upload-credentials -- --dry-run
// Run via vite-node so TS + the `@/` alias + import.meta.env all resolve.
try {
  const { envConfig, credentialMap } = await import("../src/config.ts");
  const net = envConfig.network;
  const groups = Object.keys(credentialMap);
  const unconfigured = groups.filter((g) => !credentialMap[g]);
  if (unconfigured.length > 0) {
    console.warn(
      `static config WARNING — credentialMap has ${unconfigured.length} group(s) with no URL yet: ${unconfigured.map((g) => `"${g}"`).join(", ")}`,
    );
  }
  console.log(
    `static config OK — network "${net.key}" (${net.displayName}); ` +
      `token ${envConfig.token.symbol} (${envConfig.token.decimals}dp); ` +
      `host ${envConfig.host.productDotNs}; ` +
      `listeners v1=${envConfig.protocols.v1Enabled ? "on" : "off"} v2=${envConfig.protocols.v2Enabled ? "on" : "off"}; ` +
      `credentialMap: ${groups.length} group(s)${unconfigured.length ? ` (${unconfigured.length} pending)` : " (all configured)"}`,
  );
} catch (error) {
  console.error(`static config INVALID: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
