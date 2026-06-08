import { describe, expect, it } from "vitest";

import { commitZReport, computeReport } from "@/features/v1/api/reports.ts";
import type { PaymentEvent, ReportState, V1Terminal } from "@/features/v1/types.ts";

function terminal(id: string, hex: string): V1Terminal {
  return { terminalId: id, payout: { accountId32: new Uint8Array(32), ss58: `ss58-${id}`, hex: hex as `0x${string}` } };
}

function event(id: string, terminalId: string, hex: string, blockNumber: number, amountPlanck: string): PaymentEvent {
  return {
    paymentId: id,
    blockNumber,
    blockHash: `0x${id}`,
    eventIndex: 0,
    source: "assets-transferred",
    terminalId,
    payoutHex: hex,
    amountPlanck,
    observedAtMs: 0,
    reconciled: false,
  };
}

const A = `0x${"a".repeat(64)}`;
const B = `0x${"b".repeat(64)}`;
const C = `0x${"c".repeat(64)}`;
const terminals = [terminal("t-a", A), terminal("t-b", B), terminal("t-c", C)];

describe("computeReport", () => {
  it("sums per terminal within the block period and includes zero-activity terminals", () => {
    const events = [
      event("1", "t-a", A, 100, "1000000"),
      event("2", "t-a", A, 120, "500000"),
      event("3", "t-b", B, 150, "250000"),
    ];
    const report = computeReport(events, 100, 150, terminals);
    const byId = new Map(report.lines.map((l) => [l.terminalId, l]));
    expect(byId.get("t-a")).toMatchObject({ totalPlanck: "1500000", count: 2 });
    expect(byId.get("t-b")).toMatchObject({ totalPlanck: "250000", count: 1 });
    expect(byId.get("t-c")).toMatchObject({ totalPlanck: "0", count: 0 });
    expect(report.grandTotalPlanck).toBe("1750000");
    expect(report.count).toBe(3);
  });

  it("excludes events outside [fromBlock, toBlock]", () => {
    const events = [
      event("1", "t-a", A, 99, "1000000"), // before period
      event("2", "t-a", A, 100, "1"), // first block of period
      event("3", "t-a", A, 151, "9999"), // after period
    ];
    const report = computeReport(events, 100, 150, terminals);
    expect(report.grandTotalPlanck).toBe("1");
    expect(report.count).toBe(1);
  });

  it("keeps a line for an on-chain terminal absent from current config", () => {
    const report = computeReport([event("1", "t-x", `0x${"e".repeat(64)}`, 100, "42")], 100, 150, terminals);
    expect(report.lines.find((l) => l.terminalId === "t-x")).toMatchObject({ totalPlanck: "42", count: 1 });
  });
});

describe("commitZReport", () => {
  it("snapshots the open period, assigns the next seq, and advances the period", () => {
    const state: ReportState = { periodStartBlock: 100, lastZSeq: 2 };
    const events = [event("1", "t-a", A, 100, "1000000"), event("2", "t-b", B, 150, "5")];
    const { record, nextState } = commitZReport(state, events, 150, terminals, 1_700_000_000_000);

    expect(record.seq).toBe(3);
    expect(record.source).toBe("v1");
    expect(record.fromBlock).toBe(100);
    expect(record.toBlock).toBe(150);
    expect(record.grandTotalPlanck).toBe("1000005");
    expect(record.committedAtMs).toBe(1_700_000_000_000);
    expect(nextState).toEqual({ periodStartBlock: 151, lastZSeq: 3 });
  });

  it("a follow-up Z over the new period does not double-count the previous one", () => {
    const first = commitZReport({ periodStartBlock: 100, lastZSeq: 0 }, [event("1", "t-a", A, 120, "10")], 150, terminals, 0);
    const second = commitZReport(
      first.nextState,
      [event("1", "t-a", A, 120, "10"), event("2", "t-a", A, 160, "7")],
      170,
      terminals,
      0,
    );
    expect(second.record.fromBlock).toBe(151);
    expect(second.record.grandTotalPlanck).toBe("7"); // only the post-period event
    expect(second.record.seq).toBe(2);
  });
});
