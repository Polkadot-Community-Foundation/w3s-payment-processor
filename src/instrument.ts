/**
 * Sentry bootstrap. MUST be the first import in `main.tsx` — before React
 * or any product module — so the global error handlers wire up before
 * anything else can throw at import time.
 *
 * Telemetry is opt-in: with no `VITE_SENTRY_DSN` the SDK is never loaded
 * and the app runs fully (telemetry is not part of the product contract).
 * Env is resolved in `@/config.ts` (the single env audit point); this module
 * owns only the opt-in and the SDK-init side effect.
 */
import { telemetryConfig } from "@/config.ts";
import { initTelemetry } from "@/shared/utils/telemetry/init.ts";

if (telemetryConfig.dsn) {
  initTelemetry(telemetryConfig);
}
