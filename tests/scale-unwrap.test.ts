/**
 * Golden-vector test for the host-seam unwrap. The captured envelope below is
 * a real on-wire `statement.data` from the Polkadot Android v2 wallet
 * publishing through the host-api. The chain delivers it with an extra outer
 * `Vec<u8>` wrap; `unwrapVecPrefixIfPresent` must strip the 2-byte compact
 * prefix so the inner bytes parse cleanly as a `W3sEncryptedPayloadV1`
 * (encryptedData ‖ ephemeralPublicKey(65, prefix 0x04)).
 *
 * Pins the wire contract — if the host stops double-wrapping (or starts
 * triple-wrapping), this fails fast.
 */
import { describe, expect, it } from "vitest";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

import { readCompact, unwrapVecPrefixIfPresent } from "@/shared/utils/wire/scale.ts";
import { decodeW3sEncryptedPayloadV1 } from "@/shared/utils/wire/codec.ts";

const CAPTURED_WRAPPED =
  "150609058897ae3b2116dccd85eca234183051524857653c4c1d15f6ca307c51141df380f75c0c9b13115189cf6596f7be6f9c4e8c69f269854c95be79edb0127b4a36d95582fd15c8365130b25ec587a535707f7c738ad4ce00494088021cde502e321302fc782040f41be6ea0d88e80f3e6373f6c045f3c0c1cf27ad18a60fde56aa57052cb8e9e6b3fecd5726eb4f51336f1f49da3b1d47c8df29699c810f949b592fd43319db71c31f138f6967dbed51e7377c63a7baf96ac7fbac36903c86b1460d4e232b95841e9caa3d1432581b0375c20451538dd61bceff7787dbe2712b644f9f2dc8abe72b9ce0477f055ad2ca30b5678ea6d49b42aa0ab13cc97bd480030ed6c3298cf8d939a01548ffe192ff63fec6002db391950f1cdbf8c56ec4ddf57e7ea1f9efa5e5a15b5588f9e643d4805b803535e840076f7285314c253a0fa894d25b04e7aaa099dcd46db0c37d0b3f3c7f3d17817aabfff63c9cc6f4c021e49ff93242eb7f18b54ebfab9613173687a3b6e66c5de517ebfea001560bbb945205572a17";

describe("readCompact", () => {
  it("decodes single-byte mode (value 0..63)", () => {
    expect(readCompact(new Uint8Array([0x00]))).toEqual({ value: 0, consumed: 1 });
    expect(readCompact(new Uint8Array([0xfc]))).toEqual({ value: 63, consumed: 1 });
  });

  it("decodes two-byte mode (value 64..16383)", () => {
    // value 64 = (64<<2)|1 = 0x101 → LE 0x01 0x01
    expect(readCompact(new Uint8Array([0x01, 0x01]))).toEqual({ value: 64, consumed: 2 });
    // value 389 = (389<<2)|1 = 0x615 → LE 0x15 0x06 (the captured envelope's outer wrap)
    expect(readCompact(new Uint8Array([0x15, 0x06]))).toEqual({ value: 389, consumed: 2 });
  });

  it("returns null on an empty buffer", () => {
    expect(readCompact(new Uint8Array(0))).toBeNull();
  });

  it("returns null when a two-byte mode prefix is truncated", () => {
    expect(readCompact(new Uint8Array([0x01]))).toBeNull();
  });
});

describe("unwrapVecPrefixIfPresent", () => {
  it("strips an outer Vec<u8> when the compact prefix matches the rest of the buffer", () => {
    // compact(4)=0x10 || four bytes
    const wrapped = new Uint8Array([0x10, 0xaa, 0xbb, 0xcc, 0xdd]);
    const inner = unwrapVecPrefixIfPresent(wrapped);
    expect(bytesToHex(inner)).toBe("aabbccdd");
  });

  it("returns the input unchanged when the leading compact does not match the buffer length", () => {
    // compact(2)=0x08 || four bytes — would-be inner length 2 ≠ 4 remaining
    const bare = new Uint8Array([0x08, 0xaa, 0xbb, 0xcc, 0xdd]);
    expect(unwrapVecPrefixIfPresent(bare)).toBe(bare);
  });

  it("returns the input unchanged for an empty buffer", () => {
    const empty = new Uint8Array(0);
    expect(unwrapVecPrefixIfPresent(empty)).toBe(empty);
  });

  it("peels the captured Android-wallet envelope so it decodes as W3sEncryptedPayloadV1", () => {
    const wrapped = hexToBytes(CAPTURED_WRAPPED);
    expect(wrapped.length).toBe(391);

    const inner = unwrapVecPrefixIfPresent(wrapped);
    expect(inner.length).toBe(389);

    const envelope = decodeW3sEncryptedPayloadV1(inner);
    expect(envelope.encryptedData.length).toBe(322);
    expect(envelope.ephemeralPublicKey.length).toBe(65);
    expect(envelope.ephemeralPublicKey[0]).toBe(0x04); // uncompressed P-256 marker
  });
});
