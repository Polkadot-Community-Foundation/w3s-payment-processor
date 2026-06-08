import { useState } from "react";

import { AppProviders, AppThemeProvider } from "@/app/providers.tsx";
import { MerchantUnlockGate } from "@/app/MerchantUnlockGate.tsx";
import { RootNavigator } from "@/app/navigation/RootNavigator.tsx";
import { envConfig, type ResolvedProcessorConfig } from "@/config.ts";
import { DebugPanel } from "@/shared/api/host/debug/index.ts";

/**
 * Application root. The per-merchant config is NOT bundled: the merchant unlocks
 * it via `MerchantUnlockGate` ({ groupId, passkey } → fetch + AES-GCM decrypt +
 * validate). Until then the SPA stays locked and mounts no monitors. Once a
 * `ResolvedProcessorConfig` is unlocked, app providers gate the SPA on
 * Polkadot-host sign-in before monitors start. If both listeners are disabled,
 * the shell still mounts so Settings can re-enable them.
 */
export function App() {
  const [config, setConfig] = useState<ResolvedProcessorConfig | null>(null);
  return (
    <AppThemeProvider>
      <AppBody config={config} onUnlock={setConfig} />
      {envConfig.debug.enabled ? (
        <DebugPanel config={config} defaultOpen={envConfig.debug.openByDefault} />
      ) : null}
    </AppThemeProvider>
  );
}

function AppBody({
  config,
  onUnlock,
}: {
  config: ResolvedProcessorConfig | null;
  onUnlock: (config: ResolvedProcessorConfig) => void;
}) {
  if (!config) return <MerchantUnlockGate onUnlock={onUnlock} />;
  return (
    <AppProviders config={config}>
      <RootNavigator />
    </AppProviders>
  );
}
