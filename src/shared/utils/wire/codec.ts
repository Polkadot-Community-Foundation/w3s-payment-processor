// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * VENDORED VERBATIM from `packages/w3s-receiver-core/src/codec/index.ts`.
 * Keep byte-for-byte in sync — this is the shared wire contract, pinned to the
 * Android sender and the Python reference (`scripts/w3s-listener.py`,
 * `scripts/w3s-make-cheque-qr.py`). The app is standalone, so the contract is
 * copied here rather than imported from the workspace package. Do not "improve"
 * it locally without updating every peer.
 *
 * Coin secret keys are 64 bytes (`COIN_SECRET_BYTES`): the host's
 * `paymentTopUp(Coins)` only accepts 64-byte sr25519 secret keys (host-api
 * `Sr25519SecretKey = Bytes(64)`), matching the terminal-v1 reference. A
 * re-vendor MUST keep this 64 — never the legacy 32, which silently drops every
 * real cheque at decode and claims nothing.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SCALE codecs for the Coinage POS receiver wire format.
 *
 * MIRRORS — byte-for-byte — the Android sender:
 *   - W3sPaymentScale.kt:11-22  (W3sPaymentDataV1)
 *   - W3sPaymentScale.kt:29-35  (W3sEncryptedPayloadV1)
 *
 * Binding rules:
 *   - `ByteArray` without annotation → `Vec<u8>` (compact length prefix + bytes).
 *   - `ByteArray` with `@FixedLength(N)` → exactly N raw bytes, no length prefix.
 *   - `String` → `Vec<u8>` over UTF-8.
 *   - `ULong` → `u64` little-endian.
 *   - `List<T>` → SCALE `Vec<T>`.
 *
 * Field order is the contract. Do not reorder.
 */
import { Bytes, Struct, Vector, str, u64 } from "scale-ts";

/**
 * Coin secret-key length on the wire: a 64-byte sr25519 secret key (32-byte
 * scalar ‖ 32-byte nonce). This is the only length the host can claim —
 * host-api `Sr25519SecretKey = Bytes(64)`, `PaymentTopUpSource.Coins =
 * Vector(Sr25519SecretKey)`. Mirrors terminal-v1's `COIN_SECRET_BYTES`.
 */
export const COIN_SECRET_BYTES = 64;

/** Statement-store envelope. Wire field order: encryptedData, ephemeralPublicKey. */
export interface W3sEncryptedPayloadV1 {
  /** AES-256-GCM(IV(12) ‖ ciphertext ‖ tag(16)) over SCALE(W3sPaymentDataV1). */
  encryptedData: Uint8Array;
  /** Raw uncompressed P-256 point (0x04 ‖ X(32) ‖ Y(32)). Exactly 65 bytes. */
  ephemeralPublicKey: Uint8Array;
}

/** Decrypted payment payload. Wire field order: amount, timestamp, coins, id. */
export interface W3sPaymentDataV1 {
  /** Decimal string with "." separator and exactly two decimal places (HALF_UP). */
  amount: string;
  /** Sender wall-clock at submission time, in unix milliseconds. */
  timestamp: bigint;
  /**
   * Coin secret keys claimed by this payment. Each entry is a 64-byte sr25519
   * secret key (32-byte scalar ‖ 32-byte nonce) — see `COIN_SECRET_BYTES` and
   * host-api `Sr25519SecretKey = Bytes(64)`. Length-prefixed by the SCALE
   * Vec<u8> encoder; the 64-byte count is part of the contract regardless.
   */
  coins: Uint8Array[];
  /** Payment id (e.g. "<kassen-serial>/<txn>" or the raw deeplink `id`). */
  id: string;
}

/**
 * SCALE codec for the envelope. The 65-byte ephemeral pubkey is fixed-length;
 * the encrypted blob is length-prefixed.
 */
export const W3sEncryptedPayloadV1Codec = Struct({
  encryptedData: Bytes(),
  ephemeralPublicKey: Bytes(65),
});

/**
 * SCALE codec for the inner plaintext payload. `coins` is a `Vec<Vec<u8>>` —
 * each coin entry carries its own compact length prefix; every entry is a
 * 64-byte sr25519 secret key (`COIN_SECRET_BYTES`).
 */
export const W3sPaymentDataV1Codec = Struct({
  amount: str,
  timestamp: u64,
  coins: Vector(Bytes()),
  id: str,
});

export const encodeW3sEncryptedPayloadV1 = (
  payload: W3sEncryptedPayloadV1,
): Uint8Array => {
  assertEphemeralKeyShape(payload.ephemeralPublicKey);
  return W3sEncryptedPayloadV1Codec.enc(payload);
};

export const decodeW3sEncryptedPayloadV1 = (
  bytes: Uint8Array,
): W3sEncryptedPayloadV1 => {
  const decoded = W3sEncryptedPayloadV1Codec.dec(bytes);
  assertEphemeralKeyShape(decoded.ephemeralPublicKey);
  return decoded;
};

export const encodeW3sPaymentDataV1 = (
  payload: W3sPaymentDataV1,
): Uint8Array => {
  assertAmountShape(payload.amount);
  for (const coin of payload.coins) {
    if (coin.length !== COIN_SECRET_BYTES) {
      throw new CodecError(
        `coins[i] must be exactly ${COIN_SECRET_BYTES} bytes (got ${coin.length})`,
      );
    }
  }
  return W3sPaymentDataV1Codec.enc(payload);
};

export const decodeW3sPaymentDataV1 = (
  bytes: Uint8Array,
): W3sPaymentDataV1 => {
  const decoded = W3sPaymentDataV1Codec.dec(bytes);
  assertAmountShape(decoded.amount);
  for (const [i, coin] of decoded.coins.entries()) {
    if (coin.length !== COIN_SECRET_BYTES) {
      throw new CodecError(
        `coins[${i}] must be exactly ${COIN_SECRET_BYTES} bytes (got ${coin.length})`,
      );
    }
  }
  return decoded;
};

/** Thrown when bytes do not match the wire contract. */
export class CodecError extends Error {
  override readonly name = "CodecError";
}

function assertEphemeralKeyShape(bytes: Uint8Array): void {
  if (bytes.length !== 65) {
    throw new CodecError(
      `ephemeralPublicKey must be 65 bytes (got ${bytes.length})`,
    );
  }
  if (bytes[0] !== 0x04) {
    throw new CodecError(
      `ephemeralPublicKey must be uncompressed (prefix 0x04, got 0x${bytes[0]?.toString(16) ?? "??"})`,
    );
  }
}

/**
 * Sender guarantees a "X.YY" decimal: a digit run, exactly one ".", and
 * exactly two trailing digits, with no scientific notation or sign.
 */
const AMOUNT_RE = /^\d+\.\d{2}$/;
function assertAmountShape(amount: string): void {
  if (!AMOUNT_RE.test(amount)) {
    throw new CodecError(
      `amount must match /^\\d+\\.\\d{2}$/ (got ${JSON.stringify(amount)})`,
    );
  }
}
