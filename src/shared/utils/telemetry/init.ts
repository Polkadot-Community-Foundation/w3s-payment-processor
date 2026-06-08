import * as Sentry from "@sentry/react";

/**
 * Minimal Sentry bootstrap for the payment processor. Privacy-first:
 * `sendDefaultPii: false`, no auto fetch/xhr/navigation instrumentation
 * (those carry chain endpoints + registry addresses), no session replay.
 *
 * Called once from `instrument.ts` only when a DSN is configured. With an
 * empty DSN the SDK initialises disabled — `captureException` becomes a
 * no-op — so call sites never need to branch on telemetry being on.
 */
export function initTelemetry(opts: {
  dsn: string;
  environment: string;
  tracesSampleRate: number;
}): void {
  Sentry.init({
    dsn: opts.dsn,
    environment: opts.environment,
    tracesSampleRate: opts.tracesSampleRate,
    sendDefaultPii: false,
    integrations: [],
  });
}
