// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

import { fromBufferToBase58, getSs58AddressInfo } from "@polkadot-api/substrate-bindings";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

/** 0x-prefixed 32-byte AccountId32 (lowercase hex). */
export type AccountId32Hex = `0x${string}`;
/** 0x-prefixed 20-byte EVM/H160 address (lowercase hex). */
export type H160Hex = `0x${string}`;

/** Substrate generic SS58 prefix — the canonical encoding used app-wide. */
export const SS58_PREFIX_SUBSTRATE = 42;

const ACCOUNT_ID32_RE = /^0x[0-9a-fA-F]{64}$/;
const H160_RE = /^0x[0-9a-fA-F]{40}$/;

export class InvalidAddressError extends Error {
  override readonly name = "InvalidAddressError";
}

/**
 * Canonicalize a payout address to its 32-byte AccountId32 public key.
 * Accepts an SS58 string or a 0x-prefixed AccountId32 hex. Throws
 * `InvalidAddressError` otherwise — the single choke point that turns config
 * strings into the bytes the chain + wallet-binding checks compare on.
 */
export function payoutToAccountId32(value: string): Uint8Array {
  const trimmed = value.trim();
  if (ACCOUNT_ID32_RE.test(trimmed)) return hexToBytes(trimmed.slice(2));
  const info = getSs58AddressInfo(trimmed);
  if (info.isValid && info.publicKey.length === 32) return info.publicKey;
  throw new InvalidAddressError(
    `payout address must be SS58 or a 0x-prefixed AccountId32; got ${JSON.stringify(value)}`,
  );
}

export function accountId32ToSs58(publicKey: Uint8Array, prefix = SS58_PREFIX_SUBSTRATE): string {
  if (publicKey.length !== 32) {
    throw new InvalidAddressError(`AccountId32 must be 32 bytes; got ${publicKey.length}`);
  }
  return fromBufferToBase58(prefix)(publicKey);
}

export function accountId32Hex(publicKey: Uint8Array): AccountId32Hex {
  if (publicKey.length !== 32) {
    throw new InvalidAddressError(`AccountId32 must be 32 bytes; got ${publicKey.length}`);
  }
  return `0x${bytesToHex(publicKey)}` as AccountId32Hex;
}

export function isH160(value: string): boolean {
  return H160_RE.test(value.trim());
}

export function normalizeH160(value: string): H160Hex {
  const trimmed = value.trim();
  if (!isH160(trimmed)) throw new InvalidAddressError(`expected a 0x-prefixed H160; got ${value}`);
  return trimmed.toLowerCase() as H160Hex;
}

export function sameAccountId(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
