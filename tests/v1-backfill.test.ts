import { describe, expect, it } from "vitest";

import { backfillRange } from "@/features/v1/api/backfill.ts";

describe("backfillRange", () => {
  it("returns null on first run (no checkpoint) — start live, never deep-scan history", () => {
    expect(backfillRange(undefined, 1_000_000)).toBeNull();
  });

  it("returns null when already caught up", () => {
    expect(backfillRange(500, 500)).toBeNull();
    expect(backfillRange(500, 499)).toBeNull(); // reorg-shrunk head
  });

  it("scans the inclusive gap (checkpoint, head] when within the cap", () => {
    expect(backfillRange(500, 510)).toEqual({ from: 501, to: 510, truncated: false });
  });

  it("scans a single missed block", () => {
    expect(backfillRange(500, 501)).toEqual({ from: 501, to: 501, truncated: false });
  });

  it("caps a huge gap to the most recent maxSpan blocks and flags truncation", () => {
    const plan = backfillRange(0, 1_000_000, 5_000);
    expect(plan).toEqual({ from: 995_001, to: 1_000_000, truncated: true });
  });
});
