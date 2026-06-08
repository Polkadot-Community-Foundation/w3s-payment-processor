// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

import type { ResolvedV2Terminal } from "@/config.ts"

/**
 * Result of the v2 host-wallet availability check. Claims credit the host's
 * bound product account first; operational settlement to the configured payout
 * can happen later, so a payout mismatch is NOT a claim blocker.
 */
export interface BindingResult {
  /** True when the host product account is available for claiming. */
  claimsEnabled: boolean;
  /** Why claims are globally disabled (host unavailable), for the Notice. */
  reason?: string;
  /** Terminals currently claimable by the host wallet. */
  boundTerminalIds: Set<string>;
}

/**
 * Verify that the host exposes a bound product account. Fail-closed only when
 * the host key is unavailable / not connected. A payout mismatch no longer
 * disables claims; the host may claim first and settle to the configured
 * payout address later.
 */
export function checkWalletBinding(
  boundKey: Uint8Array | null,
  terminals: readonly ResolvedV2Terminal[],
): BindingResult {
  if (!boundKey) {
    return {
      claimsEnabled: false,
      reason: "host product account unavailable — claims disabled (decode-only)",
      boundTerminalIds: new Set(),
    };
  }
  return {
    claimsEnabled: true,
    boundTerminalIds: new Set(terminals.map((terminal) => terminal.terminalId)),
  };
}
