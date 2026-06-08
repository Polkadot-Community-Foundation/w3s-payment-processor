// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

import { Icon } from "@/shared/components/Icon.tsx";

/** Inline "no payments" panel — calm, no jargon. `filtered` = filters hid them all. */
export function EmptyState({ filtered }: { filtered?: boolean }) {
  return (
    <div style={{ border: "1px dashed var(--border-strong)", borderRadius: "var(--radius-lg)", padding: "46px 24px", textAlign: "center", background: "var(--surface)" }}>
      <div style={{ width: 44, height: 44, borderRadius: "50%", background: "var(--surface-3)", display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 16, color: "var(--muted)" }}>
        <Icon name={filtered ? "filter" : "clock"} size={20} stroke={1.7} />
      </div>
      <div style={{ fontFamily: "var(--font-serif)", fontSize: 19, color: "var(--text-2)", letterSpacing: "-0.01em" }}>
        {filtered ? "Nothing matches those filters" : "No sales yet this period"}
      </div>
      <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 7 }}>
        {filtered ? "Try a different terminal or status." : "Payments will appear here the moment they land."}
      </div>
    </div>
  );
}
