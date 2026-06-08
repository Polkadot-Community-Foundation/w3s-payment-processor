import type { ClaimResult } from "@/features/v2/types.ts";

/**
 * Claims bearer coins into the host's own wallet. The SPA never signs — the
 * host credits itself via `paymentTopUp(Coins)`. Two implementations: an
 * enabled engine backed by the host payment manager, and a fail-closed disabled
 * engine (standalone, unbound, or a host SDK without the Coins variant).
 */
export interface ClaimEngine {
  /** Whether claims can actually settle (false ⇒ every claim is blocked). */
  readonly enabled: boolean;
  /** When disabled, the reason (surfaced as the record's claim diagnostic). */
  readonly diagnostic?: string;
  claim(coins: Uint8Array[], amountPlanck: bigint): Promise<ClaimResult>;
}

/**
 * The R6 diagnostic: the host payment SDK does not expose a Coins top-up
 * source, so bearer coins cannot be claimed. The decode pipeline still runs and
 * records `claim_blocked`; the claim is retried whenever the statement is
 * re-delivered, so a host upgrade unblocks queued payments without data loss.
 */
export const R6_NO_COINS_VARIANT =
  "R6: host payment SDK lacks the Coins top-up variant; claim blocked until the host ships it";

/**
 * Whether the host payment manager's `topUp` accepts a `{ type: 'coins' }`
 * source. True for `@novasamatech/host-api-wrapper` ≥ 0.8.x (the pinned
 * version), whose `TopUpSource` includes the coins variant. Flip to `false`
 * when building against an older SDK to exercise the R6 fail-closed path.
 */
export const HOST_SUPPORTS_COINS_TOPUP = true;

/** A claim engine that never settles — records a blocked claim with `reason`. */
export function createDisabledClaimEngine(reason: string): ClaimEngine {
  return {
    enabled: false,
    diagnostic: reason,
    claim: async () => ({ status: "claim_blocked", diagnostic: reason }),
  };
}

/** The narrow slice of the host payment manager the claim engine drives. */
export interface CoinsTopUpManager {
  topUp(amount: bigint, source: { type: "coins"; keys: Uint8Array[] }, into?: number): Promise<void>;
}

/**
 * Default upper bound on `manager.topUp`. Generous for a real chain top-up
 * (the host has to consume each coin and credit the merchant) but short
 * enough to surface a hung response within one merchant retry window — the
 * known hang case is a `PaymentTopUpErr` variant index the SDK build doesn't
 * recognize, which drops the response at `Message.dec` and leaves the
 * top-up Promise pending forever.
 */
const DEFAULT_TOPUP_TIMEOUT_MS = 30_000;

export interface CreateCoinsClaimEngineOptions {
  /** Override the default 30s top-up timeout (test seam; production uses the default). */
  timeoutMs?: number;
}

/**
 * Enabled engine: tops up the host wallet from the bearer coin keys, forwarding
 * the cheque's parsed planck `amount`. (Previously sent `0n`: the terminal-v1
 * reference treats a Coins source as "consume the keys for whatever they're
 * worth" and ignores the amount. Forwarding the claimed value lets the host
 * enforce it — at the risk of an `InsufficientFunds` / `PartialPayment`
 * rejection when the sender-asserted amount disagrees with the coins' real
 * on-chain value.) `topUp` resolving means the host accepted + cleared the
 * coins (claimed); a rejection or timeout is a recoverable `claim_failed`
 * (retried on re-delivery).
 */
export function createCoinsClaimEngine(
  manager: CoinsTopUpManager,
  options: CreateCoinsClaimEngineOptions = {},
): ClaimEngine {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TOPUP_TIMEOUT_MS;
  return {
    enabled: true,
    async claim(coins: Uint8Array[], amountPlanck: bigint): Promise<ClaimResult> {
      console.log(
        `[v2:claim] topUp(${amountPlanck}n, coins=${coins.length}) → host.coinpayment ` +
          `— host SDK builds the on-chain consume+credit tx from each 64B key`,
      );
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `host did not respond to paymentTopUp within ${timeoutMs}ms — ` +
                  `likely a host-api codec mismatch (PaymentTopUpErr variant unknown to this SDK build); ` +
                  `check the DebugPanel console for a preceding 'Transport error innerDecoder is not a function'`,
              ),
            ),
          timeoutMs,
        );
      });
      try {
        await Promise.race([
          manager.topUp(amountPlanck, { type: "coins", keys: coins }),
          timeoutPromise,
        ]);
        console.log(`[v2:claim] topUp resolved — coins credited to host wallet`);
        return { status: "claimed" };
      } catch (error) {
        const diagnostic = error instanceof Error ? error.message : String(error);
        console.warn(`[v2:claim] topUp rejected/timed out: ${diagnostic}`);
        return { status: "claim_failed", diagnostic };
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    },
  };
}

export interface ResolveClaimEngineOptions {
  inHost: boolean;
  /** Whether the bound product account matches a configured payout (binding ok). */
  bindingEnabled: boolean;
  /** Reason binding is disabled, if any. */
  bindingReason?: string;
  /** Build the host payment manager (only called when an enabled engine is selected). */
  createManager: () => CoinsTopUpManager;
  /** Override the coins-variant capability (defaults to the pinned SDK's support). */
  supportsCoinsTopUp?: boolean;
}

/**
 * Select the claim engine, failing closed in priority order: standalone →
 * unbound → SDK without Coins (R6) → enabled.
 */
export function resolveClaimEngine(options: ResolveClaimEngineOptions): ClaimEngine {
  if (!options.inHost) {
    return createDisabledClaimEngine("standalone: decode-only, no host wallet to claim into");
  }
  if (!options.bindingEnabled) {
    return createDisabledClaimEngine(options.bindingReason ?? "wallet binding failed");
  }
  if (options.supportsCoinsTopUp === false || (options.supportsCoinsTopUp === undefined && !HOST_SUPPORTS_COINS_TOPUP)) {
    return createDisabledClaimEngine(R6_NO_COINS_VARIANT);
  }
  return createCoinsClaimEngine(options.createManager());
}
