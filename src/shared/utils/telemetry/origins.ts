// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

// No `@sentry/react` import here: this runs at instrument.ts module load,
// before any product module evaluates. Keep it parser-only.

/**
 * Origins the telemetry transport needs the host to allowlist, derived from the
 * Sentry DSN.
 *
 * A sandboxed Polkadot host blocks outbound HTTP per-origin until granted a
 * `Remote` permission. Sentry's ingest endpoint (the DSN host) is the only
 * origin this transport talks to — replay is disabled and no auto fetch/xhr/
 * navigation instrumentation runs, so the DSN host is the complete allowlist.
 *
 * Returns the bare hostname (the shape the host-API `Remote` codec expects),
 * or `[]` for an empty/unparseable DSN (console-only / disabled telemetry).
 */
export function sentryRemoteOrigins(dsn: string): string[] {
  const trimmed = dsn.trim();
  if (trimmed === "") return [];
  try {
    return [new URL(trimmed).hostname];
  } catch {
    return [];
  }
}
