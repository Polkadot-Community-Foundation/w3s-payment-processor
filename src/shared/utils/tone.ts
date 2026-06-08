// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

export type Tone = "green" | "amber" | "red" | "blue" | "neutral";

export interface ToneColors {
  fg: string;
  bg: string;
  solid: string;
}

export function tone(t: Tone): ToneColors {
  switch (t) {
    case "green":
      return { fg: "var(--green-fg)", bg: "var(--green-bg)", solid: "var(--green)" };
    case "amber":
      return { fg: "var(--amber-fg)", bg: "var(--amber-bg)", solid: "var(--amber)" };
    case "red":
      return { fg: "var(--red-fg)", bg: "var(--red-bg)", solid: "var(--red)" };
    case "blue":
      return { fg: "var(--blue-fg)", bg: "var(--blue-bg)", solid: "var(--blue)" };
    default:
      return { fg: "var(--text-3)", bg: "var(--hover-strong)", solid: "var(--muted)" };
  }
}
