/**
 * v1 watch resilience supervisor. Keeps the chain tail live across host
 * pause/resume cycles by restarting the watch loop on visibility resume and
 * when blocks stop arriving.
 *
 * Why this exists: the Polkadot host (iOS, Desktop) pauses its outbound chain
 * WS connections when the WebView is suspended (logged
 * `[chainConnection] pausing all connections`). When the WebView resumes, the
 * host reconnects the WS and starts fresh subscriptions on its side — but
 * does NOT emit a `Stop` event for the chainHead follow PAPI is using, so
 * PAPI's auto-refollow never triggers and no further blocks surface. The
 * caller's `start(signal)` MUST drop and recreate the PAPI client on each
 * restart (see `recreatePeopleChainClient` in `shared/api/client.ts`) so the
 * dead follow ID is replaced by a fresh `chainHead_v1_follow` on the
 * now-reconnected WS.
 *
 * The engine owns the checkpoint and watch deps; the supervisor only decides
 * WHEN to restart and serializes concurrent restarts so the engine never
 * double-emits a block.
 */

import type { V1WatchHandle } from "@/features/v1/api/watch.ts";

/** Visibility surface. Production uses `document`; tests inject a fake. */
export interface VisibilityHandle {
  state(): "visible" | "hidden";
  /** Subscribe to visibility changes. Returns an unsubscribe function. */
  onChange(listener: () => void): () => void;
}

/** Logging hook signature. */
export type WatchSupervisorLog = (message: string) => void;

/** Starter callback signature. Aborting `signal` MUST cancel in-flight setup. */
export type WatchStarter = (signal: AbortSignal) => Promise<V1WatchHandle>;

/** Options for `startWatchSupervisor`. */
export interface WatchSupervisorOptions {
  /**
   * Start a fresh watch loop. Aborting the passed signal MUST cancel any
   * in-flight setup (e.g. mid-backfill) so a superseding restart never
   * double-emits. The starter is responsible for recreating any per-loop
   * resources (PAPI client, backfill WS provider) — the supervisor only
   * tracks restart cause and lifecycle.
   */
  start: WatchStarter;
  /** Logging hook. Receives short progress lines from the supervisor. */
  log?: WatchSupervisorLog;
  /** Visibility source. Defaults to a `document`-based handle when available. */
  visibility?: VisibilityHandle;
  /** Watchdog stale threshold — restart when no block arrives for this long. Default 45_000. */
  staleBlockMs?: number;
  /** Watchdog poll interval. Default 10_000. */
  watchdogIntervalMs?: number;
  /** Debounce after visibility-resumed before restarting. Default 1_500. */
  visibilityRestartDelayMs?: number;
}

/** Public surface of a started supervisor. */
export interface WatchSupervisor {
  /** Notify the supervisor that a fresh block was just processed (resets staleness). */
  noteBlock(): void;
  /** Force a restart immediately (debounce-bypassed). Idempotent — concurrent calls coalesce. */
  restartNow(cause: string): void;
  /** Tear down listeners, watchdog, and the current watch loop. */
  stop(): void;
}

const DEFAULT_STALE_BLOCK_MS = 45_000;
const DEFAULT_WATCHDOG_INTERVAL_MS = 10_000;
const DEFAULT_VISIBILITY_RESTART_DELAY_MS = 1_500;

/**
 * Start the supervised watch. Awaits the initial `start()`; initial-start
 * errors propagate to the caller. Subsequent restart failures are swallowed
 * with a log line — the watch deps' `onError` callback is the engine's
 * channel for surfacing live errors.
 */
export async function startWatchSupervisor(opts: WatchSupervisorOptions): Promise<WatchSupervisor> {
  const log: WatchSupervisorLog = opts.log ?? (() => {});
  const visibility: VisibilityHandle = opts.visibility ?? defaultDocumentVisibility();
  const staleBlockMs = opts.staleBlockMs ?? DEFAULT_STALE_BLOCK_MS;
  const watchdogIntervalMs = opts.watchdogIntervalMs ?? DEFAULT_WATCHDOG_INTERVAL_MS;
  const visibilityRestartDelayMs = opts.visibilityRestartDelayMs ?? DEFAULT_VISIBILITY_RESTART_DELAY_MS;

  let stopped = false;
  let currentAbort: AbortController | null = null;
  let currentHandle: V1WatchHandle | null = null;
  let pendingRestart: ReturnType<typeof setTimeout> | undefined;
  let lastBlockAtMs = Date.now();
  let lastVisibility: "visible" | "hidden" = visibility.state();

  /**
   * Start (or restart) the watch loop. Aborts the previous loop's signal AND
   * stops the previous handle BEFORE awaiting the new starter, so the next
   * loop starts against a torn-down predecessor. A newer restart racing past
   * us during `await` is detected via `currentAbort !== ctl` and the resolved
   * handle is discarded (stopped).
   */
  const runOnce = async (cause: string, propagateError: boolean): Promise<void> => {
    if (stopped) return;
    currentAbort?.abort();
    const prevHandle = currentHandle;
    currentHandle = null;
    prevHandle?.stop();

    const ctl = new AbortController();
    currentAbort = ctl;

    log(`watch (re)start: cause=${cause}`);
    let next: V1WatchHandle;
    try {
      next = await opts.start(ctl.signal);
    } catch (error) {
      if (ctl.signal.aborted || stopped) return;
      if (propagateError) throw error;
      log(`watch restart FAILED (cause=${cause}): ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    if (stopped || ctl.signal.aborted || currentAbort !== ctl) {
      next.stop();
      return;
    }
    currentHandle = next;
    lastBlockAtMs = Date.now();
  };

  const scheduleRestart = (cause: string, delayMs: number): void => {
    if (stopped) return;
    clearTimeout(pendingRestart);
    pendingRestart = setTimeout(() => {
      pendingRestart = undefined;
      if (stopped) return;
      void runOnce(cause, false);
    }, delayMs);
  };

  // Only restart on a hidden→visible transition. Pure visible→visible or
  // hidden→hidden re-fires (rare but observed) are ignored to avoid hammering
  // the host while the page already had focus.
  const onVisibilityChange = (): void => {
    if (stopped) return;
    const next = visibility.state();
    const wasHidden = lastVisibility === "hidden";
    lastVisibility = next;
    if (next !== "visible" || !wasHidden) return;
    log("page resumed from hidden — scheduling watch restart");
    scheduleRestart("visibility-resumed", visibilityRestartDelayMs);
  };

  const offVisibility = visibility.onChange(onVisibilityChange);

  // Watchdog backstop. Some hosts go silent without flipping visibility (e.g.
  // background-app refresh on iOS), so a timed staleness check is the
  // belt-and-braces recovery path. Resets `lastBlockAtMs` after firing so a
  // single still-stuck loop doesn't trigger a restart-every-tick storm.
  const watchdog = setInterval(() => {
    if (stopped) return;
    if (visibility.state() !== "visible") return;
    const stale = Date.now() - lastBlockAtMs;
    if (stale < staleBlockMs) return;
    log(`watchdog: no block for ${Math.round(stale / 1000)}s — restarting`);
    lastBlockAtMs = Date.now();
    scheduleRestart("watchdog-stale", 0);
  }, watchdogIntervalMs);

  await runOnce("initial", true);

  return {
    noteBlock() {
      lastBlockAtMs = Date.now();
    },
    restartNow(cause: string) {
      scheduleRestart(cause, 0);
    },
    stop() {
      stopped = true;
      clearInterval(watchdog);
      clearTimeout(pendingRestart);
      pendingRestart = undefined;
      offVisibility();
      currentAbort?.abort();
      currentHandle?.stop();
      currentAbort = null;
      currentHandle = null;
    },
  };
}

/**
 * `document`-backed visibility handle. Returns a no-op stub in environments
 * without a `document` (SSR, Node tests) so the supervisor can be constructed
 * harmlessly off-browser.
 */
function defaultDocumentVisibility(): VisibilityHandle {
  if (typeof document === "undefined") {
    return {
      state: () => "visible",
      onChange: () => () => {},
    };
  }
  return {
    state: () => (document.visibilityState === "visible" ? "visible" : "hidden"),
    onChange: (listener) => {
      document.addEventListener("visibilitychange", listener);
      return () => document.removeEventListener("visibilitychange", listener);
    },
  };
}
