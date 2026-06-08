/**
 * P-256 PEM parsing. Keys are generated with node:crypto at test time (no
 * committed secrets), exported as both SEC1 and PKCS#8, and the parsed scalar
 * is checked against the JWK `d` so we know we extracted the RIGHT bytes — not
 * just 32 plausible ones. Non-P-256 curves must be rejected.
 */
import { describe, expect, it } from "vitest";
import { generateKeyPairSync, createPrivateKey, type KeyObject } from "node:crypto";
import { bytesToHex } from "@noble/hashes/utils.js";

import { parseP256PrivateKeyPem, PemError } from "@/shared/utils/wire/pem";

function scalarFromJwk(key: KeyObject): Uint8Array {
  const jwk = key.export({ format: "jwk" }) as { d?: string };
  if (!jwk.d) throw new Error("no private scalar in jwk");
  return new Uint8Array(Buffer.from(jwk.d, "base64url"));
}

describe("parseP256PrivateKeyPem", () => {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const sec1 = privateKey.export({ type: "sec1", format: "pem" }) as string;
  const pkcs8 = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  const expectedScalar = scalarFromJwk(privateKey);

  it("parses SEC1 'EC PRIVATE KEY' to the exact 32-byte scalar", () => {
    const { scalar, publicKeyUncompressed } = parseP256PrivateKeyPem(sec1);
    expect(scalar.length).toBe(32);
    expect(bytesToHex(scalar)).toBe(bytesToHex(expectedScalar));
    expect(publicKeyUncompressed.length).toBe(65);
    expect(publicKeyUncompressed[0]).toBe(0x04);
  });

  it("parses PKCS#8 'PRIVATE KEY' to the same scalar", () => {
    const { scalar } = parseP256PrivateKeyPem(pkcs8);
    expect(bytesToHex(scalar)).toBe(bytesToHex(expectedScalar));
  });

  it("SEC1 and PKCS#8 of the same key yield identical scalars", () => {
    expect(bytesToHex(parseP256PrivateKeyPem(sec1).scalar)).toBe(
      bytesToHex(parseP256PrivateKeyPem(pkcs8).scalar),
    );
  });

  it("rejects a non-P-256 curve (secp256k1) in SEC1", () => {
    const k = generateKeyPairSync("ec", { namedCurve: "secp256k1" }).privateKey;
    const pem = k.export({ type: "sec1", format: "pem" }) as string;
    expect(() => parseP256PrivateKeyPem(pem)).toThrow(PemError);
  });

  it("rejects a non-P-256 curve (secp256k1) in PKCS#8", () => {
    const k = generateKeyPairSync("ec", { namedCurve: "secp256k1" }).privateKey;
    const pem = k.export({ type: "pkcs8", format: "pem" }) as string;
    expect(() => parseP256PrivateKeyPem(pem)).toThrow(PemError);
  });

  it("rejects an RSA PKCS#8 key (not EC)", () => {
    const k = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
    const pem = k.export({ type: "pkcs8", format: "pem" }) as string;
    expect(() => parseP256PrivateKeyPem(pem)).toThrow(PemError);
  });

  it("rejects a non-PEM string", () => {
    expect(() => parseP256PrivateKeyPem("not a pem")).toThrow(PemError);
  });

  it("rejects an unknown PEM label", () => {
    const body = (createPrivateKey(pkcs8).export({ type: "pkcs8", format: "pem" }) as string)
      .replace(/PRIVATE KEY/g, "RSA PRIVATE KEY");
    expect(() => parseP256PrivateKeyPem(body)).toThrow(PemError);
  });
});
