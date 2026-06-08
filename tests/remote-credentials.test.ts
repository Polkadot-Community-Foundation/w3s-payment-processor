/**
 * Remote credential unlock. Drives `resolveRemoteProcessorConfig` through the
 * `envelope` seam (no network) and asserts it fails CLOSED on every bad path
 * (wrong passkey, tamper, malformed JSON, invalid config, group mismatch) while
 * unlocking + resolving the v2 key material on the happy path. Keys are
 * generated at test time (no committed secrets).
 */
import { describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";

import { encryptCredentialEnvelope } from "@/shared/utils/wire/credential-envelope.ts";
import {
  resolveRemoteProcessorConfig,
  resolveCredentialUrl,
  RemoteCredentialsError,
} from "@/shared/api/remote-credentials.ts";

const ALICE = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";
const TOPIC_HEX = "d2cef99ad3b1681a79b73e4f806c77b63d7c06077905dd7afdb1df39e03746bf";
const ITER = 100_000;

function p256Pem(): string {
  return generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({
    type: "sec1",
    format: "pem",
  }) as string;
}

function bundle(groupId = "funkhaus-pos", pemFile = p256Pem()) {
  return {
    groupId,
    profile: { merchantName: "Zola", merchantId: "funkhaus" },
    v1: { type: "rfc6-payments", local: { terminals: [{ terminalId: "till-1", label: "Till 1", payoutAddress: ALICE }] } },
    v2: {
      type: "coinage-key-payments",
      terminals: [{ topicId: TOPIC_HEX, terminalId: "till-1", payoutAddress: ALICE, pemFile }],
    },
  };
}

function envelopeFor(value: unknown, passkey: string) {
  return encryptCredentialEnvelope(new TextEncoder().encode(JSON.stringify(value)), passkey, ITER);
}

describe("resolveCredentialUrl", () => {
  it("rewrites ipfs:// through the configured gateway", () => {
    expect(resolveCredentialUrl("ipfs://bafkcid", "https://gw.example/")).toBe(
      "https://gw.example/ipfs/bafkcid",
    );
  });

  it("passes an https:// url through unchanged", () => {
    expect(resolveCredentialUrl("https://host/creds.json", "https://gw")).toBe("https://host/creds.json");
  });

  it("throws when no source is configured", () => {
    expect(() => resolveCredentialUrl("", "https://gw")).toThrow(RemoteCredentialsError);
  });

  it("throws on an unsupported scheme", () => {
    expect(() => resolveCredentialUrl("ftp://host/x", "https://gw")).toThrow(RemoteCredentialsError);
  });
});

describe("resolveRemoteProcessorConfig — happy path", () => {
  it("unlocks and resolves v2 key material", async () => {
    const envelope = await envelopeFor(bundle("funkhaus-pos"), "pw");
    const config = await resolveRemoteProcessorConfig("funkhaus-pos", "pw", { envelope });
    expect(config.v2.enabled).toBe(true);
    const terminal = config.v2.terminals[0]!;
    expect(terminal.privKey.length).toBe(32);
    expect(terminal.publicKeyUncompressed.length).toBe(65);
    expect(terminal.payout.ss58.length).toBeGreaterThan(0);
  });

  it("trims surrounding whitespace on the entered group id", async () => {
    const envelope = await envelopeFor(bundle("funkhaus-pos"), "pw");
    const config = await resolveRemoteProcessorConfig("  funkhaus-pos  ", "pw", { envelope });
    expect(config.profile.merchantName).toBe("Zola");
  });
});

describe("resolveRemoteProcessorConfig — fails closed", () => {
  it("requires a non-empty group id and passkey", async () => {
    await expect(resolveRemoteProcessorConfig("", "pw", { envelope: {} })).rejects.toBeInstanceOf(
      RemoteCredentialsError,
    );
    await expect(resolveRemoteProcessorConfig("g", "", { envelope: {} })).rejects.toBeInstanceOf(
      RemoteCredentialsError,
    );
  });

  it("stays locked on a wrong passkey", async () => {
    const envelope = await envelopeFor(bundle("funkhaus-pos"), "right");
    await expect(
      resolveRemoteProcessorConfig("funkhaus-pos", "wrong", { envelope }),
    ).rejects.toBeInstanceOf(RemoteCredentialsError);
  });

  it("stays locked on a tampered envelope", async () => {
    const envelope = await envelopeFor(bundle("funkhaus-pos"), "pw");
    const bytes = Buffer.from(envelope.ciphertext, "base64");
    bytes[0] = bytes[0]! ^ 0xff;
    const tampered = { ...envelope, ciphertext: bytes.toString("base64") };
    await expect(
      resolveRemoteProcessorConfig("funkhaus-pos", "pw", { envelope: tampered }),
    ).rejects.toBeInstanceOf(RemoteCredentialsError);
  });

  it("stays locked when the decrypted payload is not JSON", async () => {
    const envelope = await encryptCredentialEnvelope(new TextEncoder().encode("not json {"), "pw", ITER);
    await expect(
      resolveRemoteProcessorConfig("funkhaus-pos", "pw", { envelope }),
    ).rejects.toBeInstanceOf(RemoteCredentialsError);
  });

  it("stays locked when the decrypted config is invalid (bad PEM)", async () => {
    const envelope = await envelopeFor(bundle("funkhaus-pos", "garbage-not-a-pem"), "pw");
    await expect(
      resolveRemoteProcessorConfig("funkhaus-pos", "pw", { envelope }),
    ).rejects.toBeInstanceOf(RemoteCredentialsError);
  });

  it("stays locked on a group-id mismatch even with the right passkey", async () => {
    const envelope = await envelopeFor(bundle("funkhaus-pos"), "pw");
    await expect(
      resolveRemoteProcessorConfig("a-different-group", "pw", { envelope }),
    ).rejects.toBeInstanceOf(RemoteCredentialsError);
  });
});
