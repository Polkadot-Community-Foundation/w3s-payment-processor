// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { envConfig, type ProtocolEnablement } from "@/config.ts";

const STORAGE_KEY = "w3spay-protocol-settings:v1";

export interface ProtocolSettingsValue extends ProtocolEnablement {
  defaults: ProtocolEnablement;
  setV1Enabled: (enabled: boolean) => void;
  setV2Enabled: (enabled: boolean) => void;
  resetToDefaults: () => void;
}

const ProtocolSettingsContext = createContext<ProtocolSettingsValue | null>(null);

function readStored(defaults: ProtocolEnablement): ProtocolEnablement {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return defaults;
    const record = parsed as Record<string, unknown>;
    return {
      v1Enabled: typeof record.v1Enabled === "boolean" ? record.v1Enabled : defaults.v1Enabled,
      v2Enabled: typeof record.v2Enabled === "boolean" ? record.v2Enabled : defaults.v2Enabled,
    };
  } catch {
    return defaults;
  }
}

function saveStored(value: ProtocolEnablement): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* ignore storage failures (private mode / sandbox) */
  }
}

export function ProtocolSettingsProvider({ children }: { children: ReactNode }) {
  const defaults = envConfig.protocols;
  const [settings, setSettings] = useState<ProtocolEnablement>(() => readStored(defaults));

  useEffect(() => saveStored(settings), [settings]);

  const value = useMemo<ProtocolSettingsValue>(
    () => ({
      ...settings,
      defaults,
      setV1Enabled: (enabled) => setSettings((s) => ({ ...s, v1Enabled: enabled })),
      setV2Enabled: (enabled) => setSettings((s) => ({ ...s, v2Enabled: enabled })),
      resetToDefaults: () => setSettings(defaults),
    }),
    [defaults, settings],
  );

  return <ProtocolSettingsContext.Provider value={value}>{children}</ProtocolSettingsContext.Provider>;
}

export function useProtocolSettings(): ProtocolSettingsValue {
  const ctx = useContext(ProtocolSettingsContext);
  if (!ctx) throw new Error("useProtocolSettings used outside ProtocolSettingsProvider");
  return ctx;
}
