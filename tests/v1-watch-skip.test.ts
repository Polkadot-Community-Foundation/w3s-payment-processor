/**
 * startV1Watch skip-to-head: invoking the skip callback mid-catchup must jump
 * the checkpoint straight to the target head, stop scanning the remaining
 * blocks, warn about the skipped range, then hand off to the live tail.
 */
import { describe, expect, it, vi } from "vitest";
import type { PolkadotClient } from "polkadot-api";

import { startV1Watch } from "@/features/v1/api/watch.ts";

const TOKEN = { parachainId: 1, palletInstance: 1, generalIndex: 1n };

function fakeClient(head: number, opts: { eventsGetValue?: () => Promise<unknown[]>; subscribe?: () => { unsubscribe: () => void } } = {}) {
  const eventsGetValue = vi.fn(opts.eventsGetValue ?? (async () => []));
  const subscribe = vi.fn(opts.subscribe ?? (() => ({ unsubscribe: () => {} })));
  const client = {
    getFinalizedBlock: async () => ({ number: head, hash: "0xhead" }),
    _request: async (_method: string, params: [number]) => `0x${params[0]}`,
    getUnsafeApi: () => ({ query: { System: { Events: { getValue: eventsGetValue } } } }),
    finalizedBlock$: { subscribe },
    bestBlocks$: { subscribe: () => ({ unsubscribe: () => {} }) },
  } as unknown as PolkadotClient;
  return { client, eventsGetValue, subscribe };
}

describe("startV1Watch — skip to head", () => {
  it("jumps to the target head and stops scanning when skip is invoked", async () => {
    const CHECKPOINT = 100;
    const HEAD = 120;
    const { client, eventsGetValue, subscribe } = fakeClient(HEAD);

    let skip: (() => void) | null = null;
    const onBlockCalls: number[] = [];
    const progress: (number | null)[] = [];
    const warns: string[] = [];

    await startV1Watch(
      {
        client,
        token: TOKEN,
        terminalsByPayoutHex: new Map(),
        onBlock: (_events, blockNumber) => {
          onBlockCalls.push(blockNumber);
          if (onBlockCalls.length === 1) skip?.(); // skip right after the first scanned block
        },
        onWarn: (m) => warns.push(m),
        onCatchupProgress: (p) => progress.push(p ? p.currentBlock : null),
        onSkipAvailable: (s) => {
          if (s) skip = s;
        },
      },
      CHECKPOINT,
    );

    // Scanned only block 101, then jumped straight to the head — 102..119 never scanned.
    expect(onBlockCalls).toEqual([101, HEAD]);
    expect(eventsGetValue).toHaveBeenCalledTimes(1);
    // Catchup ended and the live tail subscribed.
    expect(progress.at(-1)).toBeNull();
    expect(subscribe).toHaveBeenCalledTimes(1);
    // The operator was warned the skipped range won't be recorded.
    expect(warns.some((w) => w.includes("skipped") && w.includes(String(HEAD)))).toBe(true);
  });

  it("scans every block when skip is never invoked", async () => {
    const { client, eventsGetValue } = fakeClient(105);
    const onBlockCalls: number[] = [];

    await startV1Watch(
      {
        client,
        token: TOKEN,
        terminalsByPayoutHex: new Map(),
        onBlock: (_events, blockNumber) => {
          onBlockCalls.push(blockNumber);
        },
      },
      100,
    );

    expect(onBlockCalls).toEqual([101, 102, 103, 104, 105]);
    expect(eventsGetValue).toHaveBeenCalledTimes(5);
  });

  it("stops scanning and leaves catchup state untouched once aborted (no monitor race)", async () => {
    const controller = new AbortController();
    const { client, eventsGetValue } = fakeClient(120);
    const onBlockCalls: number[] = [];
    const progress: (number | null)[] = [];

    await startV1Watch(
      {
        client,
        token: TOKEN,
        terminalsByPayoutHex: new Map(),
        onBlock: (_events, blockNumber) => {
          onBlockCalls.push(blockNumber);
          if (onBlockCalls.length === 1) controller.abort(); // replaced/unmounted mid-catchup
        },
        onCatchupProgress: (p) => progress.push(p ? p.currentBlock : null),
        signal: controller.signal,
      },
      100,
    );

    // Stopped right after the abort — never reached the head, never scanned the rest.
    expect(onBlockCalls).toEqual([101]);
    expect(onBlockCalls).not.toContain(120);
    expect(eventsGetValue).toHaveBeenCalledTimes(1);
    // The discarded monitor never clears progress to null — that would clobber the replacement.
    expect(progress.at(-1)).not.toBeNull();
  });
});

describe("startV1Watch — best-block fallback", () => {
  it("falls back to best blocks when finalized never arrives, and tails them gap-safe", async () => {
    let bestObserver: { next: (blocks: unknown) => void; error: (e: unknown) => void } | null = null;
    const client = {
      getFinalizedBlock: async () => {
        throw new Error("bridge delivers best but not finalized");
      },
      getBestBlocks: async () => [{ number: 100, hash: "0x100", parent: "0x0ff" }],
      bestBlocks$: {
        subscribe: (observer: { next: (b: unknown) => void; error: (e: unknown) => void }) => {
          bestObserver = observer;
          return { unsubscribe: () => {} };
        },
      },
      getUnsafeApi: () => ({ query: { System: { Events: { getValue: async () => [] } } } }),
      _request: async () => "0x",
    } as unknown as PolkadotClient;

    const onBlockCalls: number[] = [];
    const warns: string[] = [];
    await startV1Watch(
      {
        client,
        token: TOKEN,
        terminalsByPayoutHex: new Map(),
        onBlock: (_events, blockNumber) => {
          onBlockCalls.push(blockNumber);
        },
        onWarn: (w) => warns.push(w),
      },
      100, // checkpoint == best tip → no backfill, straight to the live tail
    );

    expect(warns.some((w) => w.includes("best blocks"))).toBe(true);
    expect(bestObserver).not.toBeNull();

    // Two batched best emissions; #100 is the already-adopted tip and must not replay.
    bestObserver!.next([{ number: 102, hash: "0x102" }, { number: 101, hash: "0x101" }, { number: 100, hash: "0x100" }]);
    await new Promise((r) => setTimeout(r, 10));
    bestObserver!.next([{ number: 104, hash: "0x104" }, { number: 103, hash: "0x103" }]);
    await new Promise((r) => setTimeout(r, 10));

    // Gap-safe, ascending, no dup of #100.
    expect(onBlockCalls).toEqual([101, 102, 103, 104]);
  });
});

describe("startV1Watch — backfill stall", () => {
  // Repro for the "stuck on 0/3213" bug: the scan runs against a direct-WS
  // client (the host bridge can't serve chain_getBlockHash). If that endpoint
  // never answers, an unbounded fetch froze catchup at 0/N forever. The fetch
  // is now stall-bounded — on a stall the scan is abandoned and the watch goes
  // live instead of hanging.
  function stallingClient(head: number) {
    const eventsGetValue = vi.fn(async () => []);
    const subscribe = vi.fn(() => ({ unsubscribe: () => {} }));
    const client = {
      getFinalizedBlock: async () => ({ number: head, hash: "0xhead" }),
      _request: () => new Promise<string>(() => {}), // chain_getBlockHash never resolves
      getUnsafeApi: () => ({ query: { System: { Events: { getValue: eventsGetValue } } } }),
      finalizedBlock$: { subscribe },
      bestBlocks$: { subscribe: () => ({ unsubscribe: () => {} }) },
    } as unknown as PolkadotClient;
    return { client, eventsGetValue, subscribe };
  }

  it("jumps to head and goes live when the scan RPC stalls (never freezes at 0/N)", async () => {
    const CHECKPOINT = 100;
    const HEAD = 3313; // a 3213-block gap, like the reported 0/3213 freeze
    const { client, eventsGetValue, subscribe } = stallingClient(HEAD);

    const onBlockCalls: number[] = [];
    const progress: (number | null)[] = [];
    const warns: string[] = [];

    await startV1Watch(
      {
        client,
        token: TOKEN,
        terminalsByPayoutHex: new Map(),
        onBlock: (_events, blockNumber) => { onBlockCalls.push(blockNumber); },
        onWarn: (w) => warns.push(w),
        onCatchupProgress: (p) => progress.push(p ? p.processedBlocks : null),
        backfillStallMs: 20,
      },
      CHECKPOINT,
    );

    // Not a single block scanned (RPC stalled), but it did NOT hang: the
    // checkpoint jumped straight to the head and the live tail subscribed.
    expect(eventsGetValue).not.toHaveBeenCalled();
    expect(onBlockCalls).toEqual([HEAD]);
    expect(warns.some((w) => w.includes("stalled"))).toBe(true);
    expect(progress.at(0)).toBe(0); // showed 0/N first…
    expect(progress.at(-1)).toBeNull(); // …then cleared, not frozen at 0
    expect(subscribe).toHaveBeenCalledTimes(1);
  });

  it("interrupts an in-flight stalled fetch on abort (no late stall-to-head)", async () => {
    const controller = new AbortController();
    const { client, eventsGetValue } = stallingClient(3313);

    const onBlockCalls: number[] = [];
    const warns: string[] = [];
    const progress: (number | null)[] = [];

    const started = startV1Watch(
      {
        client,
        token: TOKEN,
        terminalsByPayoutHex: new Map(),
        onBlock: (_events, blockNumber) => { onBlockCalls.push(blockNumber); },
        onWarn: (w) => warns.push(w),
        onCatchupProgress: (p) => progress.push(p ? p.processedBlocks : null),
        signal: controller.signal,
        backfillStallMs: 200,
      },
      100,
    );

    await new Promise((r) => setTimeout(r, 20)); // let the loop reach the stalled fetch
    controller.abort(); // abort-wired: settles the in-flight race immediately…
    await started; // …so this resolves now, not at the 200ms stall timeout
    await new Promise((r) => setTimeout(r, 300)); // past the stall window: no late fire

    // Torn down on abort: no stall warning, no head jump, catchup state left
    // untouched for the replacement monitor.
    expect(warns.some((w) => w.includes("stalled"))).toBe(false);
    expect(onBlockCalls).toEqual([]);
    expect(progress.at(-1)).not.toBeNull();
    expect(eventsGetValue).not.toHaveBeenCalled();
  });
});
