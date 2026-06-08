/** DIRECTION A · "Daybook" navigation chrome: sidebar (desktop), top bar, bottom tabs, theme toggle. */
import { timeAgo } from "@/shared/utils/ui-format.ts";
import { Icon } from "@/shared/components/Icon.tsx";
import { ConnDot, Mark } from "@/shared/components/indicators.tsx";
import { DisplayIf } from "@/shared/components/DisplayIf.tsx";
import { useTheme } from "@/shared/store/useTheme.tsx";
import { NAV, type Tab } from "@/app/navigation/routes.ts";
import type { PaymentStream } from "@/features/dashboard/api/use-payment-stream.ts";


const TITLES: Record<Tab, { t: string; s: string }> = {
  today: { t: "Today", s: new Date().toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long" }) },
  all: { t: "All payments", s: "One stream, newest first" },
  reports: { t: "Reports", s: "Running total and end-of-day close" },
  settings: { t: "Settings", s: "Listening preferences on this device" },
  network: { t: "Network", s: "Chain connection and block info" },
};

export function ThemeToggle({ compact }: { compact?: boolean }) {
  const { theme, setTheme } = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      onClick={() => setTheme(next)}
      title={`Switch to ${next} mode`}
      style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, padding: compact ? "8px" : "9px 12px", borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "var(--surface-3)", color: "var(--text-3)", cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: 12.5, fontWeight: 600 }}
    >
      <Icon name={theme === "dark" ? "sun" : "moon"} size={15} stroke={1.9} />
      {compact ? null : theme === "dark" ? "Light" : "Dark"}
    </button>
  );
}

export function Sidebar({ tab, setTab, stream }: { tab: Tab; setTab: (t: Tab) => void; stream: PaymentStream }) {
  return (
    <aside style={{ width: 244, flex: "0 0 244px", height: "100%", display: "flex", flexDirection: "column", borderRight: "1px solid var(--border)", background: "var(--surface)", padding: "22px 16px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "2px 8px 22px" }}>
        <Mark size={26} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: "var(--font-serif)", fontSize: 18, letterSpacing: "-0.02em", color: "var(--text-1)", lineHeight: 1.05, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{stream.shop.name}</div>
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{stream.shop.venue}</div>
        </div>
      </div>
      <nav style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {NAV.map((n) => {
          const active = tab === n.id;
          return (
            <button
              key={n.id}
              onClick={() => setTab(n.id)}
              style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 12px", borderRadius: "var(--radius-md)", border: "none", cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: 14, fontWeight: 500, textAlign: "left", width: "100%", transition: "background .14s, color .14s", background: active ? "var(--hover-strong)" : "transparent", color: active ? "var(--text-1)" : "var(--text-3)" }}
            >
              <Icon name={n.icon} size={18} stroke={active ? 2 : 1.7} />
              <span style={{ flex: 1 }}>{n.label}</span>
              <DisplayIf condition={n.id === "all" && stream.unchecked > 0}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600, color: "var(--amber-fg)", background: "var(--amber-bg)", borderRadius: 99, padding: "1px 7px" }}>{stream.unchecked}</span>
              </DisplayIf>
            </button>
          );
        })}
      </nav>
      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ padding: "13px", borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "var(--surface-2)" }}>
          <ConnDot state={stream.conn} label sub size={9} />
        </div>
        <ThemeToggle />
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 8px", fontSize: 11, color: "var(--faint)" }}>
          <Icon name="lock" size={12} stroke={1.8} />
          <span>Monitoring only · read-only</span>
        </div>
      </div>
    </aside>
  );
}

export function TopBar({ mobile, tab, stream, setTab }: { mobile: boolean; tab: Tab; stream: PaymentStream; setTab: (t: Tab) => void }) {
  const h = TITLES[tab] ?? { t: tab, s: "" };
  const lastTime = stream.payments[0]?.tsMs;
  return (
    <header style={{ position: "sticky", top: 0, zIndex: 5, background: "var(--bg)", borderBottom: "1px solid var(--border)", padding: mobile ? "16px 18px 14px" : "24px 40px 18px", display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16 }}>
      <div style={{ minWidth: 0 }}>
        <DisplayIf condition={mobile}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 8, whiteSpace: "nowrap", overflow: "hidden" }}>
            <Mark size={18} />
            <span style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>{stream.shop.name} · {stream.shop.venue}</span>
          </div>
        </DisplayIf>
        <h1 style={{ margin: 0, fontFamily: "var(--font-serif)", fontWeight: 400, letterSpacing: "-0.02em", fontSize: mobile ? 26 : 30, lineHeight: 1, color: "var(--text-1)" }}>{h.t}</h1>
        <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 7 }}>{h.s}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flex: "0 0 auto" }}>
        <DisplayIf condition={!mobile && lastTime != null}>
          <div style={{ fontSize: 11.5, color: "var(--faint)", textAlign: "right" }}>
            <div className="eyebrow" style={{ marginBottom: 3 }}>Latest</div>
            <span className="mono" style={{ color: "var(--text-3)" }}>{lastTime != null ? timeAgo(lastTime) : "—"}</span>
          </div>
        </DisplayIf>
        <DisplayIf condition={mobile}>
          <button
            type="button"
            onClick={() => setTab("network")}
            aria-label="Network status"
            style={{ background: "none", border: "none", cursor: "pointer", padding: 4, display: "inline-flex" }}
          >
            <ConnDot state={stream.conn} size={9} />
          </button>
          <ThemeToggle compact />
        </DisplayIf>
      </div>
    </header>
  );
}

export function TabBar({ tab, setTab, unchecked }: { tab: Tab; setTab: (t: Tab) => void; unchecked: number }) {
  return (
    <nav style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 66, zIndex: 20, display: "flex", borderTop: "1px solid var(--border)", background: "var(--surface)", paddingBottom: 6 }}>
      {NAV.map((n) => {
        const active = tab === n.id;
        return (
          <button
            key={n.id}
            onClick={() => setTab(n.id)}
            style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, background: "transparent", border: "none", cursor: "pointer", position: "relative", color: active ? "var(--text-1)" : "var(--muted)", fontFamily: "var(--font-sans)" }}
          >
            <Icon name={n.icon} size={21} stroke={active ? 2 : 1.7} />
            <span style={{ fontSize: 10.5, fontWeight: 600 }}>{n.label}</span>
            <DisplayIf condition={n.id === "all" && unchecked > 0}>
              <span style={{ position: "absolute", top: 6, right: "50%", marginRight: -22, width: 7, height: 7, borderRadius: "50%", background: "var(--amber)" }} />
            </DisplayIf>
          </button>
        );
      })}
    </nav>
  );
}
