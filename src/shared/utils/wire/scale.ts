/**
 * Low-level SCALE helpers for inspecting wire-level statement-store envelopes.
 *
 * In production, the host delivers v2 ECIES envelopes via the host-api with an
 * extra outer `Vec<u8>` wrap: the chain stores the SCALE-encoded
 * `W3sEncryptedPayloadV1` inside a `data: Vec<u8>` field, and the host
 * forwards those bytes including the inner Vec's own compact-length prefix.
 * The Python reference listener peels this implicitly via `r.bytes_vec()` at
 * the statement-extraction stage; we peel explicitly at the seam so the
 * orchestrator sees a clean `W3sEncryptedPayloadV1` byte sequence regardless
 * of how the host happens to encode the surrounding field.
 */

/**
 * Decoded SCALE compact-length value plus the number of leading bytes it
 * consumed. Modes 0–2 only (values up to ~2^30 / 1 GiB) — mode 3 (big-int) is
 * not used by the statement-store wire format and is rejected so we never read
 * an unbounded length.
 */
export interface CompactRead {
  readonly value: number;
  readonly consumed: number;
}

export function readCompact(bytes: Uint8Array): CompactRead | null {
  if (bytes.length === 0) return null;
  const b0 = bytes[0]!;
  const mode = b0 & 0b11;
  if (mode === 0) return { value: b0 >> 2, consumed: 1 };
  if (mode === 1) {
    if (bytes.length < 2) return null;
    return { value: (b0 >> 2) | (bytes[1]! << 6), consumed: 2 };
  }
  if (mode === 2) {
    if (bytes.length < 4) return null;
    const value =
      (b0 >> 2) |
      (bytes[1]! << 6) |
      (bytes[2]! << 14) |
      (bytes[3]! << 22);
    return { value, consumed: 4 };
  }
  return null;
}

/**
 * Strip an outer SCALE `Vec<u8>` wrap from a byte sequence when the leading
 * compact-length prefix exactly accounts for the rest of the buffer; otherwise
 * return the input unchanged. The exact-match condition is what makes this
 * safe to apply unconditionally: a bare `W3sEncryptedPayloadV1` (where the
 * leading compact is the inner `encryptedData` length, not the whole buffer)
 * never matches and is returned as-is.
 *
 * Returns a freshly allocated `Uint8Array` (not a subarray view) so downstream
 * decoders see a buffer whose offset-0 byte is the first inner byte. scale-ts's
 * compact decoder reads from the underlying ArrayBuffer ignoring `byteOffset`,
 * so a `.subarray(n)` view would expose the stripped prefix again and break
 * inner decodes — verified empirically against the captured envelope below.
 */
export function unwrapVecPrefixIfPresent(data: Uint8Array): Uint8Array {
  const head = readCompact(data);
  if (head !== null && head.value + head.consumed === data.length) {
    return data.slice(head.consumed);
  }
  return data;
}
