/**
 * loadProcessorConfig resolution + validation. Asserts behavior (resolved
 * shapes, field-path errors, XOR, unique topics), never defaults.
 */
import { describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";

import { loadProcessorConfig, loadRemoteCredentialBundle } from "@/config.ts";
import { ProcessorConfigError } from "@/config.ts";

const ALICE = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";
const BOB = "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty";
const REGISTRY = "0x1234567890abcdef1234567890abcdef12345678";
const bothOn = { v1Enabled: true, v2Enabled: true };
const v1Only = { v1Enabled: true, v2Enabled: false };
const v2Only = { v1Enabled: false, v2Enabled: true };
const bothOff = { v1Enabled: false, v2Enabled: false };
const TOPIC_HEX = "d2cef99ad3b1681a79b73e4f806c77b63d7c06077905dd7afdb1df39e03746bf";

function p256Pem(): string {
  return generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({
    type: "sec1",
    format: "pem",
  }) as string;
}

function expectConfigError(build: () => unknown, path: string): void {
  try {
    loadProcessorConfig(build(), bothOn);
  } catch (error) {
    expect(error).toBeInstanceOf(ProcessorConfigError);
    expect((error as ProcessorConfigError).path).toBe(path);
    return;
  }
  throw new Error(`expected ProcessorConfigError at "${path}", but none thrown`);
}

const baseProfile = { merchantName: "Zola", merchantId: "funkhaus" };
const disabledV2 = { type: "coinage-key-payments", terminals: [] };
const validV1Local = { type: "rfc6-payments", local: { terminals: [{ terminalId: "till-1", label: "Bar till", payoutAddress: ALICE }] } };
const validV2 = { type: "coinage-key-payments", terminals: [{ topicId: TOPIC_HEX, terminalId: "t1", label: "Garden POS", payoutAddress: ALICE, pemFile: p256Pem() }] };

describe("loadProcessorConfig — happy paths", () => {
  it("resolves a v1-local config when v1 listening is enabled", () => {
    const resolved = loadProcessorConfig({ profile: baseProfile, v1: validV1Local, v2: disabledV2 }, v1Only);
    expect(resolved.inert).toBe(false);
    expect(resolved.v1.mode?.kind).toBe("local");
    expect(resolved.v1.type).toBe("rfc6-payments");
    if (resolved.v1.mode?.kind !== "local") throw new Error("expected local");
    expect(resolved.v1.mode.terminals[0]!.payout.accountId32.length).toBe(32);
    expect(resolved.v1.mode.terminals[0]!.displayName).toBe("Bar till");
    expect(resolved.v1.mode.terminals[0]!.payout.hex.startsWith("0x")).toBe(true);
  });

  it("resolves a v1-remote config with lowercased registry + groupId", () => {
    const resolved = loadProcessorConfig({
      profile: baseProfile,
      v1: { remote: { merchantRegistryAddress: REGISTRY.toUpperCase().replace("0X", "0x"), groupId: "funkhaus" } },
      v2: disabledV2,
    }, v1Only);
    if (resolved.v1.mode?.kind !== "remote") throw new Error("expected remote");
    expect(resolved.v1.mode.merchantRegistryAddress).toBe(REGISTRY);
    expect(resolved.v1.mode.groupId).toBe("funkhaus");
  });

  it("treats both protocols disabled by env/settings as inert", () => {
    const resolved = loadProcessorConfig({ profile: baseProfile, v1: {}, v2: disabledV2 }, bothOff);
    expect(resolved.inert).toBe(true);
    expect(resolved.v1.mode).toBeNull();
    expect(resolved.v2.terminals).toEqual([]);
  });

  it("resolves a v2 terminal when v2 listening is enabled", () => {
    const resolved = loadProcessorConfig({ profile: baseProfile, v1: {}, v2: validV2 }, v2Only);
    const terminal = resolved.v2.terminals[0]!;
    expect(terminal.topicHex).toBe(TOPIC_HEX);
    expect(terminal.topic.length).toBe(32);
    expect(terminal.privKey.length).toBe(32);
    expect(terminal.publicKeyUncompressed.length).toBe(65);
    expect(terminal.payout.accountId32.length).toBe(32);
    expect(terminal.label).toBe("Garden POS");
  });

  it("ignores invalid disabled protocol details", () => {
    const resolved = loadProcessorConfig({
      profile: baseProfile,
      v1: { local: { terminals: [] } },
      v2: { terminals: [{ topicId: "t", terminalId: "t", payoutAddress: "bad", pemFile: "bad" }] },
    }, bothOff);
    expect(resolved.inert).toBe(true);
  });
});

describe("loadProcessorConfig — field-path validation", () => {
  it("flags an empty merchantName", () => {
    expectConfigError(
      () => ({ profile: { merchantName: "", merchantId: "m" }, v1: validV1Local, v2: validV2 }),
      "profile.merchantName",
    );
  });

  it("rejects active v1 with BOTH remote and local", () => {
    expectConfigError(
      () => ({
        profile: baseProfile,
        v1: { remote: { merchantRegistryAddress: REGISTRY, groupId: "g" }, local: { terminals: [{ terminalId: "t", payoutAddress: ALICE }] } },
        v2: validV2,
      }),
      "v1",
    );
  });

  it("rejects active v1 with NEITHER remote nor local", () => {
    expectConfigError(
      () => ({ profile: baseProfile, v1: {}, v2: validV2 }),
      "v1",
    );
  });

  it("flags a non-H160 registry address", () => {
    expectConfigError(
      () => ({ profile: baseProfile, v1: { remote: { merchantRegistryAddress: "0xnope", groupId: "g" } }, v2: validV2 }),
      "v1.remote.merchantRegistryAddress",
    );
  });

  it("flags an empty v1.local.terminals", () => {
    expectConfigError(
      () => ({ profile: baseProfile, v1: { local: { terminals: [] } }, v2: validV2 }),
      "v1.local.terminals",
    );
  });

  it("flags a bad v1 local payout address", () => {
    expectConfigError(
      () => ({ profile: baseProfile, v1: { local: { terminals: [{ terminalId: "t", payoutAddress: "not-an-address" }] } }, v2: validV2 }),
      "v1.local.terminals[0].payoutAddress",
    );
  });

  it("flags empty v2.terminals when v2 is enabled", () => {
    expectConfigError(
      () => ({ profile: baseProfile, v1: validV1Local, v2: { terminals: [] } }),
      "v2.terminals",
    );
  });

  it("flags a duplicate v2 topicId", () => {
    const pem = p256Pem();
    expectConfigError(
      () => ({
        profile: baseProfile,
        v1: validV1Local,
        v2: { terminals: [
          { topicId: TOPIC_HEX, terminalId: "a", payoutAddress: ALICE, pemFile: pem },
          { topicId: TOPIC_HEX, terminalId: "b", payoutAddress: BOB, pemFile: p256Pem() },
        ] },
      }),
      "v2.terminals[1].topicId",
    );
  });

  it("flags an unparseable v2 pemFile", () => {
    expectConfigError(
      () => ({ profile: baseProfile, v1: validV1Local, v2: { terminals: [{ topicId: TOPIC_HEX, terminalId: "t", payoutAddress: ALICE, pemFile: "garbage" }] } }),
      "v2.terminals[0].pemFile",
    );
  });

  it("flags a bad v2 payout address", () => {
    expectConfigError(
      () => ({ profile: baseProfile, v1: validV1Local, v2: { terminals: [{ topicId: TOPIC_HEX, terminalId: "t", payoutAddress: "bad", pemFile: p256Pem() }] } }),
      "v2.terminals[0].payoutAddress",
    );
  });
});

describe("loadRemoteCredentialBundle", () => {
  it("returns the groupId + a fully-resolved config for a valid bundle", () => {
    const { groupId, config } = loadRemoteCredentialBundle({
      groupId: "funkhaus-pos",
      profile: baseProfile,
      v1: {},
      v2: { type: "coinage-key-payments", terminals: [{ topicId: TOPIC_HEX, terminalId: "till-1", label: "Front counter", payoutAddress: ALICE, pemFile: p256Pem() }] },
    }, v2Only);
    expect(groupId).toBe("funkhaus-pos");
    expect(config.v2.terminals[0]!.privKey.length).toBe(32);
    expect(config.v2.terminals[0]!.label).toBe("Front counter");
  });

  it("flags a missing groupId at credentials.groupId", () => {
    try {
      loadRemoteCredentialBundle({ profile: baseProfile, v1: {}, v2: disabledV2 }, bothOff);
    } catch (error) {
      expect(error).toBeInstanceOf(ProcessorConfigError);
      expect((error as ProcessorConfigError).path).toBe("credentials.groupId");
      return;
    }
    throw new Error("expected ProcessorConfigError at credentials.groupId");
  });

  it("flags an empty groupId at credentials.groupId", () => {
    try {
      loadRemoteCredentialBundle({ groupId: "", profile: baseProfile, v1: {}, v2: disabledV2 }, bothOff);
    } catch (error) {
      expect((error as ProcessorConfigError).path).toBe("credentials.groupId");
      return;
    }
    throw new Error("expected ProcessorConfigError at credentials.groupId");
  });

  it("propagates inner config field-path errors (bad v2 pemFile)", () => {
    try {
      loadRemoteCredentialBundle({
        groupId: "g",
        profile: baseProfile,
        v1: validV1Local,
        v2: { terminals: [{ topicId: TOPIC_HEX, terminalId: "t", payoutAddress: ALICE, pemFile: "garbage" }] },
      }, bothOn);
    } catch (error) {
      expect((error as ProcessorConfigError).path).toBe("v2.terminals[0].pemFile");
      return;
    }
    throw new Error("expected ProcessorConfigError at v2.terminals[0].pemFile");
  });
});
