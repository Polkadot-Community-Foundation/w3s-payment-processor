// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * Merchant-config resolution. Validates and resolves a raw credential bundle
 * (unknown JSON) into the fully-typed `ResolvedProcessorConfig` the app
 * mounts against. Pure and synchronous; throws `ProcessorConfigError` with
 * the offending field path on any defect.
 */
import {
  accountId32Hex,
  accountId32ToSs58,
  InvalidAddressError,
  isH160,
  payoutToAccountId32,
  type H160Hex,
} from "@/shared/utils/address.ts";
import { parseP256PrivateKeyPem, PemError } from "@/shared/utils/wire/pem.ts";
import { hexToBytes } from "@noble/hashes/utils.js";
import {
  ProcessorConfigError,
  type ProtocolEnablement,
  type RemoteCredentialBundle,
  type ResolvedPayout,
  type ResolvedProcessorConfig,
  type ResolvedV1Mode,
  type ResolvedV1Terminal,
  type ResolvedV2Terminal,
} from "./types.ts";

const DEFAULT_V1_TYPE = "rfc6-payments";
const DEFAULT_V2_TYPE = "coinage-key-payments";
const DEFAULT_PROTOCOL_ENABLEMENT: ProtocolEnablement = { v1Enabled: true, v2Enabled: true };

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ProcessorConfigError(path, "expected an object");
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ProcessorConfigError(path, "expected a non-empty string");
  }
  return value;
}


function asArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new ProcessorConfigError(path, "expected an array");
  }
  return value;
}

function resolvePayout(value: unknown, path: string): ResolvedPayout {
  const ss58OrHex = asString(value, path);
  try {
    const accountId32 = payoutToAccountId32(ss58OrHex);
    return {
      accountId32,
      ss58: accountId32ToSs58(accountId32),
      hex: accountId32Hex(accountId32),
    };
  } catch (error) {
    if (error instanceof InvalidAddressError) {
      throw new ProcessorConfigError(path, error.message);
    }
    throw error;
  }
}

function resolveV1Mode(v1: Record<string, unknown>): ResolvedV1Mode {
  const hasRemote = v1.remote !== undefined;
  const hasLocal = v1.local !== undefined;
  if (hasRemote === hasLocal) {
    throw new ProcessorConfigError(
      "v1",
      "enabled v1 requires exactly one of `remote` or `local` (got " +
        (hasRemote ? "both" : "neither") +
        ")",
    );
  }

  if (hasRemote) {
    const remote = asRecord(v1.remote, "v1.remote");
    const merchantRegistryAddress = asString(remote.merchantRegistryAddress, "v1.remote.merchantRegistryAddress");
    if (!isH160(merchantRegistryAddress)) {
      throw new ProcessorConfigError(
        "v1.remote.merchantRegistryAddress",
        "expected a 0x-prefixed H160 contract address",
      );
    }
    return {
      kind: "remote",
      merchantRegistryAddress: merchantRegistryAddress.toLowerCase() as H160Hex,
      groupId: asString(remote.groupId, "v1.remote.groupId"),
    };
  }

  const local = asRecord(v1.local, "v1.local");
  const rawTerminals = asArray(local.terminals, "v1.local.terminals");
  if (rawTerminals.length === 0) {
    throw new ProcessorConfigError("v1.local.terminals", "expected at least one terminal");
  }
  const terminals: ResolvedV1Terminal[] = rawTerminals.map((raw, i) => {
    const base = `v1.local.terminals[${i}]`;
    const terminal = asRecord(raw, base);
    return {
      terminalId: asString(terminal.terminalId, `${base}.terminalId`),
      displayName:
        terminal.label === undefined ? undefined : asString(terminal.label, `${base}.label`),
      payout: resolvePayout(terminal.payoutAddress, `${base}.payoutAddress`),
    };
  });
  return { kind: "local", terminals };
}

function resolveV2Terminals(v2: Record<string, unknown>): ResolvedV2Terminal[] {
  const rawTerminals = asArray(v2.terminals, "v2.terminals");
  if (rawTerminals.length === 0) {
    throw new ProcessorConfigError("v2.terminals", "expected at least one terminal when v2 is enabled");
  }

  const seenTopics = new Map<string, number>();
  return rawTerminals.map((raw, i) => {
    const base = `v2.terminals[${i}]`;
    const terminal = asRecord(raw, base);
    const rawTopicId = asString(terminal.topicId, `${base}.topicId`);
    const topicId = rawTopicId.toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(topicId)) {
      throw new ProcessorConfigError(`${base}.topicId`, "expected a 64-character hex string (the 32-byte on-wire topic)");
    }
    const topic = hexToBytes(topicId);
    const topicHex = topicId;

    const dupOf = seenTopics.get(topicHex);
    if (dupOf !== undefined) {
      throw new ProcessorConfigError(
        `${base}.topicId`,
        `derives the same topic as v2.terminals[${dupOf}].topicId — topics must be unique`,
      );
    }
    seenTopics.set(topicHex, i);

    const pemFile = asString(terminal.pemFile, `${base}.pemFile`);
    let parsedKey: { scalar: Uint8Array; publicKeyUncompressed: Uint8Array };
    try {
      parsedKey = parseP256PrivateKeyPem(pemFile);
    } catch (error) {
      if (error instanceof PemError) throw new ProcessorConfigError(`${base}.pemFile`, error.message);
      throw error;
    }

    return {
      topicId,
      topic,
      topicHex,
      terminalId: asString(terminal.terminalId, `${base}.terminalId`),
      label: terminal.label === undefined ? undefined : asString(terminal.label, `${base}.label`),
      payout: resolvePayout(terminal.payoutAddress, `${base}.payoutAddress`),
      privKey: parsedKey.scalar,
      publicKeyUncompressed: parsedKey.publicKeyUncompressed,
    };
  });
}

/**
 * Resolve and validate a `PaymentProcessorConfigInput`. Pure and synchronous:
 * PEM → P-256 scalar, topicId → topic, SS58 → AccountId32, v1 mode collapsed
 * to remote|local. Protocol listening enablement comes from env / local
 * settings, not from the decrypted credential bundle.
 */
export function loadProcessorConfig(
  raw: unknown,
  protocols: ProtocolEnablement = DEFAULT_PROTOCOL_ENABLEMENT,
): ResolvedProcessorConfig {
  const root = asRecord(raw, "config");

  const profileRaw = asRecord(root.profile, "profile");
  const profile = {
    merchantName: asString(profileRaw.merchantName, "profile.merchantName"),
    merchantId: asString(profileRaw.merchantId, "profile.merchantId"),
  };

  const v1Raw = asRecord(root.v1, "v1");
  const v1Enabled = protocols.v1Enabled;
  const v1 = {
    enabled: v1Enabled,
    type: v1Raw.type === undefined ? DEFAULT_V1_TYPE : asString(v1Raw.type, "v1.type"),
    mode: v1Enabled ? resolveV1Mode(v1Raw) : null,
  };

  const v2Raw = asRecord(root.v2, "v2");
  const v2Enabled = protocols.v2Enabled;
  const v2 = {
    enabled: v2Enabled,
    type: v2Raw.type === undefined ? DEFAULT_V2_TYPE : asString(v2Raw.type, "v2.type"),
    terminals: v2Enabled ? resolveV2Terminals(v2Raw) : [],
  };

  return { profile, v1, v2, inert: !v1Enabled && !v2Enabled };
}

/**
 * Validate a decrypted remote credential bundle: a `groupId` plus the full
 * merchant config (`profile` / `v1` / `v2` with per-terminal `pemFile`).
 * Delegates everything except the group id to `loadProcessorConfig`, so the
 * upload script (pre-encrypt) and the app (post-decrypt) share ONE validator.
 * Throws `ProcessorConfigError` with the offending field path.
 */
export function loadRemoteCredentialBundle(
  raw: unknown,
  protocols: ProtocolEnablement = DEFAULT_PROTOCOL_ENABLEMENT,
): RemoteCredentialBundle {
  const root = asRecord(raw, "credentials");
  const groupId = asString(root.groupId, "credentials.groupId");
  return { groupId, config: loadProcessorConfig(root, protocols) };
}
