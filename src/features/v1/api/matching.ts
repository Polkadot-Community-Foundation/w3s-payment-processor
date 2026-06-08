// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

import type { CreditSource, PaymentEvent, V1Terminal } from "@/features/v1/types.ts";

/**
 * A normalized credit to a payout account, extracted from a raw PAPI event by
 * the watch layer. Two shapes flow through here:
 *
 *  - `assets-transferred` — a pallet-assets `Transferred`; carries the asset
 *    Location (matched against the configured token).
 *  - `coinage-unloaded[-vouchers]` — a `Coinage.RecyclerUnloadedIntoExternalAsset`
 *    (or `…AndVouchers`) offboard; carries NO asset id, so it is matched by
 *    recipient only (the unload target is the configured external asset).
 *
 * Keeping matching independent of the exact decoded shapes makes it
 * unit-testable without a live chain.
 */
export interface NormalizedCredit {
  source: CreditSource;
  assetParachainId?: number;
  assetPalletInstance?: number;
  assetGeneralIndex?: bigint;
  toHex: string;
  fromHex?: string;
  amountPlanck: bigint;
}

export interface TokenMatcher {
  parachainId: number;
  palletInstance: number;
  generalIndex: bigint;
}

export function isTokenTransfer(credit: NormalizedCredit, token: TokenMatcher): boolean {
  return (
    credit.assetParachainId === token.parachainId &&
    credit.assetPalletInstance === token.palletInstance &&
    credit.assetGeneralIndex === token.generalIndex
  );
}

/** Index terminals by lowercase payout hex for O(1) recipient matching. */
export function indexTerminalsByPayout(terminals: readonly V1Terminal[]): Map<string, V1Terminal> {
  const map = new Map<string, V1Terminal>();
  for (const terminal of terminals) map.set(terminal.payout.hex.toLowerCase(), terminal);
  return map;
}

export interface TransferContext {
  blockNumber: number;
  blockHash: string;
  eventIndex: number;
  extrinsicIndex?: number;
  observedAtMs: number;
}

/**
 * Build a `PaymentEvent` when a credit lands on a watched terminal; otherwise
 * `null` (unrelated recipient, or — for an `Assets.Transferred` — the wrong
 * token). Coinage unloads are matched by recipient only.
 *
 * The dedupe id is keyed at the **extrinsic + payout** grain: a single offboard
 * emits BOTH a `Coinage.RecyclerUnloaded*` event AND its inner
 * `Assets.Transferred`, so two records in the same extrinsic crediting the same
 * payout collapse to one payment (via `filterNewEvents`). Distinct extrinsics —
 * including two separate payments in one block — stay distinct.
 */
export function buildPaymentEvent(
  credit: NormalizedCredit,
  token: TokenMatcher,
  terminalsByPayoutHex: ReadonlyMap<string, V1Terminal>,
  ctx: TransferContext,
): PaymentEvent | null {
  const terminal = terminalsByPayoutHex.get(credit.toHex.toLowerCase());
  if (!terminal) return null;
  if (credit.source === "assets-transferred" && !isTokenTransfer(credit, token)) return null;

  const scope = ctx.extrinsicIndex === undefined ? `e${ctx.eventIndex}` : `x${ctx.extrinsicIndex}`;
  return {
    paymentId: `${ctx.blockHash}:${scope}:${terminal.payout.hex}`,
    blockNumber: ctx.blockNumber,
    blockHash: ctx.blockHash,
    eventIndex: ctx.eventIndex,
    extrinsicIndex: ctx.extrinsicIndex,
    source: credit.source,
    terminalId: terminal.terminalId,
    payoutHex: terminal.payout.hex,
    fromHex: credit.fromHex,
    amountPlanck: credit.amountPlanck.toString(),
    observedAtMs: ctx.observedAtMs,
    reconciled: false,
  };
}

/**
 * Dedupe incoming events against already-known ids AND within the batch,
 * preserving order. The dedupe key is `paymentId` (extrinsic + payout), so a
 * backfill that re-scans an already-recorded block — and the Coinage/Assets
 * double-emission of a single offboard — both add nothing.
 */
export function filterNewEvents(
  knownIds: ReadonlySet<string>,
  incoming: readonly PaymentEvent[],
): PaymentEvent[] {
  const seen = new Set(knownIds);
  const fresh: PaymentEvent[] = [];
  for (const event of incoming) {
    if (seen.has(event.paymentId)) continue;
    seen.add(event.paymentId);
    fresh.push(event);
  }
  return fresh;
}
