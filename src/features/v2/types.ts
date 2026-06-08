/** Outcome of attempting to claim a v2 payment's bearer coins. */
export type ClaimStatus = "claimed" | "claim_blocked" | "claim_failed" | "pending";

export interface ClaimResult {
  status: ClaimStatus;
  /** Human-readable reason for a non-claimed status (e.g. the R6 diagnostic). */
  diagnostic?: string;
}

/**
 * A decoded + (attempted-)claimed Coinage statement payment. `id` is the
 * payload id — the dedupe key, idempotent across restarts.
 */
export interface PaymentRecord {
  id: string;
  terminalId: string;
  /** Lowercase hex of the topic this arrived on. */
  topicHex: string;
  /** Decimal amount string from the payload ("X.YY"). */
  amount: string;
  /** Parsed integer planck of `amount`, as a decimal string. */
  amountPlanck: string;
  /** Number of bearer coins in the payment. */
  coinsCount: number;
  /** Sender wall-clock at submission (unix ms). */
  timestampMs: number;
  /** When the processor first decoded this payment (unix ms). */
  firstSeenAtMs: number;
  claimStatus: ClaimStatus;
  claimDiagnostic?: string;
  /** When a successful claim settled (unix ms). */
  claimedAtMs?: number;
  source: "v2";
}
