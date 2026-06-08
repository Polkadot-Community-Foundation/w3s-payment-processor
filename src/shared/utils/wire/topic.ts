// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

import { bytesToHex } from "@noble/hashes/utils.js";

/** Lowercase hex (no `0x`) of a topic — the stable key for topic→terminal maps. */
export function topicKey(topic: Uint8Array): string {
  return bytesToHex(topic);
}
