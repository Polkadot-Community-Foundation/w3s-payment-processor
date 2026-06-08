import { describe, expect, it } from "vitest";
import type { PolkadotClient } from "polkadot-api";

import { envConfig } from "@/config.ts";
import { fetchTokenBalance } from "@/features/v1/api/balances.ts";

class MockPeopleClient {
  readonly calls: unknown[][] = [];

  constructor(private readonly account: { balance: bigint } | undefined) {}

  asPolkadotClient(): PolkadotClient {
    const calls = this.calls;
    const account = this.account;
    const unsafeApi = {
      query: {
        Assets: {
          Account: {
            async getValue(...args: unknown[]) {
              calls.push(args);
              return account;
            },
          },
        },
      },
    };
    const polkadotClient = {
      getUnsafeApi() {
        const api = unsafeApi;
        return api;
      },
    };
    return polkadotClient as unknown as PolkadotClient;
  }
}

describe("fetchTokenBalance", () => {
  it("queries the People-chain asset account at best by default", async () => {
    const client = new MockPeopleClient({ balance: 42n });
    const balance = await fetchTokenBalance(client.asPolkadotClient(), new Uint8Array(32).fill(1));

    expect(balance).toBe(42n);
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.[0]).toBe(envConfig.token.location);
    expect(typeof client.calls[0]?.[1]).toBe("string");
    expect(client.calls[0]?.[2]).toEqual({ at: "best" });
  });

  it("returns zero for accounts without an Assets.Account row", async () => {
    const client = new MockPeopleClient(undefined);
    const balance = await fetchTokenBalance(client.asPolkadotClient(), new Uint8Array(32).fill(2));

    expect(balance).toBe(0n);
    expect(client.calls[0]?.[2]).toEqual({ at: "best" });
  });

  it("allows finalized reads for callers that need them", async () => {
    const client = new MockPeopleClient({ balance: 7n });
    await fetchTokenBalance(client.asPolkadotClient(), new Uint8Array(32).fill(3), "finalized");

    expect(client.calls[0]?.[2]).toEqual({ at: "finalized" });
  });
});
