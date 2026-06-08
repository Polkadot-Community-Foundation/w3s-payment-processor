// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

import { createContext, useContext, type ReactNode } from "react";

import type { ResolvedProcessorConfig } from "@/config.ts"

const ConfigContext = createContext<ResolvedProcessorConfig | null>(null);

export function ProcessorConfigProvider({
  config,
  children,
}: {
  config: ResolvedProcessorConfig;
  children: ReactNode;
}) {
  return <ConfigContext.Provider value={config}>{children}</ConfigContext.Provider>;
}

export function useProcessorConfig(): ResolvedProcessorConfig {
  const config = useContext(ConfigContext);
  if (!config) throw new Error("useProcessorConfig used outside ProcessorConfigProvider");
  return config;
}
