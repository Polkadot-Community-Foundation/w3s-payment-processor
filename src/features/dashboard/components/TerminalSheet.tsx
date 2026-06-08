/**
 * Terminal detail sheet — tapping a till card opens this.
 * Shows terminal ID + receiving address (both copyable) and the
 * payments received by that terminal in the current period.
 *
 * Layout: bottom sheet on mobile, centered modal on desktop.
 * Backdrop click + Escape key both dismiss.
 */
import { useEffect, useState } from "react";

import { Icon } from "@/shared/components/Icon.tsx";
import { Money } from "@/shared/components/Money.tsx";
import { fmtTime, tillColor } from "@/shared/utils/ui-format.ts";
import type { StreamTerminal, StreamPayment } from "@/features/dashboard/types.ts";

// ── helpers ──────────────────────────────────────────────────────────────────

function truncateAddr(addr: string): string {
  if (addr.length <= 16) return addr;
  return `${addr.slice(0, 10)}…${addr.slice(-6)}`;
}

/** One-shot copy with local "Copied!" feedback. */
function CopyField({ label, value, display }: { label: string; value: string; display?: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border-subtle)" }}>
      <div
        className="eyebrow"
        style={{ marginBottom: 6, fontSize: 10.5, letterSpacing: "0.1em", color: "var(--muted)" }}
      >
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          className="mono"
          style={{
            flex: 1,
            fontSize: 13,
            color: "var(--text-2)",
            wordBreak: "break-all",
            lineHeight: 1.45,
          }}
        >
          {display ?? value}
        </span>
        <button
          onClick={handleCopy}
          title={copied ? "Copied!" : `Copy ${label.toLowerCase()}`}
          style={{
            flex: "0 0 auto",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 30,
            height: 30,
            borderRadius: "var(--radius-sm)",
            border: "none",
            background: copied ? "var(--green-bg)" : "var(--surface-3)",
            color: copied ? "var(--green-fg)" : "var(--text-3)",
            cursor: "pointer",
            transition: "background .15s, color .15s",
          }}
        >
          <Icon name={copied ? "check" : "copy"} size={14} stroke={2} />
        </button>
      </div>
    </div>
  );
}

// ── payment mini-row ──────────────────────────────────────────────────────────

function PaymentMiniRow({ p, last }: { p: StreamPayment; last: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "11px 20px",
        borderBottom: last ? "none" : "1px solid var(--border-subtle)",
      }}
    >
      <span
        className="mono"
        style={{ fontSize: 12, color: "var(--muted)", width: 58, flex: "0 0 auto" }}
      >
        {fmtTime(p.tsMs)}
      </span>
      <span style={{ flex: 1 }} />
      <Money value={p.amount} size="sm" />
    </div>
  );
}

// ── sheet ─────────────────────────────────────────────────────────────────────

export function TerminalSheet({
  terminal,
  payments,
  mobile,
  onClose,
}: {
  terminal: StreamTerminal;
  payments: StreamPayment[];
  mobile: boolean;
  onClose: () => void;
}) {
  // Escape key dismisses
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const filtered = payments.filter((p) => p.terminalId === terminal.id);
  const accent = tillColor(terminal.id);

  const panelStyle: React.CSSProperties = mobile
    ? {
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        maxHeight: "85dvh",
        borderRadius: "var(--radius-xl) var(--radius-xl) 0 0",
        background: "var(--surface)",
        boxShadow: "var(--shadow-lg)",
        overflowY: "auto",
        zIndex: 210,
      }
    : {
        position: "fixed",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        width: 420,
        maxHeight: "80dvh",
        borderRadius: "var(--radius-lg)",
        background: "var(--surface)",
        boxShadow: "var(--shadow-lg)",
        overflowY: "auto",
        zIndex: 210,
      };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.55)",
          zIndex: 200,
          backdropFilter: "blur(2px)",
        }}
      />

      {/* Panel */}
      <div style={panelStyle}>
        {/* Handle (mobile visual affordance) */}
        {mobile && (
          <div
            style={{
              width: 36,
              height: 4,
              borderRadius: 99,
              background: "var(--border-strong)",
              margin: "12px auto 0",
            }}
          />
        )}

        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: mobile ? "16px 20px 14px" : "20px 20px 14px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: accent,
              flex: "0 0 auto",
            }}
          />
          <span
            style={{
              flex: 1,
              fontSize: 16,
              fontWeight: 600,
              color: "var(--text-1)",
              letterSpacing: "-0.01em",
            }}
          >
            {terminal.name}
          </span>
          <button
            onClick={onClose}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 30,
              height: 30,
              borderRadius: "var(--radius-sm)",
              border: "none",
              background: "transparent",
              color: "var(--text-3)",
              cursor: "pointer",
            }}
          >
            <Icon name="x" size={16} stroke={2} />
          </button>
        </div>

        {/* Detail fields */}
        <CopyField label="Terminal ID" value={terminal.id} />
        {terminal.address && (
          <CopyField
            label="Receiving address"
            value={terminal.address}
            display={truncateAddr(terminal.address)}
          />
        )}

        {/* Payments section */}
        <div
          style={{
            padding: "14px 20px 8px",
            borderBottom: filtered.length > 0 ? "1px solid var(--border-subtle)" : undefined,
          }}
        >
          <span
            className="eyebrow"
            style={{ fontSize: 10.5, letterSpacing: "0.1em", color: "var(--muted)" }}
          >
            Payments this period
            {filtered.length > 0 && (
              <span style={{ marginLeft: 6, color: "var(--text-3)" }}>{filtered.length}</span>
            )}
          </span>
        </div>

        {filtered.length === 0 ? (
          <div
            style={{
              padding: "24px 20px",
              fontSize: 13,
              color: "var(--muted)",
              textAlign: "center",
            }}
          >
            No payments yet this period
          </div>
        ) : (
          <div>
            {filtered.slice(0, 30).map((p, i) => (
              <PaymentMiniRow key={p.id} p={p} last={i === Math.min(filtered.length, 30) - 1} />
            ))}
            {filtered.length > 30 && (
              <div
                style={{
                  padding: "10px 20px",
                  fontSize: 12,
                  color: "var(--muted)",
                  textAlign: "center",
                }}
              >
                +{filtered.length - 30} more — see All payments for full history
              </div>
            )}
          </div>
        )}

        {/* Bottom safe-area padding (iOS) */}
        {mobile && <div style={{ height: "env(safe-area-inset-bottom, 16px)" }} />}
      </div>
    </>
  );
}
