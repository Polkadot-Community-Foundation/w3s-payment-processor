// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { DisplayIf } from "@/shared/components/DisplayIf.tsx";
import { requestHostLogin, resolveHostProductAccount, subscribeHostAccountConnectionStatus } from "@/shared/api/host/accounts.ts";
import { Btn } from "@/shared/components/controls.tsx";
import { Icon } from "@/shared/components/Icon.tsx";
import { tone, type Tone } from "@/shared/utils/tone.ts";
import type { HostProductAccountStatus, HostProductAccountStatusKind } from "@/shared/api/host/accounts.ts";
import type { Subscription } from "@/shared/api/host/host-api.ts";

const HOST_SIGN_IN_REASON = "Sign in to W3sPay Payment Processor so the Polkadot app can provide its product account.";

type GateStatus = HostProductAccountStatusKind | "checking";
type SignInStatus = "idle" | "requesting" | "rejected" | "unavailable" | "error";

interface GateState {
  status: GateStatus;
  message: string;
  tone: Tone;
  signInStatus: SignInStatus;
  error?: string;
}

export function PolkadotHostGate({
  children,
  dotNsIdentifier,
  derivationIndex,
}: {
  children: ReactNode;
  dotNsIdentifier: string;
  derivationIndex: number;
}) {
  const mounted = useRef(false);
  const [gate, setGate] = useState<GateState>({
    status: "checking",
    message: "Checking Polkadot host sign-in…",
    tone: "neutral",
    signInStatus: "idle",
  });

  const refresh = useCallback(
    async (signInStatus: SignInStatus): Promise<HostProductAccountStatus | null> => {
      setGate({
        status: "checking",
        message: "Checking Polkadot host sign-in…",
        tone: "neutral",
        signInStatus,
      });

      const status = await resolveHostProductAccount(dotNsIdentifier, derivationIndex);
      if (!mounted.current) return null;

      setGate({
        status: status.kind,
        message: status.message,
        tone: status.kind === "ready" ? "green" : status.kind === "host-unreachable" ? "red" : "amber",
        signInStatus,
        error: status.error,
      });
      return status;
    },
    [derivationIndex, dotNsIdentifier],
  );

  const requestSignIn = useCallback(async (): Promise<void> => {
    setGate((state) => ({ ...state, signInStatus: "requesting" }));
    const currentStatus = gate.status === "host-unreachable" ? await refresh("requesting") : null;
    if (!mounted.current) return;
    if (currentStatus?.kind === "ready") return;
    if (currentStatus && currentStatus.kind !== "not-signed-in") {
      setGate((state) => ({ ...state, signInStatus: currentStatus.kind === "host-unreachable" ? "unavailable" : "error" }));
      return;
    }

    const result = await requestHostLogin(HOST_SIGN_IN_REASON);
    if (!mounted.current) return;
    if (result === "success" || result === "alreadyConnected") {
      await refresh("idle");
      return;
    }

    setGate((state) => ({
      ...state,
      signInStatus: result === "rejected" ? "rejected" : result === "unavailable" ? "unavailable" : "error",
    }));
  }, [gate.status, refresh]);

  useEffect(() => {
    mounted.current = true;
    let subscription: Subscription<void> | null = null;

    void (async () => {
      const status = await refresh("idle");
      if (!mounted.current) return;
      if (status?.kind === "host-unreachable" || status?.kind === "standalone") return;

      subscription = subscribeHostAccountConnectionStatus((connection) => {
        if (connection === "connected") {
          void refresh("idle");
          return;
        }

        setGate({
          status: "not-signed-in",
          message: "Sign in to the Polkadot app to use this payment processor.",
          tone: "amber",
          signInStatus: "idle",
        });
      });
    })();

    return () => {
      mounted.current = false;
      subscription?.unsubscribe();
    };
  }, [refresh]);

  if (gate.status === "ready") return <>{children}</>;

  const busy = gate.status === "checking" || gate.signInStatus === "requesting";
  const canRequestSignIn = gate.status === "not-signed-in" || gate.status === "host-unreachable";
  const c = tone(gate.tone);
  const signInNote =
    gate.signInStatus === "rejected"
      ? "Sign-in was cancelled. The processor remains locked."
      : gate.signInStatus === "unavailable"
        ? "The Polkadot host bridge is not reachable."
        : gate.signInStatus === "error"
          ? "The Polkadot app could not start sign-in."
          : undefined;

  return (
    <div className="pay-root" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "40px 26px", width: "100%" }}>
        <div style={{ maxWidth: 400, display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div style={{ width: 56, height: 56, borderRadius: "50%", background: c.bg, color: c.solid, display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 22 }}>
            <Icon name="wallet" size={25} stroke={1.9} style={{ animation: busy ? "pay-spin 1.4s linear infinite" : "none" }} />
          </div>
          <h2 style={{ margin: 0, fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 23, color: "var(--text-1)", letterSpacing: "-0.02em", lineHeight: 1.15 }}>Polkadot sign-in required</h2>
          <p style={{ margin: "13px 0 0", fontSize: 14, lineHeight: 1.62, color: "var(--text-3)" }}>{gate.message}</p>

          <DisplayIf condition={canRequestSignIn}>
            <div style={{ marginTop: 24 }}>
              <Btn kind="primary" size="md" icon="wallet" disabled={busy} onClick={requestSignIn}>
                {busy ? "Checking Polkadot app…" : gate.status === "host-unreachable" ? "Retry Polkadot host" : "Sign in to Polkadot"}
              </Btn>
            </div>
          </DisplayIf>

          <DisplayIf condition={signInNote}>
            <p style={{ margin: "14px 0 0", fontSize: 12.5, lineHeight: 1.5, color: "var(--text-3)" }}>{signInNote}</p>
          </DisplayIf>

          <DisplayIf condition={gate.error}>
            <div className="mono" style={{ marginTop: 18, padding: "12px 14px", background: "var(--surface-3)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", fontSize: 11.5, color: "var(--text-3)", lineHeight: 1.55, textAlign: "left", whiteSpace: "pre-wrap", wordBreak: "break-word", width: "100%" }}>
              {gate.error}
            </div>
          </DisplayIf>
        </div>
      </div>
    </div>
  );
}
