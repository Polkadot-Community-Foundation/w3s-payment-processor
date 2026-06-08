// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * Generic contract read over pallet-revive. Vendored from
 * `apps/w3spay-admin/src/shared/api/contracts/read.ts`. Runs a
 * `ReviveApi.call(...)` dry-run, decodes with a viem ABI, and returns the
 * result wrapped in an array so callers can destructure uniformly. The caller
 * owns the PAPI client (and the chain).
 */
import { decodeFunctionResult, encodeFunctionData, type Abi } from "viem";
import { Binary, type PolkadotClient } from "polkadot-api";

import type { ReviveApiShim, ReviveCallDryRun } from "@/shared/api/contracts/types.ts";

export interface ReadContractOptions {
  readonly address: `0x${string}`;
  readonly abi: Abi;
  readonly functionName: string;
  readonly args?: ReadonlyArray<unknown>;
  readonly origin: string;
  readonly at?: "best" | "finalized";
}

export function reviveApi(unsafeApi: unknown): ReviveApiShim {
  return (unsafeApi as { apis: { ReviveApi: ReviveApiShim } }).apis.ReviveApi;
}

export function stringifyResultValue(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v));
  } catch {
    return String(value);
  }
}

export async function readContract<T = unknown>(
  client: PolkadotClient,
  options: ReadContractOptions,
): Promise<T> {
  const { address, abi, functionName, args = [], origin, at } = options;
  const calldata = encodeFunctionData({ abi, functionName, args: args as unknown[] });

  const dryRun: ReviveCallDryRun = await reviveApi(client.getUnsafeApi()).call(
    origin,
    address.toLowerCase(),
    0n,
    undefined,
    undefined,
    Binary.fromHex(calldata),
    { at: at ?? "best" },
  );

  if (!dryRun.result.success) {
    throw new Error(`contract read ${functionName} failed: ${stringifyResultValue(dryRun.result.value)}`);
  }
  if (dryRun.result.value.flags & 1) {
    throw new Error(`contract read ${functionName} reverted`);
  }

  const hex = Binary.toHex(dryRun.result.value.data);
  if (hex === "0x") {
    throw new Error(`contract read ${functionName} returned empty data; no contract at ${address}`);
  }

  const decoded = decodeFunctionResult({ abi, functionName, data: hex as `0x${string}` });
  return (Array.isArray(decoded) ? decoded : [decoded]) as unknown as T;
}
