/**
 * Golden-vector round-trip — ported from
 * `packages/w3s-receiver-core/tests/golden-vector.test.ts`. Proves the
 * vendored wire modules decode byte-for-byte what the Android sender encodes
 * and reproduce the committed wire bytes. Any codec/ECIES drift flips these.
 */
import { describe, expect, it } from "vitest";

import { decodeW3sEncryptedPayloadV1 } from "@/shared/utils/wire/codec.ts";
import {
  compressP256,
  decompressP256,
  decryptStatementData,
  deriveAesKey,
  EciesError,
} from "@/shared/utils/wire/ecies.ts";
import { bytesToHex, buildFixture, hexToBytes } from "./encrypt-fixture.ts";
import golden from "./fixtures/golden-vector.json" with { type: "json" };

const merchantPriv = hexToBytes(golden.inputs.merchantPrivKey);
const merchantPubCompressed = hexToBytes(golden.inputs.merchantPubKeyCompressed);
const ephemeralPriv = hexToBytes(golden.inputs.ephemeralPrivKey);
const iv = hexToBytes(golden.inputs.iv);

const expectedPayload = {
  amount: golden.payload.amount,
  timestamp: BigInt(golden.payload.timestampMs),
  coins: golden.payload.coins.map(hexToBytes),
  id: golden.payload.id,
};

describe("golden vector — encode/encrypt parity (TS reproduces Android wire)", () => {
  const built = buildFixture({ merchantPubCompressed, ephemeralPriv, iv, payload: expectedPayload });

  it("derives the committed AES key (HKDF-SHA256 over ECDH-X)", () => {
    expect(bytesToHex(built.aesKey)).toBe(golden.intermediate.aesKey);
  });

  it("produces the committed SCALE plaintext", () => {
    expect(bytesToHex(built.plaintext)).toBe(golden.wire.plaintextScale);
  });

  it("produces the committed ciphertext+tag", () => {
    expect(bytesToHex(built.ciphertextWithTag)).toBe(golden.wire.ciphertextWithTag);
  });

  it("produces the committed IV-prefixed encrypted blob", () => {
    expect(bytesToHex(built.encryptedData)).toBe(golden.wire.encryptedData);
  });

  it("produces the committed SCALE envelope (the statement `data`)", () => {
    expect(bytesToHex(built.envelopeBytes)).toBe(golden.wire.envelopeBytes);
  });

  it("derives the committed uncompressed ephemeral pubkey", () => {
    expect(bytesToHex(built.ephemeralPubUncompressed)).toBe(golden.wire.ephemeralPubKeyUncompressed);
  });
});

describe("golden vector — decode/decrypt parity (live receiver path)", () => {
  const envelopeBytes = hexToBytes(golden.wire.envelopeBytes);

  it("decrypts the committed envelope to the pinned payload", () => {
    const { payload } = decryptStatementData(merchantPriv, envelopeBytes);
    expect(payload.amount).toBe(expectedPayload.amount);
    expect(payload.timestamp).toBe(expectedPayload.timestamp);
    expect(payload.id).toBe(expectedPayload.id);
    expect(payload.coins.map(bytesToHex)).toEqual(expectedPayload.coins.map(bytesToHex));
  });

  it("exposes the 65-byte uncompressed ephemeral key from the envelope", () => {
    const { envelope } = decryptStatementData(merchantPriv, envelopeBytes);
    expect(envelope.ephemeralPublicKey.length).toBe(65);
    expect(envelope.ephemeralPublicKey[0]).toBe(0x04);
    expect(bytesToHex(envelope.ephemeralPublicKey)).toBe(golden.wire.ephemeralPubKeyUncompressed);
  });

  it("derives the same AES key from the merchant private key + envelope", () => {
    const envelope = decodeW3sEncryptedPayloadV1(envelopeBytes);
    const key = deriveAesKey(merchantPriv, envelope.ephemeralPublicKey);
    expect(bytesToHex(key)).toBe(golden.intermediate.aesKey);
  });
});

describe("ECIES negative paths (must fail closed, never silently)", () => {
  const envelopeBytes = hexToBytes(golden.wire.envelopeBytes);

  it("rejects decryption under the wrong merchant key (GCM tag fails)", () => {
    const wrongKey = hexToBytes(golden.inputs.merchantPrivKey).slice();
    wrongKey[0] = (wrongKey[0] ?? 0) ^ 0xff;
    expect(() => decryptStatementData(wrongKey, envelopeBytes)).toThrow(EciesError);
  });

  it("rejects a tampered ciphertext byte (authenticity)", () => {
    const tampered = envelopeBytes.slice();
    tampered[40] = (tampered[40] ?? 0) ^ 0x01;
    expect(() => decryptStatementData(merchantPriv, tampered)).toThrow(EciesError);
  });

  it("rejects a too-short encrypted blob", () => {
    const shortBlob = new Uint8Array([
      0x20,
      ...new Array(8).fill(0xaa),
      ...decompressP256(merchantPubCompressed),
    ]);
    expect(() => decryptStatementData(merchantPriv, shortBlob)).toThrow(EciesError);
  });

  it("rejects a non-uncompressed ephemeral key in deriveAesKey", () => {
    expect(() => deriveAesKey(merchantPriv, merchantPubCompressed)).toThrow(EciesError);
  });
});

describe("P-256 point (de)compression helpers", () => {
  it("round-trips compress(decompress(x)) === x for the merchant key", () => {
    const uncompressed = decompressP256(merchantPubCompressed);
    expect(uncompressed.length).toBe(65);
    expect(uncompressed[0]).toBe(0x04);
    expect(bytesToHex(compressP256(uncompressed))).toBe(golden.inputs.merchantPubKeyCompressed);
  });

  it("rejects a malformed compressed key", () => {
    const bad = new Uint8Array(33);
    expect(() => decompressP256(bad)).toThrow(EciesError);
  });
});
