/**
 * Credential-envelope crypto: AES-256-GCM round-trip, fail-closed on wrong
 * passkey / tampering (each authenticated field), and structural rejections
 * before any key derivation. Uses the iteration floor for speed; asserts
 * behavior (authentication, freshness), never the default iteration count.
 */
import { describe, expect, it } from "vitest";

import {
  encryptCredentialEnvelope,
  decryptCredentialEnvelope,
  parseCredentialEnvelope,
  CredentialEnvelopeError,
  ENVELOPE_FORMAT,
  ENVELOPE_VERSION,
} from "@/shared/utils/wire/credential-envelope.ts";

const ITER = 100_000; // module minimum — keeps the test fast, still a real KDF
const utf8 = new TextEncoder();
const fromUtf8 = new TextDecoder();

function make(plaintext: string, passkey: string) {
  return encryptCredentialEnvelope(utf8.encode(plaintext), passkey, ITER);
}

/** Flip the first byte of a base64 field, preserving its decoded length. */
function flipBase64(value: string): string {
  const bytes = Buffer.from(value, "base64");
  bytes[0] = bytes[0]! ^ 0xff;
  return bytes.toString("base64");
}

describe("credential envelope — round-trip", () => {
  it("decrypts back to the exact plaintext with the right passkey", async () => {
    const env = await make("the bundle bytes", "correct horse battery");
    expect(env.format).toBe(ENVELOPE_FORMAT);
    expect(env.version).toBe(ENVELOPE_VERSION);
    expect(env.iterations).toBe(ITER);
    const out = await decryptCredentialEnvelope(env, "correct horse battery");
    expect(fromUtf8.decode(out)).toBe("the bundle bytes");
  });

  it("uses a fresh salt + iv per call (probabilistic ciphertext)", async () => {
    const a = await make("same plaintext", "pw");
    const b = await make("same plaintext", "pw");
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });
});

describe("credential envelope — fail closed", () => {
  it("rejects an empty passkey on encrypt and decrypt", async () => {
    await expect(make("x", "")).rejects.toBeInstanceOf(CredentialEnvelopeError);
    const env = await make("x", "pw");
    await expect(decryptCredentialEnvelope(env, "")).rejects.toBeInstanceOf(CredentialEnvelopeError);
  });

  it("rejects a wrong passkey", async () => {
    const env = await make("secret", "right");
    await expect(decryptCredentialEnvelope(env, "wrong")).rejects.toBeInstanceOf(CredentialEnvelopeError);
  });

  it("rejects a tampered ciphertext", async () => {
    const env = await make("secret", "pw");
    await expect(
      decryptCredentialEnvelope({ ...env, ciphertext: flipBase64(env.ciphertext) }, "pw"),
    ).rejects.toBeInstanceOf(CredentialEnvelopeError);
  });

  it("rejects a tampered iv", async () => {
    const env = await make("secret", "pw");
    await expect(
      decryptCredentialEnvelope({ ...env, iv: flipBase64(env.iv) }, "pw"),
    ).rejects.toBeInstanceOf(CredentialEnvelopeError);
  });

  it("rejects a tampered salt (wrong derived key)", async () => {
    const env = await make("secret", "pw");
    await expect(
      decryptCredentialEnvelope({ ...env, salt: flipBase64(env.salt) }, "pw"),
    ).rejects.toBeInstanceOf(CredentialEnvelopeError);
  });
});

describe("credential envelope — structural validation", () => {
  it("accepts a well-formed envelope", async () => {
    const env = await make("x", "pw");
    expect(parseCredentialEnvelope(env).iterations).toBe(ITER);
  });

  it("rejects a non-object", () => {
    expect(() => parseCredentialEnvelope("nope")).toThrow(CredentialEnvelopeError);
    expect(() => parseCredentialEnvelope(null)).toThrow(CredentialEnvelopeError);
  });

  it("rejects an unknown format / version / kdf / cipher", async () => {
    const env = await make("x", "pw");
    expect(() => parseCredentialEnvelope({ ...env, format: "other" })).toThrow(CredentialEnvelopeError);
    expect(() => parseCredentialEnvelope({ ...env, version: 99 })).toThrow(CredentialEnvelopeError);
    expect(() => parseCredentialEnvelope({ ...env, kdf: "scrypt" })).toThrow(CredentialEnvelopeError);
    expect(() => parseCredentialEnvelope({ ...env, cipher: "AES-128-GCM" })).toThrow(CredentialEnvelopeError);
  });

  it("rejects a weak iteration count", async () => {
    const env = await make("x", "pw");
    expect(() => parseCredentialEnvelope({ ...env, iterations: 50_000 })).toThrow(CredentialEnvelopeError);
  });

  it("rejects malformed base64 and a wrong-length iv", async () => {
    const env = await make("x", "pw");
    expect(() => parseCredentialEnvelope({ ...env, salt: "!!!notbase64!!!" })).toThrow(CredentialEnvelopeError);
    expect(() => parseCredentialEnvelope({ ...env, iv: Buffer.from([1, 2, 3]).toString("base64") })).toThrow(
      CredentialEnvelopeError,
    );
  });
});
