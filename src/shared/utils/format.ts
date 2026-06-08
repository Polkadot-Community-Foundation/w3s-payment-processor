/**
 * Planck ↔ decimal-string conversion. All amounts on-chain and on the wire are
 * integer planck (`10^decimals` sub-units); the UI and the claim engine convert
 * at these two choke points. BigInt throughout — never floats.
 */

/** Format an integer planck amount as a trimmed decimal string ("12.34", "5"). */
export function formatPlanck(planck: bigint, decimals: number): string {
  const negative = planck < 0n;
  const abs = negative ? -planck : planck;
  const scale = 10n ** BigInt(decimals);
  const whole = abs / scale;
  const fraction = (abs % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  const body = fraction.length > 0 ? `${whole}.${fraction}` : whole.toString();
  return negative ? `-${body}` : body;
}

/**
 * Parse a non-negative decimal string ("12.34") into integer planck at the
 * given decimals. Throws on malformed input or more fractional digits than the
 * token supports (silent truncation would under/over-credit a claim).
 */
export function parseAmountToPlanck(amount: string, decimals: number): bigint {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(amount.trim());
  if (!match) throw new Error(`invalid amount ${JSON.stringify(amount)}`);
  const fractionDigits = match[2] ?? "";
  if (fractionDigits.length > decimals) {
    throw new Error(`amount ${JSON.stringify(amount)} has more than ${decimals} decimal places`);
  }
  const scale = 10n ** BigInt(decimals);
  const fraction = fractionDigits.padEnd(decimals, "0");
  return BigInt(match[1]!) * scale + (fraction === "" ? 0n : BigInt(fraction));
}
