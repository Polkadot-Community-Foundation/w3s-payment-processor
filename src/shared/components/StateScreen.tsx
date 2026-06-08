// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

import { useState, type ReactNode } from "react";

import { DisplayIf } from "@/shared/components/DisplayIf.tsx";
import { Icon, type IconName } from "@/shared/components/Icon.tsx";
import { Btn } from "@/shared/components/controls.tsx";
import { ConnDot, type ConnState } from "@/shared/components/indicators.tsx";
import { tone, type Tone } from "@/shared/utils/tone.ts";

export type StateKind = "config" | "noPaths" | "empty" | "connecting" | "syncing" | "problem";

interface Preset {
  icon: IconName;
  tone: Tone;
  title: string;
  body: string;
  action?: string;
  actionIcon?: IconName;
  details?: string;
  foot?: ConnState;
  spin?: boolean;
}

const PRESETS: Record<StateKind, Preset> = {
  config: {
    icon: "alert",
    tone: "red",
    title: "This terminal isn't set up correctly",
    body: "W3sPay couldn't read this shop's settings, so it hasn't started watching for payments. Nothing was lost — your past reports are safe.",
    action: "Contact support",
    actionIcon: "lifebuoy",
    details: "Configuration could not be loaded.",
  },
  noPaths: {
    icon: "alert",
    tone: "amber",
    title: "No payment methods are switched on",
    body: "This terminal isn't watching any payment path yet. Switch one on in the configuration and redeploy — nothing else here changes.",
  },
  empty: {
    icon: "clock",
    tone: "neutral",
    title: "No sales yet today",
    body: "Everything is connected and watching. The moment a payment lands, it shows up here.",
    foot: "live",
  },
  connecting: {
    icon: "refresh",
    tone: "amber",
    spin: true,
    title: "Reconnecting…",
    body: "We briefly lost the network and we're reconnecting. Any payments made while we were away are caught up automatically — none are missed.",
    foot: "connecting",
  },
  syncing: {
    icon: "refresh",
    tone: "blue",
    spin: true,
    title: "Syncing…",
    body: "We're subscribed and catching up to the latest finalized block. Payments made while this processor was away are being scanned now.",
    foot: "syncing",
  },
  problem: {
    icon: "activity",
    tone: "red",
    title: "Connection lost",
    body: "We can't reach the network right now and we're trying again automatically. Payments that arrive meanwhile will appear as soon as we're back.",
    foot: "problem",
  },
};

export function StateScreen({ kind, detail, children }: { kind: StateKind; detail?: string; children?: ReactNode }) {
  const s = PRESETS[kind];
  const [showDetails, setShowDetails] = useState(false);
  const c = tone(s.tone);
  const detailsText = detail ?? s.details;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "40px 26px", width: "100%" }}>
      <div style={{ maxWidth: 360, display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ width: 56, height: 56, borderRadius: "50%", background: c.bg, color: c.solid, display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 22 }}>
          <Icon name={s.icon} size={25} stroke={1.9} style={{ animation: s.spin ? "pay-spin 1.4s linear infinite" : "none" }} />
        </div>
        <h2 style={{ margin: 0, fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 23, color: "var(--text-1)", letterSpacing: "-0.02em", lineHeight: 1.15 }}>{s.title}</h2>
        <p style={{ margin: "13px 0 0", fontSize: 14, lineHeight: 1.62, color: "var(--text-3)" }}>{s.body}</p>

        <DisplayIf condition={children}>
          {children}
        </DisplayIf>

        <DisplayIf condition={s.action}>
          <div style={{ marginTop: 24 }}>
            <Btn kind="primary" size="md" icon={s.actionIcon}>{s.action}</Btn>
          </div>
        </DisplayIf>

        <DisplayIf condition={detailsText}>
          <div style={{ marginTop: 18, width: "100%" }}>
            <button
              onClick={() => setShowDetails((v) => !v)}
              style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "none", border: "none", cursor: "pointer", color: "var(--muted)", fontSize: 12.5, fontWeight: 600, fontFamily: "var(--font-sans)", margin: "0 auto" }}
            >
              <Icon name="chevronDown" size={14} stroke={2} style={{ transform: showDetails ? "rotate(180deg)" : "none", transition: "transform .18s" }} />
              {showDetails ? "Hide technical details" : "Show technical details"}
            </button>
            <DisplayIf condition={showDetails}>
              <div className="mono" style={{ marginTop: 11, padding: "12px 14px", background: "var(--surface-3)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", fontSize: 11.5, color: "var(--text-3)", lineHeight: 1.55, textAlign: "left", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {detailsText}
              </div>
            </DisplayIf>
          </div>
        </DisplayIf>

        <DisplayIf condition={s.foot}>
          <div style={{ marginTop: 24, paddingTop: 18, borderTop: "1px solid var(--border-subtle)", width: "100%", display: "flex", justifyContent: "center" }}>
            <ConnDot state={s.foot} label sub size={9} />
          </div>
        </DisplayIf>
      </div>
    </div>
  );
}

export function FullState({ kind, detail }: { kind: StateKind; detail?: string }) {
  return (
    <div className="pay-root" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
      <StateScreen kind={kind} detail={detail} />
    </div>
  );
}
