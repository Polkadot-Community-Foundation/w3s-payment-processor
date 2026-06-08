import { describe, expect, it } from "vitest";

import { checkWalletBinding } from "@/features/v2/api/binding.ts";
import type { ResolvedV2Terminal } from "@/config.ts"

function terminal(terminalId: string, accountId32: Uint8Array): ResolvedV2Terminal {
  return {
    topicId: terminalId,
    topic: new Uint8Array(32),
    topicHex: "00".repeat(32),
    terminalId,
    payout: { accountId32, ss58: "x", hex: `0x${"0".repeat(64)}` },
    privKey: new Uint8Array(32),
    publicKeyUncompressed: new Uint8Array(65),
  };
}

const keyA = new Uint8Array(32).fill(0xaa);
const keyB = new Uint8Array(32).fill(0xbb);
const keyC = new Uint8Array(32).fill(0xcc);

describe("checkWalletBinding", () => {
  it("disables claims when the host account is unavailable (null)", () => {
    const result = checkWalletBinding(null, [terminal("t1", keyA)]);
    expect(result.claimsEnabled).toBe(false);
    expect(result.reason).toContain("unavailable");
    expect(result.boundTerminalIds.size).toBe(0);
  });

  it("enables claims even when no configured payout matches the host wallet", () => {
    const result = checkWalletBinding(keyC, [terminal("t1", keyA), terminal("t2", keyB)]);
    expect(result.claimsEnabled).toBe(true);
    expect(result.reason).toBeUndefined();
    expect([...result.boundTerminalIds].sort()).toEqual(["t1", "t2"]);
  });

  it("marks every configured terminal claimable once the host account exists", () => {
    const result = checkWalletBinding(keyA, [terminal("t1", keyA), terminal("t2", keyB), terminal("t3", keyA)]);
    expect(result.claimsEnabled).toBe(true);
    expect([...result.boundTerminalIds].sort()).toEqual(["t1", "t2", "t3"]);
  });
});
