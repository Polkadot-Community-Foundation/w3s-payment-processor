// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

import { useMemo, type ReactNode } from "react";

import { PolkadotHostGate } from "@/app/PolkadotHostGate.tsx";
import { envConfig, type ProtocolEnablement, type ResolvedProcessorConfig } from "@/config.ts";
import { V1MonitorProvider } from "@/features/v1/store/V1MonitorProvider.tsx";
import { V2MonitorProvider } from "@/features/v2/store/V2MonitorProvider.tsx";
import { ProcessorConfigProvider } from "@/shared/store/useProcessorConfig.tsx";
import { ProtocolSettingsProvider, useProtocolSettings } from "@/shared/store/useProtocolSettings.tsx";
import { ThemeProvider } from "@/shared/store/useTheme.tsx";

export function AppThemeProvider({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <ProtocolSettingsProvider>{children}</ProtocolSettingsProvider>
    </ThemeProvider>
  );
}

function applyProtocolEnablement(
  config: ResolvedProcessorConfig,
  protocols: ProtocolEnablement,
): ResolvedProcessorConfig {
  const v1Enabled = protocols.v1Enabled;
  const v2Enabled = protocols.v2Enabled;
  return {
    profile: config.profile,
    v1: { ...config.v1, enabled: v1Enabled, mode: v1Enabled ? config.v1.mode : null },
    v2: { ...config.v2, enabled: v2Enabled, terminals: v2Enabled ? config.v2.terminals : [] },
    inert: !v1Enabled && !v2Enabled,
  };
}

export function AppProviders({ config, children }: { config: ResolvedProcessorConfig; children: ReactNode }) {
  const protocolSettings = useProtocolSettings();
  const effectiveConfig = useMemo(
    () => applyProtocolEnablement(config, protocolSettings),
    [config, protocolSettings],
  );
  return (
    <ProcessorConfigProvider config={effectiveConfig}>
      <PolkadotHostGate
        dotNsIdentifier={envConfig.host.productDotNs}
        derivationIndex={envConfig.host.productDerivationIndex}
      >
        <V1MonitorProvider>
          <V2MonitorProvider>{children}</V2MonitorProvider>
        </V1MonitorProvider>
      </PolkadotHostGate>
    </ProcessorConfigProvider>
  );
}
