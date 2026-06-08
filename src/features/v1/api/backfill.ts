export interface BackfillPlan {
  /** First block (inclusive) to re-scan. */
  from: number;
  /** Last block (inclusive) to re-scan = the current finalized head. */
  to: number;
  /** True when the gap exceeded `maxSpan` and older blocks are not re-scanned. */
  truncated: boolean;
}

/** Default cap on a single resume scan, so a long downtime can't stall boot. */
export const DEFAULT_MAX_BACKFILL_SPAN = 5_000;

/**
 * Compute the inclusive block range to re-scan on resume.
 *
 * - No checkpoint (first ever run): `null` — start live from the head, never
 *   deep-scan chain history.
 * - Caught up or a reorg-shrunk head (`head <= checkpoint`): `null`.
 * - Otherwise `[checkpoint + 1, head]`, capped to the most recent `maxSpan`
 *   blocks (with `truncated: true`) so a huge gap doesn't block startup.
 */
export function backfillRange(
  checkpoint: number | undefined,
  head: number,
  maxSpan: number = DEFAULT_MAX_BACKFILL_SPAN,
): BackfillPlan | null {
  if (head <= 0) return null;
  if (checkpoint === undefined) return null;
  if (head <= checkpoint) return null;
  const from = checkpoint + 1;
  const span = head - from + 1;
  if (span <= maxSpan) return { from, to: head, truncated: false };
  return { from: head - maxSpan + 1, to: head, truncated: true };
}
