import { describe, expect, it } from "vitest";

import {
  buildPaymentEvent,
  filterNewEvents,
  indexTerminalsByPayout,
  isTokenTransfer,
  type NormalizedCredit,
  type TokenMatcher,
} from "@/features/v1/api/matching.ts";
import { extractCredit } from "@/features/v1/api/watch.ts";
import type { PaymentEvent, V1Terminal } from "@/features/v1/types.ts";

const TOKEN: TokenMatcher = { parachainId: 1500, palletInstance: 50, generalIndex: 50_000_413n };
const PAYOUT = `0x${"a".repeat(64)}`;
const terminals: V1Terminal[] = [
  { terminalId: "till-1", payout: { accountId32: new Uint8Array(32), ss58: "x", hex: PAYOUT as `0x${string}` } },
];
const index = indexTerminalsByPayout(terminals);
const ctx = { blockNumber: 10, blockHash: "0xabc", eventIndex: 3, extrinsicIndex: 2, observedAtMs: 123 };

function assetsCredit(overrides: Partial<NormalizedCredit> = {}): NormalizedCredit {
  return {
    source: "assets-transferred",
    assetParachainId: 1500,
    assetPalletInstance: 50,
    assetGeneralIndex: 50_000_413n,
    toHex: PAYOUT,
    fromHex: `0x${"f".repeat(64)}`,
    amountPlanck: 1_000_000n,
    ...overrides,
  };
}

function coinageCredit(overrides: Partial<NormalizedCredit> = {}): NormalizedCredit {
  return { source: "coinage-unloaded", toHex: PAYOUT, amountPlanck: 1_000_000n, ...overrides };
}

describe("isTokenTransfer", () => {
  it("matches only the exact (parachain, pallet, index) tuple", () => {
    expect(isTokenTransfer(assetsCredit(), TOKEN)).toBe(true);
    expect(isTokenTransfer(assetsCredit({ assetGeneralIndex: 1n }), TOKEN)).toBe(false);
    expect(isTokenTransfer(assetsCredit({ assetParachainId: 1000 }), TOKEN)).toBe(false);
    expect(isTokenTransfer(assetsCredit({ assetPalletInstance: 51 }), TOKEN)).toBe(false);
  });
});

describe("buildPaymentEvent", () => {
  it("builds an event for a token credit, keyed at extrinsic + payout grain", () => {
    const event = buildPaymentEvent(assetsCredit(), TOKEN, index, ctx);
    expect(event).toMatchObject({
      paymentId: `0xabc:x2:${PAYOUT}`,
      source: "assets-transferred",
      terminalId: "till-1",
      payoutHex: PAYOUT,
      amountPlanck: "1000000",
      blockNumber: 10,
      extrinsicIndex: 2,
      reconciled: false,
    });
  });

  it("falls back to the event index in the id when not in an extrinsic phase", () => {
    const event = buildPaymentEvent(assetsCredit(), TOKEN, index, { ...ctx, extrinsicIndex: undefined });
    expect(event?.paymentId).toBe(`0xabc:e3:${PAYOUT}`);
  });

  it("returns null for the wrong token", () => {
    expect(buildPaymentEvent(assetsCredit({ assetGeneralIndex: 99n }), TOKEN, index, ctx)).toBeNull();
  });

  it("returns null for an unrelated recipient", () => {
    expect(buildPaymentEvent(assetsCredit({ toHex: `0x${"9".repeat(64)}` }), TOKEN, index, ctx)).toBeNull();
  });

  it("matches recipients case-insensitively", () => {
    const event = buildPaymentEvent(assetsCredit({ toHex: PAYOUT.toUpperCase().replace("0X", "0x") }), TOKEN, index, ctx);
    expect(event?.terminalId).toBe("till-1");
  });

  it("matches a Coinage unload by recipient WITHOUT a token/asset filter", () => {
    // No asset fields on a coinage credit — must still build when `to` is a payout.
    const event = buildPaymentEvent(coinageCredit(), TOKEN, index, ctx);
    expect(event).toMatchObject({ source: "coinage-unloaded", terminalId: "till-1", amountPlanck: "1000000" });
  });

  it("returns null for a Coinage unload to an unrelated recipient", () => {
    expect(buildPaymentEvent(coinageCredit({ toHex: `0x${"9".repeat(64)}` }), TOKEN, index, ctx)).toBeNull();
  });
});

describe("filterNewEvents", () => {
  const make = (id: string): PaymentEvent => ({
    paymentId: id,
    blockNumber: 1,
    blockHash: "0x0",
    eventIndex: 0,
    source: "assets-transferred",
    terminalId: "t",
    payoutHex: PAYOUT,
    amountPlanck: "1",
    observedAtMs: 0,
    reconciled: false,
  });

  it("drops ids already known and dedupes within the batch", () => {
    const known = new Set(["a"]);
    const fresh = filterNewEvents(known, [make("a"), make("b"), make("b"), make("c")]);
    expect(fresh.map((e) => e.paymentId)).toEqual(["b", "c"]);
  });

  it("collapses the Coinage + Assets double-emission of one offboard", () => {
    // Both events come from the same extrinsic crediting the same payout, so
    // buildPaymentEvent assigns them the SAME paymentId — only one survives.
    const fromAssets = buildPaymentEvent(assetsCredit(), TOKEN, index, ctx)!;
    const fromCoinage = buildPaymentEvent(coinageCredit(), TOKEN, index, ctx)!;
    expect(fromAssets.paymentId).toBe(fromCoinage.paymentId);
    expect(filterNewEvents(new Set(), [fromAssets, fromCoinage])).toHaveLength(1);
  });

  it("keeps two distinct payments to the same payout in different extrinsics", () => {
    const a = buildPaymentEvent(assetsCredit(), TOKEN, index, { ...ctx, extrinsicIndex: 2 })!;
    const b = buildPaymentEvent(assetsCredit(), TOKEN, index, { ...ctx, extrinsicIndex: 5 })!;
    expect(filterNewEvents(new Set(), [a, b])).toHaveLength(2);
  });
});

describe("extractCredit", () => {
  const ALICE_HEX = `0x${"11".repeat(32)}`;

  function record(pallet: string, variant: string, value: unknown): unknown {
    return { phase: { type: "ApplyExtrinsic", value: 1 }, event: { type: pallet, value: { type: variant, value } }, topics: [] };
  }

  const transferredValue = {
    asset_id: {
      parents: 1,
      interior: {
        type: "X3",
        value: [
          { type: "Parachain", value: 1500 },
          { type: "PalletInstance", value: 50 },
          { type: "GeneralIndex", value: 50_000_413n },
        ],
      },
    },
    from: `0x${"22".repeat(32)}`,
    to: ALICE_HEX,
    amount: 7_500_000n,
  };

  it("extracts an Assets.Transferred credit (asset location, recipient, amount)", () => {
    expect(extractCredit(record("Assets", "Transferred", transferredValue))).toEqual({
      source: "assets-transferred",
      assetParachainId: 1500,
      assetPalletInstance: 50,
      assetGeneralIndex: 50_000_413n,
      toHex: ALICE_HEX,
      fromHex: `0x${"22".repeat(32)}`,
      amountPlanck: 7_500_000n,
    });
  });

  it("extracts a Coinage.RecyclerUnloadedIntoExternalAsset credit (recipient + amount, no asset)", () => {
    expect(extractCredit(record("Coinage", "RecyclerUnloadedIntoExternalAsset", { to: ALICE_HEX, amount: 4_200_000n }))).toEqual({
      source: "coinage-unloaded",
      toHex: ALICE_HEX,
      amountPlanck: 4_200_000n,
    });
  });

  it("extracts the surplus …AndVouchers variant from external_asset_amount", () => {
    expect(
      extractCredit(
        record("Coinage", "RecyclerUnloadedIntoExternalAssetAndVouchers", {
          to: ALICE_HEX,
          external_asset_amount: 9_000_000n,
          voucher_count: 3,
        }),
      ),
    ).toEqual({ source: "coinage-unloaded-vouchers", toHex: ALICE_HEX, amountPlanck: 9_000_000n });
  });

  it("ignores non-credit Assets / Coinage variants and other pallets", () => {
    expect(extractCredit(record("Assets", "Issued", transferredValue))).toBeNull();
    expect(extractCredit(record("Coinage", "RecyclerLoaded", { to: ALICE_HEX }))).toBeNull();
    expect(extractCredit({ event: { type: "Balances", value: { type: "Transfer", value: {} } } })).toBeNull();
  });
});
