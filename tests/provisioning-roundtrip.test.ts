/**
 * Provisioning ↔ unlock parity. Mirrors the upload script's pure pipeline
 * (validate the plaintext bundle → encrypt the envelope) and confirms the app's
 * unlock (`resolveRemoteProcessorConfig`) decrypts it to the SAME resolved
 * config — the contract that lets the script and the SPA share one format.
 */
import { describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { bytesToHex } from "@noble/hashes/utils.js";

import { loadRemoteCredentialBundle } from "@/config.ts";
import { encryptCredentialEnvelope } from "@/shared/utils/wire/credential-envelope.ts";
import { resolveRemoteProcessorConfig } from "@/shared/api/remote-credentials.ts";

const ALICE = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";
const TOPIC_HEX = "d2cef99ad3b1681a79b73e4f806c77b63d7c06077905dd7afdb1df39e03746bf";
const ITER = 100_000;

function p256Pem(): string {
  return generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({
    type: "sec1",
    format: "pem",
  }) as string;
}

describe("provisioning round-trip", () => {
  it("encrypts a validated bundle that unlocks to the same resolved config", async () => {
    const plaintext = {
      groupId: "funkhaus-pos",
      profile: { merchantName: "Zola", merchantId: "funkhaus" },
      v1: { type: "rfc6-payments", local: { terminals: [{ terminalId: "till-1", payoutAddress: ALICE }] } },
      v2: {
        type: "coinage-key-payments",
        terminals: [{ topicId: TOPIC_HEX, terminalId: "till-1", payoutAddress: ALICE, pemFile: p256Pem() }],
      },
    };

    // 1. What the upload script does before encrypting: validate via the shared path.
    const reference = loadRemoteCredentialBundle(plaintext);

    // 2. Encrypt the full bundle JSON (script step).
    const passkey = "a-long-merchant-unlock-passphrase";
    const envelope = await encryptCredentialEnvelope(
      new TextEncoder().encode(JSON.stringify(plaintext)),
      passkey,
      ITER,
    );

    // 3. What the app does at unlock: fetch (seam) → decrypt → validate → group check.
    const resolved = await resolveRemoteProcessorConfig("funkhaus-pos", passkey, { envelope });

    // 4. The two must agree on every claim-critical field.
    expect(reference.groupId).toBe("funkhaus-pos");
    expect(resolved.profile).toEqual(reference.config.profile);
    expect(resolved.v1.mode).toEqual(reference.config.v1.mode);

    const refTerminal = reference.config.v2.terminals[0]!;
    const gotTerminal = resolved.v2.terminals[0]!;
    expect(gotTerminal.topicHex).toBe(refTerminal.topicHex);
    expect(gotTerminal.payout.hex).toBe(refTerminal.payout.hex);
    expect(bytesToHex(gotTerminal.privKey)).toBe(bytesToHex(refTerminal.privKey));
    expect(bytesToHex(gotTerminal.publicKeyUncompressed)).toBe(bytesToHex(refTerminal.publicKeyUncompressed));
  });
});
