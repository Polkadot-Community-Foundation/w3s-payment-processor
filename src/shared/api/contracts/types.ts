/**
 * Low-level pallet-revive contract types. Vendored from
 * `apps/w3spay-admin/src/shared/api/contracts/types.ts`. PAPI v2's
 * `getUnsafeApi()` returns runtime-API results as `unknown`; helpers cast at
 * the boundary into these shapes.
 */

/** Shape of `ReviveApi.call(...)` dry-run response. */
export interface ReviveCallDryRun {
  readonly weight_required: {
    readonly ref_time: bigint;
    readonly proof_size: bigint;
  };
  readonly storage_deposit: {
    readonly type: "Charge" | "Refund";
    readonly value: bigint;
  };
  readonly result:
    | {
        readonly success: true;
        readonly value: {
          readonly flags: number;
          readonly data: Uint8Array;
        };
      }
    | {
        readonly success: false;
        readonly value: unknown;
      };
}

/** Substrate `sp_weights::Weight` (v2) shape for the `gasLimit` argument. */
export interface WeightV2 {
  readonly ref_time: bigint;
  readonly proof_size: bigint;
}

/** Narrowed view of `client.getUnsafeApi().apis.ReviveApi`. */
export interface ReviveApiShim {
  call(
    origin: string,
    dest: string,
    value: bigint,
    gasLimit: WeightV2 | undefined,
    storageDepositLimit: bigint | undefined,
    data: Uint8Array,
    opts?: { at?: "best" | "finalized" },
  ): Promise<ReviveCallDryRun>;
  address(ss58: string): Promise<`0x${string}` | null | undefined>;
}
