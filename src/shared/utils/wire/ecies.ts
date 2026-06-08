/**
 * VENDORED VERBATIM from `packages/w3s-receiver-core/src/ecies/index.ts`.
 * Keep byte-for-byte in sync — shared wire contract, pinned to the Android
 * sender and the Python reference scripts. Standalone app ⇒ copied, not
 * imported from the workspace package.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ECIES decryption for the Coinage POS receiver.
 *
 *   shared_secret = ECDH_x(merchantPriv, ephemeralPubUncompressed)   // 32B raw X
 *   aes_key       = HKDF-SHA256(IKM=shared_secret, salt=∅, info=∅, L=32)
 *   plaintext     = AES-256-GCM-decrypt(key=aes_key,
 *                                       iv=encryptedData[0..12],
 *                                       cipher_and_tag=encryptedData[12..])
 */
import { gcm } from "@noble/ciphers/aes.js";
import { p256 } from "@noble/curves/nist.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";

import {
  decodeW3sEncryptedPayloadV1,
  decodeW3sPaymentDataV1,
  type W3sEncryptedPayloadV1,
  type W3sPaymentDataV1,
} from "./codec.ts";

const IV_BYTES = 12;
const TAG_BYTES = 16;
const SHARED_SECRET_BYTES = 32;
const AES_KEY_BYTES = 32;
const COMPRESSED_PUB_BYTES = 33;
const UNCOMPRESSED_PUB_BYTES = 65;
const PRIVATE_KEY_BYTES = 32;
const EMPTY = new Uint8Array(0);

/**
 * Derive the AES-256-GCM key that protects an envelope, given the merchant's
 * P-256 private key and the sender's per-message ephemeral public key (raw
 * uncompressed `0x04 ‖ X ‖ Y`).
 */
export function deriveAesKey(
  merchantPrivKey: Uint8Array,
  ephemeralPubUncompressed: Uint8Array,
): Uint8Array {
  if (merchantPrivKey.length !== PRIVATE_KEY_BYTES) {
    throw new EciesError(
      `merchantPrivKey must be ${PRIVATE_KEY_BYTES} bytes (got ${merchantPrivKey.length})`,
    );
  }
  if (
    ephemeralPubUncompressed.length !== UNCOMPRESSED_PUB_BYTES ||
    ephemeralPubUncompressed[0] !== 0x04
  ) {
    throw new EciesError(
      `ephemeralPub must be ${UNCOMPRESSED_PUB_BYTES} bytes uncompressed (prefix 0x04)`,
    );
  }

  // @noble's getSharedSecret returns X || Y prefixed by an SEC1 tag. Force
  // compressed output and drop the prefix byte to obtain a 32-byte X —
  // byte-for-byte identical to the Java ECDH `generateSecret()` result.
  const sharedPoint = p256.getSharedSecret(
    merchantPrivKey,
    ephemeralPubUncompressed,
    /* isCompressed */ true,
  );
  if (sharedPoint.length !== COMPRESSED_PUB_BYTES) {
    throw new EciesError(
      `ECDH shared point unexpected length: ${sharedPoint.length}`,
    );
  }
  const sharedSecret = sharedPoint.subarray(1, 1 + SHARED_SECRET_BYTES);
  if (sharedSecret.length !== SHARED_SECRET_BYTES) {
    throw new EciesError(
      `derived shared secret unexpected length: ${sharedSecret.length}`,
    );
  }

  // HKDF-SHA256, empty salt, empty info, 32-byte output.
  const aesKey = hkdf(sha256, sharedSecret, EMPTY, EMPTY, AES_KEY_BYTES);
  if (aesKey.length !== AES_KEY_BYTES) {
    throw new EciesError(`HKDF output unexpected length: ${aesKey.length}`);
  }
  return aesKey;
}

/**
 * Decrypt the IV-prefixed AES-256-GCM blob. First 12 bytes are the IV; the
 * remainder is `ciphertext ‖ tag` as the Java GCM cipher emits.
 */
export function decryptAesGcmBlob(
  aesKey: Uint8Array,
  blob: Uint8Array,
): Uint8Array {
  if (aesKey.length !== AES_KEY_BYTES) {
    throw new EciesError(
      `aesKey must be ${AES_KEY_BYTES} bytes (got ${aesKey.length})`,
    );
  }
  if (blob.length < IV_BYTES + TAG_BYTES) {
    throw new EciesError(
      `encryptedData too short (need ≥${IV_BYTES + TAG_BYTES}, got ${blob.length})`,
    );
  }
  const iv = blob.subarray(0, IV_BYTES);
  const cipherAndTag = blob.subarray(IV_BYTES);
  try {
    return gcm(aesKey, iv).decrypt(cipherAndTag);
  } catch (cause) {
    throw new EciesError("AES-GCM decryption failed (bad key, IV, or tag)", {
      cause,
    });
  }
}

/**
 * End-to-end decryption: take a SCALE-encoded envelope, ECDH against the
 * merchant key, AES-GCM decrypt, and SCALE-decode the plaintext payload.
 */
export function decryptStatementData(
  merchantPrivKey: Uint8Array,
  envelopeBytes: Uint8Array,
): {
  envelope: W3sEncryptedPayloadV1;
  payload: W3sPaymentDataV1;
} {
  const envelope = decodeW3sEncryptedPayloadV1(envelopeBytes);
  const aesKey = deriveAesKey(merchantPrivKey, envelope.ephemeralPublicKey);
  const plaintext = decryptAesGcmBlob(aesKey, envelope.encryptedData);
  const payload = decodeW3sPaymentDataV1(plaintext);
  return { envelope, payload };
}

/**
 * Decompress a 33-byte SEC1-compressed P-256 public key to the 65-byte
 * uncompressed form.
 */
export function decompressP256(compressedPub: Uint8Array): Uint8Array {
  if (
    compressedPub.length !== COMPRESSED_PUB_BYTES ||
    (compressedPub[0] !== 0x02 && compressedPub[0] !== 0x03)
  ) {
    throw new EciesError(
      `compressedPub must be ${COMPRESSED_PUB_BYTES} bytes (prefix 0x02|0x03)`,
    );
  }
  const point = p256.Point.fromBytes(compressedPub);
  const out = point.toBytes(false);
  if (out.length !== UNCOMPRESSED_PUB_BYTES || out[0] !== 0x04) {
    throw new EciesError(
      `decompressed point unexpected shape (len=${out.length}, prefix=${out[0]?.toString(16) ?? "??"})`,
    );
  }
  return out;
}

/**
 * Compress a 65-byte uncompressed P-256 public key to the 33-byte SEC1 form.
 */
export function compressP256(uncompressedPub: Uint8Array): Uint8Array {
  if (
    uncompressedPub.length !== UNCOMPRESSED_PUB_BYTES ||
    uncompressedPub[0] !== 0x04
  ) {
    throw new EciesError(
      `uncompressedPub must be ${UNCOMPRESSED_PUB_BYTES} bytes (prefix 0x04)`,
    );
  }
  const point = p256.Point.fromBytes(uncompressedPub);
  return point.toBytes(true);
}

export class EciesError extends Error {
  override readonly name = "EciesError";
}
