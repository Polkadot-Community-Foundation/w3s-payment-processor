import type { TerminalStatus } from "@/features/v1/types.ts";

/** A terminal as the back-office UI shows it (id + friendly name + lifecycle). */
export interface StreamTerminal {
  id: string;
  name: string;
  /** SS58 payout address for display. */
  address?: string;
  status?: TerminalStatus;
}

/**
 * Lifecycle of a payment as the UI shows it:
 *  - `detected`   — just landed in a best block, not yet final (gray)
 *  - `finalizing` — in the best chain, finality pending (blue)  [v2: claim pending]
 *  - `confirmed`  — finalized (green)                            [v2: claim settled]
 *  - `failed`     — v2 claim blocked/failed (red); v1 never fails
 */
export type PaymentLifecycle = "detected" | "finalizing" | "confirmed" | "failed";

/**
 * One row in the unified payment stream. Both monitor paths fold into this
 * single shape — the UI never splits "direct" vs "tap". `checkable` rows (v1)
 * carry the manual reconcile tick; v2 rows surface `attention` when a claim
 * has not settled. `status` drives the colored lifecycle pill; the detail
 * fields back the payment-detail sheet.
 */
export interface StreamPayment {
  id: string;
  terminalId: string;
  /** Token-unit amount (already converted from planck) for display + rollups. */
  amount: number;
  tsMs: number;
  source: "v1" | "v2";
  checkable: boolean;
  checked: boolean;
  attention: boolean;
  status: PaymentLifecycle;
  /** Dedupe id / payload id — the canonical reference shown in the detail sheet. */
  reference: string;
  /** v1: block the credit landed in. */
  blockNumber?: number;
  /** v1: 0x-AccountId32 of the payer, when decodable. */
  payerHex?: string;
  /** v2: number of bearer coins in the payment. */
  coinsCount?: number;
  /** v2: non-settled claim reason, when present. */
  claimNote?: string;
}

export interface TerminalTotal {
  amount: number;
  count: number;
}

/** Per-terminal + grand rollup over the open period (the X "running total"). */
export interface StreamTotals {
  perTill: Map<string, TerminalTotal>;
  grand: number;
  count: number;
}

/** A past end-of-day close (Z report), flattened for display. */
export interface ZHistoryEntry {
  seq: number;
  closedAtMs: number;
  total: number;
  count: number;
  perTill: Map<string, number>;
}
