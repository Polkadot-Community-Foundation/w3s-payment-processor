/**
 * DIRECTION A · "Daybook" — Today. Leads with a serif takings figure, then
 * per-terminal totals and the latest slice of the live stream. Reads like the
 * top of a bank statement: money first, machinery hidden.
 */
import { useState, type ReactNode } from "react";

import { fmtInt, tillColor } from "@/shared/utils/ui-format.ts";
import { Money } from "@/shared/components/Money.tsx";
import { Icon } from "@/shared/components/Icon.tsx";
import { TillDot } from "@/shared/components/indicators.tsx";
import { DisplayIf } from "@/shared/components/DisplayIf.tsx";
import { EmptyState } from "@/features/dashboard/components/EmptyState.tsx";
import { PaymentRow } from "@/features/dashboard/components/PaymentRow.tsx";
import { TerminalSheet } from "@/features/dashboard/components/TerminalSheet.tsx";
import { PaymentDetailSheet } from "@/features/dashboard/components/PaymentDetailSheet.tsx";
import type { StreamPayment } from "@/features/dashboard/types.ts";
import type { PaymentStream } from "@/features/dashboard/api/use-payment-stream.ts";

export function Today({ stream, mobile, onSeeAll }: { stream: PaymentStream; mobile: boolean; onSeeAll: () => void }) {
  const { totals, payments, unchecked, periodLabel, terminals } = stream;
  const latest = payments.slice(0, mobile ? 6 : 9);
  const avg = totals.count ? totals.grand / totals.count : 0;
  const nameOf = new Map(terminals.map((t) => [t.id, t.name]));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedPayment, setSelectedPayment] = useState<StreamPayment | null>(null);
  const selectedTerminal = selectedId ? terminals.find((t) => t.id === selectedId) ?? null : null;

  return (
    <div style={{ paddingTop: 22 }}>
      <div style={{ display: "flex", flexDirection: mobile ? "column" : "row", gap: mobile ? 22 : 40, alignItems: mobile ? "flex-start" : "flex-end", marginBottom: 26 }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 12 }}>Taken {periodLabel}</div>
          <Money value={totals.grand} size={mobile ? "xl" : "hero"} font="serif" />
        </div>
        <div style={{ display: "flex", gap: mobile ? 24 : 34, paddingBottom: mobile ? 0 : 12 }}>
          <Stat label="Payments" value={fmtInt(totals.count)} />
          <Stat label="Average sale" value={<Money value={avg} size="md" unit={false} />} />
          <Stat label="To check" value={unchecked} tone={unchecked ? "amber" : "green"} />
        </div>
      </div>

      <Tills stream={stream} mobile={mobile} onTap={setSelectedId} />

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", margin: "34px 0 8px" }}>
        <h2 style={{ margin: 0, fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 20, color: "var(--text-1)", letterSpacing: "-0.02em" }}>Latest payments</h2>
        <button onClick={onSeeAll} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "none", border: "none", cursor: "pointer", color: "var(--text-3)", fontSize: 13, fontWeight: 600, fontFamily: "var(--font-sans)" }}>
          See all <Icon name="chevronRight" size={15} stroke={2} />
        </button>
      </div>
      <DisplayIf condition={latest.length === 0}>
        <EmptyState />
      </DisplayIf>
      <DisplayIf condition={latest.length > 0}>
        <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden", background: "var(--surface)" }}>
          {latest.map((p, i) => (
            <PaymentRow key={p.id} p={p} name={nameOf.get(p.terminalId) ?? p.terminalId} onToggle={stream.toggleCheck} onSelect={setSelectedPayment} last={i === latest.length - 1} mobile={mobile} />
          ))}
        </div>
      </DisplayIf>

      {selectedTerminal && (
        <TerminalSheet
          terminal={selectedTerminal}
          payments={payments}
          mobile={mobile}
          onClose={() => setSelectedId(null)}
        />
      )}
      {selectedPayment && (
        <PaymentDetailSheet
          payment={selectedPayment}
          terminalName={nameOf.get(selectedPayment.terminalId) ?? selectedPayment.terminalId}
          mobile={mobile}
          onClose={() => setSelectedPayment(null)}
        />
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "amber" | "green" }) {
  const col = tone === "amber" ? "var(--amber-fg)" : tone === "green" ? "var(--green-fg)" : "var(--text-1)";
  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 9 }}>{label}</div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 22, fontWeight: 500, color: col, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{value}</div>
    </div>
  );
}

function Tills({ stream, mobile, onTap }: { stream: PaymentStream; mobile: boolean; onTap: (id: string) => void }) {
  const { terminals, totals } = stream;
  const max = Math.max(...terminals.map((t) => totals.perTill.get(t.id)?.amount || 0), 1);
  return (
    <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr 1fr" : "1fr 1fr 1fr 1fr", gap: 10 }}>
      {terminals.map((t) => {
        const d = totals.perTill.get(t.id) ?? { amount: 0, count: 0 };
        return (
          <button
            key={t.id}
            onClick={() => onTap(t.id)}
            style={{
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              padding: "13px 14px",
              background: "var(--surface)",
              cursor: "pointer",
              textAlign: "left",
              width: "100%",
              transition: "background .12s, border-color .12s",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "var(--hover-strong)";
              (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border-strong)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "var(--surface)";
              (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border)";
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
              <TillDot id={t.id} />
              <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.name}</span>
            </div>
            <Money value={d.amount} size="md" />
            <div style={{ height: 4, borderRadius: 99, background: "var(--surface-3)", margin: "11px 0 7px", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${(d.amount / max) * 100}%`, background: tillColor(t.id), borderRadius: 99 }} />
            </div>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>{d.count} payment{d.count === 1 ? "" : "s"}</span>
          </button>
        );
      })}
    </div>
  );
}
