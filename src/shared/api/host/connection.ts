/**
 * Host detection + transport handshake + remote-origin permission. Trimmed
 * from `apps/w3spay/src/shared/api/host/connection.ts` to what a read-only
 * payment monitor needs: no camera, no QR, no Spektr/iOS gates.
 */
import { requestPermission, sandboxProvider, sandboxTransport } from "@/shared/api/host/host-api.ts";
import { isDev } from "@/config.ts";

declare global {
  interface Window {
    /** Set by Polkadot Desktop's webview shell. */
    __HOST_WEBVIEW_MARK__?: boolean;
  }
}

export type HostEnvironment = "desktop-webview" | "web-iframe" | "standalone";

/** Synchronous DOM-based host detection — safe to call at first render. */
export function detectHostEnvironment(): HostEnvironment {
  if (typeof window === "undefined") return "standalone";
  if (window.__HOST_WEBVIEW_MARK__ === true) return "desktop-webview";
  try {
    if (window !== window.top) return "web-iframe";
  } catch {
    // Cross-origin iframe — `window.top` access throws; treat as hosted.
    return "web-iframe";
  }
  return "standalone";
}

export function isInHost(): boolean {
  return detectHostEnvironment() !== "standalone";
}

/** Whether the in-page sandbox MessagePort published by the host is present. */
export function isSandboxReady(): boolean {
  return sandboxProvider.isCorrectEnvironment();
}

/** True only during `vite dev` in a plain standalone tab (no host bridge). */
export function isDevStandalone(): boolean {
  if (!isDev) return false;
  if (typeof window === "undefined") return false;
  return !isInHost();
}

const HOST_HANDSHAKE_TIMEOUT_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

let connected = false;
let inFlightHandshake: Promise<boolean> | null = null;

/**
 * Await the host-API transport handshake. MUST be awaited before any direct
 * host request — on slow webview-port bring-up the SDK otherwise surfaces
 * `RequestCredentialsErr::Unknown ("Polkadot host is not ready")`. Returns
 * `false` outside a host or on timeout/failure (not cached, so a retry gets a
 * fresh shot); a successful `true` sticks for the page lifetime.
 */
export async function connectToHost(timeoutMs: number = HOST_HANDSHAKE_TIMEOUT_MS): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!isInHost()) return false;
  if (connected) return true;
  if (inFlightHandshake) return inFlightHandshake;

  inFlightHandshake = withTimeout(
    sandboxTransport.isReady().then((ready) => {
      connected = ready;
      return ready;
    }),
    timeoutMs,
    "[host] handshake",
  )
    .catch((caught) => {
      console.warn(`[host] handshake failed: ${caught instanceof Error ? caught.message : String(caught)}`);
      connected = false;
      return false;
    })
    .finally(() => {
      inFlightHandshake = null;
    });

  return inFlightHandshake;
}

/** Read the cached handshake outcome (post-`connectToHost`). */
export function isHostConnected(): boolean {
  return connected;
}

export interface RemoteOriginPermissionOutcome {
  granted: boolean;
  error?: string;
}

const remoteOriginCache = new Map<string, RemoteOriginPermissionOutcome>();

/**
 * Ask the host to allowlist outbound WS/HTTP to one or more origins so the
 * sandbox lets the processor reach chain RPC endpoints (and Sentry). No-op
 * outside a host (the browser connects directly). Grants are cached per
 * origin-set after the first success.
 */
export async function requestRemoteOriginPermission(
  origins: readonly string[],
): Promise<RemoteOriginPermissionOutcome> {
  if (!isInHost() || origins.length === 0) return { granted: true };
  const key = [...origins].sort().join("|");
  const cached = remoteOriginCache.get(key);
  if (cached) return cached;

  const ready = await connectToHost();
  if (!ready) return { granted: false, error: "host transport not ready" };

  // The grant itself is unbounded in the SDK — a desktop host that never answers
  // the "Remote" permission (or one that routes chain RPC through its bridge and
  // never needs this WS allowlist) would otherwise wedge boot forever: v1's first
  // await is `requestChainRemotePermissions`, so a hung grant strands the UI on
  // "Connecting…". Bound it; on timeout we proceed ungranted (the bridge path, or
  // a real WS-connect failure, surfaces instead of an infinite spinner).
  const outcome = await withTimeout(
    requestPermission({ tag: "Remote", value: [...origins] }).match<RemoteOriginPermissionOutcome>(
      (granted) => ({ granted }),
      (err) => ({ granted: false, error: err.payload?.reason ?? err.message }),
    ),
    HOST_HANDSHAKE_TIMEOUT_MS,
    "[host] remote-origin permission",
  ).catch((caught) => {
    console.warn(`[host] remote-origin permission failed: ${caught instanceof Error ? caught.message : String(caught)}`);
    return { granted: false, error: "remote-origin permission timed out" } as RemoteOriginPermissionOutcome;
  });
  if (outcome.granted) remoteOriginCache.set(key, outcome);
  return outcome;
}
