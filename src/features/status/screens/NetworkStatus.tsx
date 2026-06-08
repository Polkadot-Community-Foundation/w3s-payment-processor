// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

import { useProcessorConfig } from "@/shared/store/useProcessorConfig.tsx";
import { useV1Monitor } from "@/features/v1/store/V1MonitorProvider.tsx";
import { useV2Monitor } from "@/features/v2/store/V2MonitorProvider.tsx";
import { CONN } from "@/shared/components/indicators.tsx";
import { Icon } from "@/shared/components/Icon.tsx";
import { envConfig } from "@/config.ts";

/** Compact key–value row. */
function Row({ label, value, mono }: { label: string; value: string | number | undefined | null; mono?: boolean }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16, padding: "9px 0", borderBottom: "1px solid var(--border)" }}>
      <span style={{ fontSize: 13, color: "var(--text-3)", flexShrink: 0 }}>{label}</span>
      <span className={mono ? "mono" : undefined} style={{ fontSize: 13, color: "var(--text-1)", textAlign: "right", wordBreak: "break-all" }}>{String(value)}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 22 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", color: "var(--text-3)", textTransform: "uppercase", marginBottom: 4, padding: "0 2px" }}>{title}</div>
      <div style={{ borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "var(--surface)", padding: "0 14px" }}>
        {children}
      </div>
    </section>
  );
}

export function NetworkStatus({ onBack }: { mobile: boolean; onBack: () => void }) {
  const config = useProcessorConfig();
  const v1 = useV1Monitor();
  const v2 = useV2Monitor();
  const net = envConfig.network;

  const v1Conn = v1.status === "running" ? "live" : v1.status === "error" ? "problem" : "connecting";

  return (
    <div>
      {/* Back button — prominent on mobile, subtle on desktop */}
      <button
        type="button"
        onClick={onBack}
        style={{ display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 20, padding: "6px 10px 6px 6px", borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text-3)", cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: 600 }}
      >
        <Icon name="chevronLeft" size={15} stroke={2.2} />
        Back
      </button>

      <h2 style={{ margin: "0 0 20px", fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 22, color: "var(--text-1)", letterSpacing: "-0.02em" }}>
        Network status
      </h2>

      <Section title="Connection">
        <Row label="State" value={CONN[v1Conn].label} />
        <Row label="Note" value={CONN[v1Conn].note} />
        <Row label="Latest block" value={v1.finalizedBlock > 0 ? `#${v1.finalizedBlock.toLocaleString()}` : "—"} mono />
        {v1.catchupProgress ? (
          <Row
            label="Syncing"
            value={`block ${v1.catchupProgress.currentBlock.toLocaleString()} of ${v1.catchupProgress.targetBlock.toLocaleString()} (${Math.round((v1.catchupProgress.processedBlocks / v1.catchupProgress.totalBlocks) * 100)}%)`}
            mono
          />
        ) : null}
        <Row label="Error" value={v1.error} />
        <Row label="Warning" value={v1.warn} />
      </Section>

      <Section title="V1 listening">
        <Row label="Protocol" value={config.v1.enabled ? config.v1.type : "disabled"} />
        <Row label="Status" value={v1.status} mono />
        <Row label="Terminals" value={v1.terminals.length > 0 ? v1.terminals.map((t) => t.displayName ?? t.terminalId).join(", ") : "—"} />
      </Section>

      <Section title="V2 listening">
        <Row label="Protocol" value={config.v2.enabled ? config.v2.type : "disabled"} />
        <Row label="Status" value={v2.status} mono />
        <Row label="Claims" value={config.v2.enabled ? (v2.claimsEnabled ? "enabled" : "disabled") : "—"} />
        <Row label="Terminals" value={config.v2.terminals.length > 0 ? config.v2.terminals.map((t) => t.label ?? t.terminalId).join(", ") : "—"} />
        <Row label="Decode failures" value={v2.decodeFailures > 0 ? String(v2.decodeFailures) : null} />
        <Row label="Error" value={v2.error} />
      </Section>

      <Section title="Chain">
        <Row label="Network" value={net.displayName} />
        <Row label="People chain" value={envConfig.network.peopleChain?.wsUrl ?? "—"} mono />
        <Row label="Merchant" value={config.profile.merchantName} />
        <Row label="Group" value={config.profile.merchantId} />
      </Section>
    </div>
  );
}
