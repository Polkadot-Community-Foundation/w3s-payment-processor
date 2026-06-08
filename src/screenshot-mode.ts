/**
 * Screenshot mode — strict opt-in bypass that lets the harness capture the
 * actual Daybook UI without a Polkadot host bridge.
 *
 * Why this exists: the production unlock + Polkadot-host flow needs a live
 * `MessageChannel` handshake (scale-codec, multi-method) that the screenshot
 * harness can't reasonably stand up from Playwright alone. This module is the
 * single narrow seam: when `VITE_SCREENSHOT_MODE === "on"` the gates step
 * aside, the engines stay parked, and the v1/v2 Zustand stores are seeded with
 * a deterministic fixture. Every other code path is identical to production.
 *
 * Production safety:
 *   - `IS_SCREENSHOT_MODE` is `import.meta.env.VITE_SCREENSHOT_MODE === "on"`,
 *     which Vite replaces with a literal `false` in any build that doesn't set
 *     the env var. DCE then prunes every fixture and conditional in this file
 *     from the production bundle.
 *   - Nothing here decrypts secrets or talks to the chain; the placeholder
 *     keys are random bytes generated at module init.
 *
 * Per-route variations (sheets, filters, empty states) are driven by DOM
 * interactions from the Playwright capture script — this module just lays
 * down the populated baseline.
 */

import { bytesToHex } from "@noble/hashes/utils.js";
import type {
  ResolvedPayout,
  ResolvedProcessorConfig,
  ResolvedV2Terminal,
} from "@/config.ts";
import type { AccountId32Hex } from "@/shared/utils/address.ts";
import type { PaymentEvent, V1Terminal, ZReportRecord } from "@/features/v1/types.ts";
import type { PaymentRecord } from "@/features/v2/types.ts";
import { useV1Store } from "@/features/v1/store/useV1Store.ts";
import { useV2Store } from "@/features/v2/store/useV2Store.ts";

/** Flipped on only by `VITE_SCREENSHOT_MODE=on`. Any other value (incl. unset) → false. */
export const IS_SCREENSHOT_MODE: boolean = import.meta.env.VITE_SCREENSHOT_MODE === "on";

// ── Address helpers (placeholder bytes only) ──────────────────────────────
//
// In screenshot mode the v1/v2 engines never start, so these bytes never
// reach the chain or any decrypt path. SS58 strings are valid-format public
// addresses chosen for display realism only; the underlying `accountId32`
// bytes don't decode to them.

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

function makePayout(ss58: string): ResolvedPayout {
  const accountId32 = randomBytes(32);
  return {
    accountId32,
    ss58,
    hex: `0x${bytesToHex(accountId32)}` as AccountId32Hex,
  };
}

// ── Fixture: terminals ────────────────────────────────────────────────────

interface FixtureTerminal {
  terminalId: string;
  label: string;
  ss58: string;
  topicId: string;
}

const TERMINALS: readonly FixtureTerminal[] = [
  {
    terminalId: "1342061307",
    label: "Bar East",
    ss58: "5Grv6ksacxitq5hbyfoNPippBPXFyHyyZysmWQ2GaZhcQf2N",
    topicId: "d2cef99ad3b1681a79b73e4f806c77b63d7c06077905dd7afdb1df39e03746bf",
  },
  {
    terminalId: "1342061308",
    label: "Bar West",
    ss58: "5HBmRyb9CkruZpJ3HCBaUKLfYqpAQ4ND8ggJ47NhmTeyFLEW",
    topicId: "8c1f0a3e5b2d7c46a91e3f5b7d2c4a6e8f0b1c3d5a7e9c2b4d6f8a0b1c3d5e7f9",
  },
  {
    terminalId: "1342061309",
    label: "Patio",
    ss58: "5DkSh8RvLPRYY8axHmpBYqXKfwLfMxhTV9pE5JmCcWZ6tcQz",
    topicId: "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f809",
  },
] as const;

// ── Resolved config ───────────────────────────────────────────────────────
// Built once at module load. `loadProcessorConfig`'s validation pipeline is
// deliberately skipped — going through it would require a real EC PEM, and
// in screenshot mode we never decrypt anything.

function buildScreenshotConfig(): ResolvedProcessorConfig {
  const v2Terminals: ResolvedV2Terminal[] = TERMINALS.map((t) => {
    const topic = randomBytes(32);
    return {
      topicId: t.topicId,
      topic,
      topicHex: `0x${bytesToHex(topic)}`,
      terminalId: t.terminalId,
      label: t.label,
      payout: makePayout(t.ss58),
      privKey: randomBytes(32),
      publicKeyUncompressed: randomBytes(65),
    };
  });

  return {
    profile: { merchantName: "Zola", merchantId: "funkhaus" },
    v1: {
      enabled: true,
      type: "rfc6-payments",
      mode: {
        kind: "local",
        terminals: TERMINALS.map((t) => ({
          terminalId: t.terminalId,
          displayName: t.label,
          payout: makePayout(t.ss58),
        })),
      },
    },
    v2: {
      enabled: true,
      type: "coinage-key-payments",
      terminals: v2Terminals,
    },
    inert: false,
  };
}

let _config: ResolvedProcessorConfig | null = null;
export function getScreenshotConfig(): ResolvedProcessorConfig {
  if (!_config) _config = buildScreenshotConfig();
  return _config;
}

// ── Fixture: payments ─────────────────────────────────────────────────────
// The fixture aims for a believable mid-shift café day: a couple of dozen
// payments across three terminals, ranging from a $3 espresso to a $42 group
// brunch tab, weighted slightly toward Bar East. Block numbers/hashes are
// monotonic placeholders — never queried.

interface FixturePayment {
  /** Offset from the start of the shift, in minutes. */
  offsetMin: number;
  terminalIdx: 0 | 1 | 2;
  /** Amount in token units (e.g. dollars), 2 decimals. */
  amount: number;
  source: "v1" | "v2";
}

const FIXTURE_PAYMENTS: readonly FixturePayment[] = [
  { offsetMin: 12, terminalIdx: 0, amount: 4.5, source: "v1" },
  { offsetMin: 18, terminalIdx: 0, amount: 3.25, source: "v2" },
  { offsetMin: 24, terminalIdx: 1, amount: 8.0, source: "v1" },
  { offsetMin: 38, terminalIdx: 2, amount: 14.75, source: "v2" },
  { offsetMin: 47, terminalIdx: 0, amount: 4.5, source: "v1" },
  { offsetMin: 52, terminalIdx: 0, amount: 6.5, source: "v2" },
  { offsetMin: 61, terminalIdx: 1, amount: 22.0, source: "v1" },
  { offsetMin: 74, terminalIdx: 2, amount: 11.5, source: "v2" },
  { offsetMin: 83, terminalIdx: 0, amount: 5.0, source: "v1" },
  { offsetMin: 92, terminalIdx: 2, amount: 9.25, source: "v2" },
  { offsetMin: 104, terminalIdx: 0, amount: 18.5, source: "v2" },
  { offsetMin: 118, terminalIdx: 1, amount: 7.5, source: "v1" },
  { offsetMin: 126, terminalIdx: 0, amount: 4.5, source: "v1" },
  { offsetMin: 137, terminalIdx: 1, amount: 12.75, source: "v2" },
  { offsetMin: 142, terminalIdx: 2, amount: 8.0, source: "v1" },
  { offsetMin: 154, terminalIdx: 0, amount: 42.0, source: "v2" },
  { offsetMin: 168, terminalIdx: 1, amount: 6.25, source: "v1" },
  { offsetMin: 179, terminalIdx: 0, amount: 5.5, source: "v2" },
  { offsetMin: 188, terminalIdx: 2, amount: 16.5, source: "v2" },
  { offsetMin: 196, terminalIdx: 0, amount: 4.5, source: "v1" },
  { offsetMin: 208, terminalIdx: 1, amount: 9.0, source: "v1" },
  { offsetMin: 215, terminalIdx: 2, amount: 12.0, source: "v2" },
] as const;

const SHIFT_START_HOUR = 8; // 08:00 local
const TOKEN_DECIMALS = 6; // matches default envConfig.token.decimals
const BLOCK_START = 5_000_000;
const PERIOD_START_BLOCK = BLOCK_START - 100;

function shiftStartMs(): number {
  const d = new Date();
  d.setHours(SHIFT_START_HOUR, 0, 0, 0);
  return d.getTime();
}

function toPlanck(amount: number): string {
  // amount * 10^decimals, integer math via cents to avoid float drift
  const cents = Math.round(amount * 100);
  return (BigInt(cents) * 10n ** BigInt(TOKEN_DECIMALS - 2)).toString();
}

function buildV1Fixture(config: ResolvedProcessorConfig): {
  terminals: V1Terminal[];
  events: PaymentEvent[];
  balances: Record<string, string>;
  finalizedBlock: number;
  confirmedBlock: number;
} {
  if (config.v1.mode?.kind !== "local") {
    throw new Error("screenshot mode expects v1.mode.kind === 'local'");
  }
  const terminals: V1Terminal[] = config.v1.mode.terminals.map((t) => ({
    terminalId: t.terminalId,
    displayName: t.displayName,
    payout: t.payout,
    status: "active",
  }));

  const startMs = shiftStartMs();
  const events: PaymentEvent[] = [];
  const balanceTotals = new Map<string, bigint>();
  let block = BLOCK_START;

  for (const fp of FIXTURE_PAYMENTS) {
    if (fp.source !== "v1") continue;
    const t = terminals[fp.terminalIdx];
    if (!t) continue;
    const blockHash = `0x${bytesToHex(randomBytes(32))}`;
    const amountPlanck = toPlanck(fp.amount);
    events.push({
      paymentId: `${blockHash}:x0:${t.payout.hex}`,
      blockNumber: block,
      blockHash,
      eventIndex: 0,
      extrinsicIndex: 0,
      source: "assets-transferred",
      terminalId: t.terminalId,
      payoutHex: t.payout.hex,
      amountPlanck,
      observedAtMs: startMs + fp.offsetMin * 60 * 1000,
      reconciled: false,
    });
    balanceTotals.set(t.payout.hex, (balanceTotals.get(t.payout.hex) ?? 0n) + BigInt(amountPlanck));
    block += 6; // ~6 blocks between events (12s/block on a parachain)
  }

  const balances: Record<string, string> = {};
  for (const [hex, val] of balanceTotals) balances[hex] = val.toString();

  return {
    terminals,
    events,
    balances,
    finalizedBlock: block,
    confirmedBlock: block - 12, // 12 blocks behind tip (~2min)
  };
}

function buildV2Fixture(config: ResolvedProcessorConfig): PaymentRecord[] {
  const startMs = shiftStartMs();
  const out: PaymentRecord[] = [];
  let coinCounter = 0;

  for (let i = 0; i < FIXTURE_PAYMENTS.length; i++) {
    const fp = FIXTURE_PAYMENTS[i];
    if (!fp || fp.source !== "v2") continue;
    const t = config.v2.terminals[fp.terminalIdx];
    if (!t) continue;
    const ts = startMs + fp.offsetMin * 60 * 1000;
    // A handful of pending v2 claims spice up the feed without dominating it.
    const isPending = i % 7 === 3;
    out.push({
      id: `stmt-${coinCounter++}-${t.terminalId}`,
      terminalId: t.terminalId,
      topicHex: t.topicHex,
      amount: fp.amount.toFixed(2),
      amountPlanck: toPlanck(fp.amount),
      coinsCount: Math.max(1, Math.round(fp.amount / 2)),
      timestampMs: ts - 4_000, // sender clock slightly earlier than firstSeen
      firstSeenAtMs: ts,
      claimStatus: isPending ? "pending" : "claimed",
      claimedAtMs: isPending ? undefined : ts + 3_500,
      source: "v2",
    });
  }
  return out;
}

function buildZReportHistory(): ZReportRecord[] {
  // One closed-out day yesterday to populate the Reports "Past closes" list.
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(22, 0, 0, 0);
  return [
    {
      seq: 1,
      committedAtMs: yesterday.getTime(),
      source: "v1",
      fromBlock: PERIOD_START_BLOCK - 7200, // ~24h earlier in blocks
      toBlock: PERIOD_START_BLOCK,
      grandTotalPlanck: toPlanck(742.5),
      count: 38,
      lines: [
        { terminalId: "1342061307", payoutHex: "0x00".padEnd(66, "0"), totalPlanck: toPlanck(412.25), count: 19 },
        { terminalId: "1342061308", payoutHex: "0x00".padEnd(66, "1"), totalPlanck: toPlanck(218.5), count: 12 },
        { terminalId: "1342061309", payoutHex: "0x00".padEnd(66, "2"), totalPlanck: toPlanck(111.75), count: 7 },
      ],
    },
  ];
}

// ── Seed entrypoint ───────────────────────────────────────────────────────

let seeded = false;
export function seedScreenshotStores(): void {
  if (seeded) return;
  seeded = true;

  const config = getScreenshotConfig();
  const v1 = buildV1Fixture(config);
  const v2Records = buildV2Fixture(config);
  const zReports = buildZReportHistory();

  useV1Store.setState({
    status: "running",
    terminals: v1.terminals,
    events: v1.events,
    balances: v1.balances,
    balanceStatus: "ready",
    balancesUpdatedAt: Date.now(),
    reportState: { periodStartBlock: PERIOD_START_BLOCK, lastZSeq: 1 },
    zReports,
    finalizedBlock: v1.finalizedBlock,
    confirmedBlock: v1.confirmedBlock,
    catchupProgress: null,
  });

  useV2Store.setState({
    status: "running",
    records: v2Records,
    claimsEnabled: true,
    decodeFailures: 0,
    hostAccount: {
      status: "ready",
      message: "Polkadot host product account is signed in.",
      canRequestLogin: false,
      signInStatus: "idle",
    },
  });
}
