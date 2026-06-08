// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

import type { CSSProperties } from "react";

import { envConfig } from "@/config.ts";
import { fmtCash } from "@/shared/utils/ui-format.ts";
import { DisplayIf } from "@/shared/components/DisplayIf.tsx";

type MoneySize = "xs" | "sm" | "md" | "lg" | "xl" | "hero";

const MONEY_SIZES: Record<MoneySize, { n: number; u: number; g: number }> = {
  xs: { n: 12.5, u: 8.5, g: 4 },
  sm: { n: 14, u: 9.5, g: 5 },
  md: { n: 17, u: 10.5, g: 5 },
  lg: { n: 26, u: 12, g: 7 },
  xl: { n: 40, u: 14, g: 9 },
  hero: { n: 62, u: 17, g: 12 },
};

export function Money({
  value,
  size = "md",
  font = "mono",
  unit = true,
  color,
  weight,
  style,
}: {
  value: number;
  size?: MoneySize;
  font?: "mono" | "serif";
  unit?: boolean;
  color?: string;
  weight?: number;
  style?: CSSProperties;
}) {
  const s = MONEY_SIZES[size];
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: s.g, color: color || "var(--text-1)", ...style }}>
      <span
        style={{
          fontFamily: font === "serif" ? "var(--font-serif)" : "var(--font-mono)",
          fontSize: s.n,
          fontWeight: weight || (font === "serif" ? 400 : 500),
          fontVariantNumeric: "tabular-nums",
          letterSpacing: font === "serif" ? "-0.02em" : "-0.01em",
          lineHeight: 1,
        }}
      >
        {fmtCash(value)}
      </span>
      <DisplayIf condition={unit}>
        <span
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: s.u,
            fontWeight: 600,
            letterSpacing: "0.08em",
            color: "var(--muted)",
          }}
        >
          {envConfig.token.symbol}
        </span>
      </DisplayIf>
    </span>
  );
}
