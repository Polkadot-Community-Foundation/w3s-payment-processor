import { describe, expect, it } from "vitest";
import type { PolkadotClient } from "polkadot-api";

import { startV1Watch } from "@/features/v1/api/watch.ts";
import type { TokenMatcher } from "@/features/v1/api/matching.ts";
import type { V1CatchupProgress } from "@/features/v1/store/useV1Store.ts";

const TOKEN: TokenMatcher = { parachainId: 1500, palletInstance: 50, generalIndex: 50_000_413n };

function mockCatchupClient(headNumber: number): PolkadotClient {
  const unsafeApi = {
    query: {
      System: {
        Events: {
          async getValue(_opts: { at: string }) {
            await Promise.resolve();
            return [];
          },
        },
      },
    },
  };
  const client = {
    async getFinalizedBlock() {
      await Promise.resolve();
      return { number: headNumber, hash: `0x${headNumber.toString(16)}` };
    },
    async _request(_method: string, params: [number]) {
      await Promise.resolve();
      return `0x${params[0].toString(16)}`;
    },
    getUnsafeApi() {
      const api = unsafeApi;
      return api;
    },
    finalizedBlock$: {
      subscribe(_observer: unknown) {
        return {
          unsubscribe() {},
        };
      },
    },
    bestBlocks$: {
      subscribe(_observer: unknown) {
        return {
          unsubscribe() {},
        };
      },
    },
  };
  return client as unknown as PolkadotClient;
}

describe("startV1Watch catchup progress", () => {
  it("reports initial, per-block, and cleared progress while backfilling to the finalized head", async () => {
    const progress: Array<V1CatchupProgress | null> = [];
    const processedBlocks: number[] = [];

    const handle = await startV1Watch(
      {
        client: mockCatchupClient(103),
        token: TOKEN,
        terminalsByPayoutHex: new Map(),
        onBlock: (_events, blockNumber) => {
          processedBlocks.push(blockNumber);
        },
        onCatchupProgress: (next) => {
          progress.push(next);
        },
      },
      100,
    );
    handle.stop();

    expect(processedBlocks).toEqual([101, 102, 103]);
    expect(progress).toEqual([
      { fromBlock: 101, currentBlock: 100, targetBlock: 103, processedBlocks: 0, totalBlocks: 3, truncated: false },
      { fromBlock: 101, currentBlock: 101, targetBlock: 103, processedBlocks: 1, totalBlocks: 3, truncated: false },
      { fromBlock: 101, currentBlock: 102, targetBlock: 103, processedBlocks: 2, totalBlocks: 3, truncated: false },
      { fromBlock: 101, currentBlock: 103, targetBlock: 103, processedBlocks: 3, totalBlocks: 3, truncated: false },
      null,
    ]);
  });
});
