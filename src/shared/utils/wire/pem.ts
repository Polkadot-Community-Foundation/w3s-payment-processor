// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

import { p256 } from "@noble/curves/nist.js";
import { bytesToHex } from "@noble/hashes/utils.js";

/**
 * Parse a P-256 EC private key from a PEM string into the 32-byte scalar the
 * ECIES decrypt path needs.
 * Enforces P-256 (prime256v1): the curve OID is verified wherever the DER
 * carries it, and the scalar is always validated against the P-256 group by
 * deriving its public key. Anything else throws `PemError`.
 *
 * Self-contained DER walker — no `node:crypto`, no WebCrypto, no extra deps —
 * so the parser runs identically in the browser, the host webview, and tests.
 */
export class PemError extends Error {
  override readonly name = "PemError";
}

// DER tags.
const SEQUENCE = 0x30;
const INTEGER = 0x02;
const OCTET_STRING = 0x04;
const OID = 0x06;
const CONTEXT_0 = 0xa0; // [0] EXPLICIT — EC parameters in SEC1

// OID content bytes (after tag+len), lowercase hex.
const EC_PUBLIC_KEY_OID = "2a8648ce3d0201"; // 1.2.840.10045.2.1  id-ecPublicKey
const P256_CURVE_OID = "2a8648ce3d030107"; // 1.2.840.10045.3.1.7  prime256v1

interface Tlv {
  tag: number;
  contentStart: number;
  contentEnd: number;
  end: number;
}

function readTlv(der: Uint8Array, offset: number): Tlv {
  if (offset + 2 > der.length) throw new PemError("DER truncated reading tag/length");
  const tag = der[offset]!;
  let len = der[offset + 1]!;
  let cursor = offset + 2;
  if (len & 0x80) {
    const numBytes = len & 0x7f;
    if (numBytes === 0 || numBytes > 4) throw new PemError("DER unsupported length encoding");
    len = 0;
    for (let i = 0; i < numBytes; i++) {
      if (cursor >= der.length) throw new PemError("DER truncated reading long length");
      len = (len << 8) | der[cursor]!;
      cursor++;
    }
  }
  const contentEnd = cursor + len;
  if (contentEnd > der.length) throw new PemError("DER truncated reading content");
  return { tag, contentStart: cursor, contentEnd, end: contentEnd };
}

function pemToDer(pem: string): { label: string; der: Uint8Array } {
  const match = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/.exec(pem);
  if (!match) throw new PemError("not a PEM block (missing BEGIN/END markers)");
  const label = match[1]!.trim();
  const b64 = match[2]!.replace(/\s+/g, "");
  let binary: string;
  try {
    binary = atob(b64);
  } catch (cause) {
    throw new PemError("PEM body is not valid base64", { cause });
  }
  return { label, der: Uint8Array.from(binary, (ch) => ch.charCodeAt(0)) };
}

/** Pad/trim an EC private scalar to exactly 32 bytes (P-256 field width). */
function normalizeScalar(raw: Uint8Array): Uint8Array {
  if (raw.length === 32) return raw;
  if (raw.length < 32) {
    const out = new Uint8Array(32);
    out.set(raw, 32 - raw.length);
    return out;
  }
  let start = 0;
  while (start < raw.length - 32 && raw[start] === 0) start++;
  if (raw.length - start !== 32) {
    throw new PemError(`EC private scalar must be 32 bytes (got ${raw.length})`);
  }
  return raw.subarray(start);
}

/**
 * SEC1 `ECPrivateKey ::= SEQUENCE { version INTEGER, privateKey OCTET STRING,
 * [0] parameters OPTIONAL, [1] publicKey OPTIONAL }`. Verifies the curve OID
 * when the optional `[0]` parameters carry it.
 */
function parseSec1(der: Uint8Array): Uint8Array {
  const seq = readTlv(der, 0);
  if (seq.tag !== SEQUENCE) throw new PemError("SEC1: expected outer SEQUENCE");
  const version = readTlv(der, seq.contentStart);
  if (version.tag !== INTEGER) throw new PemError("SEC1: expected version INTEGER");
  const privateKey = readTlv(der, version.end);
  if (privateKey.tag !== OCTET_STRING) throw new PemError("SEC1: expected privateKey OCTET STRING");
  const scalar = normalizeScalar(der.subarray(privateKey.contentStart, privateKey.contentEnd));

  let offset = privateKey.end;
  while (offset < seq.contentEnd) {
    const field = readTlv(der, offset);
    if (field.tag === CONTEXT_0) {
      const inner = readTlv(der, field.contentStart);
      if (inner.tag === OID) {
        const hex = bytesToHex(der.subarray(inner.contentStart, inner.contentEnd));
        if (hex !== P256_CURVE_OID) {
          throw new PemError(`unsupported curve OID ${hex} (expected P-256 prime256v1)`);
        }
      }
    }
    offset = field.end;
  }
  return scalar;
}

/**
 * PKCS#8 `PrivateKeyInfo ::= SEQUENCE { version INTEGER, algorithm
 * AlgorithmIdentifier { id-ecPublicKey, namedCurve }, privateKey OCTET STRING
 * (a DER-encoded SEC1 ECPrivateKey) }`.
 */
function parsePkcs8(der: Uint8Array): Uint8Array {
  const seq = readTlv(der, 0);
  if (seq.tag !== SEQUENCE) throw new PemError("PKCS#8: expected outer SEQUENCE");
  const version = readTlv(der, seq.contentStart);
  if (version.tag !== INTEGER) throw new PemError("PKCS#8: expected version INTEGER");
  const algId = readTlv(der, version.end);
  if (algId.tag !== SEQUENCE) throw new PemError("PKCS#8: expected AlgorithmIdentifier SEQUENCE");

  const algOid = readTlv(der, algId.contentStart);
  if (algOid.tag !== OID || bytesToHex(der.subarray(algOid.contentStart, algOid.contentEnd)) !== EC_PUBLIC_KEY_OID) {
    throw new PemError("PKCS#8: algorithm is not id-ecPublicKey");
  }
  const curveOid = readTlv(der, algOid.end);
  if (curveOid.tag !== OID || bytesToHex(der.subarray(curveOid.contentStart, curveOid.contentEnd)) !== P256_CURVE_OID) {
    throw new PemError("PKCS#8: unsupported curve (expected P-256 prime256v1)");
  }

  const pkInfo = readTlv(der, algId.end);
  if (pkInfo.tag !== OCTET_STRING) throw new PemError("PKCS#8: expected privateKey OCTET STRING");
  return parseSec1(der.subarray(pkInfo.contentStart, pkInfo.contentEnd));
}

export interface ParsedP256Key {
  /** 32-byte P-256 private scalar — the merchant key for ECIES decrypt. */
  scalar: Uint8Array;
  /** Uncompressed SEC1 public point (`0x04 ‖ X ‖ Y`, 65 bytes). */
  publicKeyUncompressed: Uint8Array;
}

export function parseP256PrivateKeyPem(pem: string): ParsedP256Key {
  const { label, der } = pemToDer(pem);
  let scalar: Uint8Array;
  if (label === "EC PRIVATE KEY") {
    scalar = parseSec1(der);
  } else if (label === "PRIVATE KEY") {
    scalar = parsePkcs8(der);
  } else {
    throw new PemError(`unsupported PEM label "${label}" (expected "EC PRIVATE KEY" or "PRIVATE KEY")`);
  }

  let publicKeyUncompressed: Uint8Array;
  try {
    publicKeyUncompressed = p256.getPublicKey(scalar, false);
  } catch (cause) {
    throw new PemError("invalid P-256 private key (scalar not in group)", { cause });
  }
  return { scalar, publicKeyUncompressed };
}
