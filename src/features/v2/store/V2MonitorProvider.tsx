import { useEffect, type ReactNode } from "react";

import { useProcessorConfig } from "@/shared/store/useProcessorConfig.tsx";
import { startV2Monitor, type V2MonitorHandle } from "@/features/v2/api/engine.ts";
import { useV2Store } from "@/features/v2/store/useV2Store.ts";

/** Starts the v2 engine while v2 is enabled with terminals. */
export function V2MonitorProvider({ children }: { children: ReactNode }) {
  const config = useProcessorConfig();

  useEffect(() => {
    if (!config.v2.enabled || config.v2.terminals.length === 0) return;
    // One controller per run. Cleanup aborts it, tearing down the in-flight
    // startup + subscriptions so a StrictMode remount or settings toggle can't
    // leave two monitors double-subscribed to the same statement topics.
    const controller = new AbortController();
    let live: V2MonitorHandle | null = null;
    void startV2Monitor(config.v2.terminals, controller.signal).then((resolved) => {
      live = resolved;
      if (controller.signal.aborted) resolved.stop();
    });
    return () => {
      controller.abort();
      live?.stop();
    };
  }, [config]);

  return <>{children}</>;
}

/** v2 live state (records, claim status, fail-closed notice). */
export function useV2Monitor() {
  return useV2Store();
}
