/** Buttons + segmented control (tabs / filters). Ported from the Daybook kit. */
import type { CSSProperties, ReactNode } from "react";

import { DisplayIf } from "@/shared/components/DisplayIf.tsx";
import { Icon, type IconName } from "@/shared/components/Icon.tsx";

type BtnKind = "primary" | "ghost" | "subtle" | "accent";
type BtnSize = "sm" | "md" | "lg";

const BTN_KINDS: Record<BtnKind, CSSProperties> = {
  primary: { background: "var(--text-1)", color: "var(--bg)" },
  ghost: { background: "var(--surface-3)", color: "var(--text-2)", borderColor: "var(--border)" },
  subtle: { background: "transparent", color: "var(--text-3)" },
  accent: { background: "var(--green-bg)", color: "var(--green-fg)", borderColor: "transparent" },
};

export function Btn({
  children,
  onClick,
  kind = "ghost",
  size = "md",
  icon,
  iconRight,
  full,
  disabled,
  style,
}: {
  children: ReactNode;
  onClick?: () => void;
  kind?: BtnKind;
  size?: BtnSize;
  icon?: IconName;
  iconRight?: IconName;
  full?: boolean;
  disabled?: boolean;
  style?: CSSProperties;
}) {
  const pads = size === "sm" ? "7px 12px" : size === "lg" ? "13px 22px" : "9px 16px";
  const fs = size === "sm" ? 12.5 : size === "lg" ? 15 : 13.5;
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        padding: pads,
        fontSize: fs,
        fontWeight: 600,
        fontFamily: "var(--font-sans)",
        borderRadius: "var(--radius-md)",
        cursor: disabled ? "default" : "pointer",
        border: "1px solid transparent",
        transition: "background .15s, border-color .15s, color .15s, transform .1s",
        width: full ? "100%" : "auto",
        whiteSpace: "nowrap",
        letterSpacing: "0.005em",
        opacity: disabled ? 0.5 : 1,
        lineHeight: 1.1,
        ...BTN_KINDS[kind],
        ...style,
      }}
      onMouseDown={(e) => {
        if (!disabled) e.currentTarget.style.transform = "scale(0.98)";
      }}
      onMouseUp={(e) => (e.currentTarget.style.transform = "none")}
      onMouseLeave={(e) => (e.currentTarget.style.transform = "none")}
    >
      <DisplayIf condition={icon}>
        <Icon name={icon as IconName} size={fs + 2} stroke={2} />
      </DisplayIf>
      {children}
      <DisplayIf condition={iconRight}>
        <Icon name={iconRight as IconName} size={fs + 2} stroke={2} />
      </DisplayIf>
    </button>
  );
}

export interface SegmentedItem {
  id: string;
  label: string;
  icon?: IconName;
  count?: number;
}

export function Segmented({
  value,
  onChange,
  items,
  size = "md",
  full,
}: {
  value: string;
  onChange: (id: string) => void;
  items: readonly SegmentedItem[];
  size?: "sm" | "md";
  full?: boolean;
}) {
  const pad = size === "sm" ? "6px 12px" : "8px 14px";
  const fs = size === "sm" ? 12 : 13;
  return (
    <div
      style={{
        display: "inline-flex",
        background: "var(--surface-3)",
        borderRadius: "var(--radius-md)",
        padding: 3,
        gap: 2,
        border: "1px solid var(--border)",
        width: full ? "100%" : "auto",
      }}
    >
      {items.map((it) => {
        const active = value === it.id;
        return (
          <button
            key={it.id}
            onClick={() => onChange(it.id)}
            style={{
              flex: full ? 1 : "0 0 auto",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              padding: pad,
              fontSize: fs,
              fontWeight: 600,
              fontFamily: "var(--font-sans)",
              border: "none",
              borderRadius: "var(--radius-sm)",
              cursor: "pointer",
              background: active ? "var(--surface)" : "transparent",
              color: active ? "var(--text-1)" : "var(--text-3)",
              boxShadow: active ? "var(--shadow-sm)" : "none",
              transition: "background .15s, color .15s",
              letterSpacing: "0.01em",
              whiteSpace: "nowrap",
            }}
          >
            <DisplayIf condition={it.icon}>
              <Icon name={it.icon as IconName} size={fs + 2} stroke={1.9} />
            </DisplayIf>
            {it.label}
            <DisplayIf condition={it.count != null}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: fs - 2, color: "var(--muted)", fontWeight: 500 }}>{it.count}</span>
            </DisplayIf>
          </button>
        );
      })}
    </div>
  );
}
