// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * Sentry bootstrap + boot-time host permission grants. MUST be the first
 * import in `main.tsx` — before React or any product module — so the global
 * error handlers wire up before anything else can throw, and so every
 * host-modal grant the processor needs is queued at boot rather than
 * surfacing mid-flow.
 *
 * Telemetry is opt-in: with no `VITE_SENTRY_DSN` the SDK is never loaded
 * and the app runs fully (telemetry is not part of the product contract).
 * Env is resolved in `@/config.ts` (the single env audit point); this module
 * owns the opt-in, the SDK-init side effect, and the boot permission fan-out.
 */
import { envConfig } from "@/config.ts";
import { requestRemoteOriginPermission } from "@/shared/api/host/connection.ts";
import { requestChainRemotePermissions } from "@/shared/api/client.ts";
import { initTelemetry } from "@/shared/utils/telemetry/init.ts";
import { sentryRemoteOrigins } from "@/shared/utils/telemetry/origins.ts";

if (envConfig.telemetry.dsn) {
  initTelemetry(envConfig.telemetry);
}

// Fire every host-modal permission this product needs, in sequence, at boot.
// Both grants are `Remote` allowlists — the host shows one modal at a time
// and silently drops a second prompt that arrives while another is open, so
// these MUST be awaited one after another (not Promise.all'd). Fire-and-
// forget at the top level: a failed/denied grant must not block module load.
// `requestRemoteOriginPermission` is in-flight-deduped + cached, so the v1
// engine's later `requestChainRemotePermissions()` call hits the cache.
void (async () => {
  const sentryOrigins = sentryRemoteOrigins(envConfig.telemetry.dsn);
  if (sentryOrigins.length > 0) {
    await requestRemoteOriginPermission(sentryOrigins);
  }
  await requestChainRemotePermissions();
})();