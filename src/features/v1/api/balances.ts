/**
 * On-chain token balance lookup on the People-system parachain. The token is a
 * `pallet-assets` foreign asset keyed by its XCM Location, so the balance is
 * `Assets.Account(<location>, <ss58>)` → `Option<AssetAccount>`. Mirrors
 * `apps/w3spay-admin/src/features/balances/api/token-balance.ts`.
 */
import type { PolkadotClient } from "polkadot-api";

import { envConfig } from "@/config.ts"
import { accountId32ToSs58 } from "@/shared/utils/address.ts";

interface AssetAccount {
  readonly balance: bigint;
}

interface AssetsQueryShim {
  readonly Assets: {
    readonly Account: {
      getValue(
        location: typeof envConfig.token.location,
        ss58: string,
        opts?: { at?: "best" | "finalized" },
      ): Promise<AssetAccount | undefined>;
    };
  };
}

/** Default refresh cadence — matches the admin Balances tab's live query cache. */
export const TOKEN_BALANCE_TTL_MS = 60_000;

/**
 * Fetch one account's token balance in integer planck. Returns `0n` when the
 * account has never held the token (no `Assets.Account` row), so the dashboard
 * can render "0" without branching on missing rows.
 */
export async function fetchTokenBalance(
  client: PolkadotClient,
  accountId32: Uint8Array,
  at: "best" | "finalized" = "best",
): Promise<bigint> {
  const ss58 = accountId32ToSs58(accountId32);
  const query = client.getUnsafeApi().query as unknown as AssetsQueryShim;
  const account = await query.Assets.Account.getValue(envConfig.token.location, ss58, { at });
  return account?.balance ?? 0n;
}
