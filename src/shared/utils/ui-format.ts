/**
 * Presentation-only formatting for the back-office UI. On-chain amounts are
 * integer planck; `toToken` converts at this one choke point (BigInt → number)
 * so the UI can render friendly money. Never used for fiscal math — the Z-report
 * engine keeps planck/BigInt end to end.
 */
import { formatPlanck } from "@/shared/utils/format.ts";

/** Integer planck (string or bigint) → token-unit number for display. */
export function toToken(planck: string | bigint, decimals: number): number {
  const value = typeof planck === "bigint" ? planck : BigInt(planck || "0");
  return Number(formatPlanck(value, decimals));
}

/** "1,234.50" — always two decimals, grouped thousands. */
export function fmtCash(n: number): string {
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** "1,234" — grouped integer. */
export function fmtInt(n: number): string {
  return Number(n).toLocaleString("en-US");
}

/** "7:42 PM" */
export function fmtTime(ms: number): string {
  const d = new Date(ms);
  let h = d.getHours();
  const m = d.getMinutes();
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, "0")} ${ap}`;
}

/** "7:00 PM" — the hour bucket label. */
export function fmtHour(ms: number): string {
  const d = new Date(ms);
  let h = d.getHours();
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:00 ${ap}`;
}

/** "5 Jun, 7:42 PM" */
export function fmtDayTime(ms: number): string {
  const day = new Date(ms).toLocaleDateString("en-US", { day: "numeric", month: "short" });
  return `${day}, ${fmtTime(ms)}`;
}

/** "3 min ago" / "2h 14m ago" relative to `nowMs` (defaults to live clock). */
export function timeAgo(ms: number, nowMs: number = Date.now()): string {
  const mins = Math.round((nowMs - ms) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  return `${h}h ${mins % 60}m ago`;
}

/** Stable warm-spectrum swatch per terminal id (deterministic hue from a hash). */
export function tillColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) % 360;
  return `oklch(0.62 0.09 ${hash})`;
}

export interface HourGroup<T> {
  hour: string;
  items: T[];
}

/**
 * Group a reverse-chronological list under hour headers, preserving order.
 * The list must already be sorted newest-first (or whatever order the caller
 * wants the buckets in) — grouping only coalesces adjacent same-hour items.
 */
export function groupByHour<T extends { tsMs: number }>(list: readonly T[]): HourGroup<T>[] {
  const out: HourGroup<T>[] = [];
  let cur: HourGroup<T> | null = null;
  for (const item of list) {
    const hr = fmtHour(item.tsMs);
    if (!cur || cur.hour !== hr) {
      cur = { hour: hr, items: [] };
      out.push(cur);
    }
    cur.items.push(item);
  }
  return out;
}
