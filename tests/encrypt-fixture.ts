/**
 * Test-only helper: mirrors the Android sender's encryption path so the
 * round-trip test can produce envelopes from TS. Ported verbatim from
 * `packages/w3s-receiver-core/tests/encrypt-fixture.ts` (imports retargeted to
 * the vendored wire modules). Production receivers never encrypt.
 */
import { gcm } from "@noble/ciphers/aes.js";
import { p256 } from "@noble/curves/nist.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";

import {
  encodeW3sEncryptedPayloadV1,
  encodeW3sPaymentDataV1,
  type W3sPaymentDataV1,
} from "@/shared/utils/wire/codec";

const EMPTY = new Uint8Array(0);

export interface FixtureInputs {
  merchantPubCompressed: Uint8Array; // 33B SEC1 compressed
  ephemeralPriv: Uint8Array; // 32B P-256 scalar (deterministic for the vector)
  iv: Uint8Array; // 12B AES-GCM IV (deterministic for the vector)
  payload: W3sPaymentDataV1;
  /**
   * Negative tests only: override the encoded plaintext to forge out-of-contract
   * bytes the validating encoder would reject (e.g. a legacy 32-byte coin).
   */
  rawPlaintext?: Uint8Array;
}

export interface FixtureOutputs {
  ephemeralPubUncompressed: Uint8Array; // 65B
  aesKey: Uint8Array; // 32B
  plaintext: Uint8Array; // SCALE(W3sPaymentDataV1)
  ciphertextWithTag: Uint8Array; // AES output (no IV prefix)
  encryptedData: Uint8Array; // iv ‖ ciphertext ‖ tag
  envelopeBytes: Uint8Array; // SCALE(W3sEncryptedPayloadV1)
}

export function buildFixture({
  merchantPubCompressed,
  ephemeralPriv,
  iv,
  payload,
  rawPlaintext,
}: FixtureInputs): FixtureOutputs {
  if (ephemeralPriv.length !== 32) {
    throw new Error(`ephemeralPriv must be 32 bytes (got ${ephemeralPriv.length})`);
  }
  if (iv.length !== 12) {
    throw new Error(`iv must be 12 bytes (got ${iv.length})`);
  }

  const ephemeralPubUncompressed = p256.getPublicKey(ephemeralPriv, /* isCompressed */ false);
  if (ephemeralPubUncompressed.length !== 65 || ephemeralPubUncompressed[0] !== 0x04) {
    throw new Error("derived ephemeral pub key unexpected shape");
  }

  const sharedPoint = p256.getSharedSecret(
    ephemeralPriv,
    merchantPubCompressed,
    /* isCompressed */ true,
  );
  const sharedSecret = sharedPoint.subarray(1, 33);
  const aesKey = hkdf(sha256, sharedSecret, EMPTY, EMPTY, 32);

  const plaintext = rawPlaintext ?? encodeW3sPaymentDataV1(payload);
  const ciphertextWithTag = gcm(aesKey, iv).encrypt(plaintext);
  const encryptedData = concat(iv, ciphertextWithTag);
  const envelopeBytes = encodeW3sEncryptedPayloadV1({
    encryptedData,
    ephemeralPublicKey: ephemeralPubUncompressed,
  });

  return {
    ephemeralPubUncompressed,
    aesKey,
    plaintext,
    ciphertextWithTag,
    encryptedData,
    envelopeBytes,
  };
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error(`hex string must have even length: ${hex}`);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) throw new Error(`invalid hex byte at ${i}: ${hex}`);
    out[i] = byte;
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((acc, a) => acc + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}
