/**
 * `startWatchSupervisor` — visibility-resume + watchdog restart semantics. The
 * supervisor wraps a watch loop so iOS/host pause/resume cycles can't strand
 * the v1 chain tail (see `src/features/v1/api/watch-resilience.ts`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  startWatchSupervisor,
  type VisibilityHandle,
} from "@/features/v1/api/watch-resilience.ts";
import type { V1WatchHandle } from "@/features/v1/api/watch.ts";

interface FakeVisibility {
  handle: VisibilityHandle;
  set(next: "visible" | "hidden"): void;
  listenerCount(): number;
}

function createFakeVisibility(initial: "visible" | "hidden" = "visible"): FakeVisibility {
  let state: "visible" | "hidden" = initial;
  const listeners = new Set<() => void>();
  return {
    handle: {
      state: () => state,
      onChange(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    set(next) {
      state = next;
      for (const fn of [...listeners]) fn();
    },
    listenerCount() {
      return listeners.size;
    },
  };
}

interface FakeWatch extends V1WatchHandle {
  /** Set by the supervisor when it tears the handle down. */
  stoppedAt: number | null;
  /** The abort signal passed to the starter that produced this handle. */
  signal: AbortSignal;
}

interface FakeStarter {
  start: (signal: AbortSignal) => Promise<V1WatchHandle>;
  /** Handles in the order they were produced by `start`. */
  handles: FakeWatch[];
  /** Abort signals passed to each `start` call, in order. */
  signals: AbortSignal[];
  /** Number of `start` invocations. */
  callCount(): number;
}

function createFakeStarter(): FakeStarter {
  const handles: FakeWatch[] = [];
  const signals: AbortSignal[] = [];
  const start = async (signal: AbortSignal): Promise<V1WatchHandle> => {
    signals.push(signal);
    const handle: FakeWatch = {
      stoppedAt: null,
      signal,
      stop() {
        handle.stoppedAt = Date.now();
      },
    };
    handles.push(handle);
    return handle;
  };
  return {
    start,
    handles,
    signals,
    callCount: () => handles.length,
  };
}

describe("startWatchSupervisor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("invokes start once and propagates initial-start errors", async () => {
    const start = vi.fn().mockRejectedValueOnce(new Error("boom"));
    const visibility = createFakeVisibility();
    await expect(
      startWatchSupervisor({ start, visibility: visibility.handle }),
    ).rejects.toThrow("boom");
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("restarts the watch on visibility hidden→visible after the debounce window", async () => {
    const starter = createFakeStarter();
    const visibility = createFakeVisibility("visible");
    const sup = await startWatchSupervisor({
      start: starter.start,
      visibility: visibility.handle,
      visibilityRestartDelayMs: 100,
      // Park the watchdog so it can't race the visibility restart.
      watchdogIntervalMs: 60_000,
      staleBlockMs: 60_000,
    });

    expect(starter.callCount()).toBe(1);
    expect(visibility.listenerCount()).toBe(1);
    const first = starter.handles[0]!;

    visibility.set("hidden");
    // Hidden never triggers; only the hidden→visible transition does.
    await vi.advanceTimersByTimeAsync(50);
    expect(starter.callCount()).toBe(1);

    visibility.set("visible");
    // Still within the debounce — no restart yet.
    await vi.advanceTimersByTimeAsync(50);
    expect(starter.callCount()).toBe(1);
    // Past the debounce — restart fires.
    await vi.advanceTimersByTimeAsync(60);
    expect(starter.callCount()).toBe(2);

    // Previous loop is torn down BEFORE the new starter awaits.
    expect(first.stoppedAt).not.toBeNull();
    expect(first.signal.aborted).toBe(true);
    expect(starter.handles[1]!.signal.aborted).toBe(false);

    sup.stop();
  });

  it("ignores visible→visible re-fires while already visible", async () => {
    const starter = createFakeStarter();
    const visibility = createFakeVisibility("visible");
    const sup = await startWatchSupervisor({
      start: starter.start,
      visibility: visibility.handle,
      visibilityRestartDelayMs: 100,
      watchdogIntervalMs: 60_000,
      staleBlockMs: 60_000,
    });

    visibility.set("visible");
    await vi.advanceTimersByTimeAsync(500);
    expect(starter.callCount()).toBe(1);

    sup.stop();
  });

  it("watchdog restarts the watch when no block arrives within staleBlockMs", async () => {
    const starter = createFakeStarter();
    const visibility = createFakeVisibility("visible");
    const sup = await startWatchSupervisor({
      start: starter.start,
      visibility: visibility.handle,
      staleBlockMs: 1_000,
      watchdogIntervalMs: 250,
      visibilityRestartDelayMs: 60_000,
    });

    expect(starter.callCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(starter.callCount()).toBe(2);

    sup.stop();
  });

  it("noteBlock resets staleness so the watchdog stays quiet", async () => {
    const starter = createFakeStarter();
    const visibility = createFakeVisibility("visible");
    const sup = await startWatchSupervisor({
      start: starter.start,
      visibility: visibility.handle,
      staleBlockMs: 1_000,
      watchdogIntervalMs: 250,
      visibilityRestartDelayMs: 60_000,
    });

    // 5 × 200ms = 1s of elapsed time, but a noteBlock at each tick keeps the
    // staleness counter at 0, so the watchdog never fires.
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(200);
      sup.noteBlock();
    }
    expect(starter.callCount()).toBe(1);

    sup.stop();
  });

  it("watchdog skips its work while the page is hidden", async () => {
    const starter = createFakeStarter();
    const visibility = createFakeVisibility("hidden");
    const sup = await startWatchSupervisor({
      start: starter.start,
      visibility: visibility.handle,
      staleBlockMs: 500,
      watchdogIntervalMs: 200,
      visibilityRestartDelayMs: 60_000,
    });

    await vi.advanceTimersByTimeAsync(2_000);
    expect(starter.callCount()).toBe(1);

    sup.stop();
  });

  it("restartNow forces an immediate restart, debounce-bypassed", async () => {
    const starter = createFakeStarter();
    const visibility = createFakeVisibility("visible");
    const sup = await startWatchSupervisor({
      start: starter.start,
      visibility: visibility.handle,
      visibilityRestartDelayMs: 5_000,
      watchdogIntervalMs: 60_000,
      staleBlockMs: 60_000,
    });

    expect(starter.callCount()).toBe(1);
    sup.restartNow("manual");
    // 0-delay setTimeout still needs one tick to fire.
    await vi.advanceTimersByTimeAsync(1);
    expect(starter.callCount()).toBe(2);

    sup.stop();
  });

  it("stop() unsubscribes the visibility listener, clears timers, and stops the live handle", async () => {
    const starter = createFakeStarter();
    const visibility = createFakeVisibility();
    const sup = await startWatchSupervisor({
      start: starter.start,
      visibility: visibility.handle,
      watchdogIntervalMs: 250,
      staleBlockMs: 500,
      visibilityRestartDelayMs: 100,
    });

    expect(visibility.listenerCount()).toBe(1);
    expect(starter.handles[0]!.stoppedAt).toBeNull();

    sup.stop();
    expect(visibility.listenerCount()).toBe(0);
    expect(starter.handles[0]!.stoppedAt).not.toBeNull();
    expect(starter.handles[0]!.signal.aborted).toBe(true);

    // After stop, neither the visibility listener nor the watchdog can spawn
    // another restart.
    visibility.set("hidden");
    visibility.set("visible");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(starter.callCount()).toBe(1);
  });

  it("coalesces overlapping restart triggers — the latest one wins", async () => {
    let pendingResolve: ((handle: V1WatchHandle) => void) | null = null;
    const stoppedHandles: number[] = [];
    const signalsSeen: AbortSignal[] = [];
    let callCount = 0;

    const start = async (signal: AbortSignal): Promise<V1WatchHandle> => {
      const idx = callCount++;
      signalsSeen.push(signal);
      if (idx === 0) {
        return {
          stop() {
            stoppedHandles.push(0);
          },
        };
      }
      // Subsequent calls: hang until we explicitly resolve.
      return new Promise<V1WatchHandle>((resolve) => {
        pendingResolve = (handle) => resolve(handle);
      });
    };

    const visibility = createFakeVisibility("visible");
    const sup = await startWatchSupervisor({
      start,
      visibility: visibility.handle,
      visibilityRestartDelayMs: 5_000,
      watchdogIntervalMs: 60_000,
      staleBlockMs: 60_000,
    });

    expect(callCount).toBe(1);
    // Fire two restarts back-to-back. The second supersedes the first
    // (debounce coalesces them via clearTimeout).
    sup.restartNow("first");
    sup.restartNow("second");
    await vi.advanceTimersByTimeAsync(1);
    // The first restart got swallowed by clearTimeout, leaving only the
    // second one to invoke start().
    expect(callCount).toBe(2);

    // Resolve the hanging second-start; its handle should NOT be stopped
    // because no superseding restart raced past it.
    let resolvedHandleStopped = false;
    const resolvedHandle: V1WatchHandle = {
      stop() {
        resolvedHandleStopped = true;
      },
    };
    pendingResolve!(resolvedHandle);
    await vi.advanceTimersByTimeAsync(1);
    expect(resolvedHandleStopped).toBe(false);

    sup.stop();
    expect(resolvedHandleStopped).toBe(true);
  });

  it("discards a starter's resolved handle when a newer restart raced past during await", async () => {
    let firstResolve: ((handle: V1WatchHandle) => void) | null = null;
    const stoppedIndices: number[] = [];
    let callCount = 0;

    const start = async (_signal: AbortSignal): Promise<V1WatchHandle> => {
      const idx = callCount++;
      if (idx === 0) {
        // Hang the first start until we explicitly resolve it.
        return new Promise<V1WatchHandle>((resolve) => {
          firstResolve = (handle) => resolve(handle);
        });
      }
      return {
        stop() {
          stoppedIndices.push(idx);
        },
      };
    };

    const visibility = createFakeVisibility("visible");
    // Because the first `start` hangs, `startWatchSupervisor` would never
    // resolve. Drive a restart out-of-band by holding the supervisor's promise
    // and forcing a restart via restartNow once we have a handle.
    const supPromise = startWatchSupervisor({
      start,
      visibility: visibility.handle,
      visibilityRestartDelayMs: 1,
      watchdogIntervalMs: 60_000,
      staleBlockMs: 60_000,
    });

    // Race a restart by flipping visibility hidden→visible BEFORE the initial
    // start resolves. The supervisor schedules a restart that supersedes the
    // still-pending initial start when it eventually returns its handle.
    visibility.set("hidden");
    visibility.set("visible");
    await vi.advanceTimersByTimeAsync(2);

    // First start finally resolves with a stub handle; supervisor must stop
    // it because the second start has taken over.
    const supersededHandle: V1WatchHandle = {
      stop() {
        stoppedIndices.push(0);
      },
    };
    firstResolve!(supersededHandle);

    const sup = await supPromise;
    // Stop indices should include `0` (the superseded initial handle) but not
    // `1` (the live restart handle) until we tear down.
    expect(stoppedIndices).toContain(0);
    sup.stop();
    expect(stoppedIndices).toContain(1);
  });
});
