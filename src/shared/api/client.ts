/**
 * PAPI client cache. One client per genesis hash + transport strategy.
 *
 * Host mode is host-first: route PAPI JSON-RPC through the Polkadot host bridge
 * with the direct WebSocket provider as the SDK fallback when a host does not
 * advertise the requested chain. Standalone mode uses the direct WebSocket
 * provider. This mirrors `w3spay-admin`'s balance reads while keeping the
 * processor usable in a plain browser tab.
 */
import { createPapiProvider } from "@/shared/api/host/host-api.ts";
import { getWsProvider } from "@polkadot-api/ws-provider";
import { createClient, type PolkadotClient } from "polkadot-api";

import { envConfig } from "@/config.ts"
import { isInHost, requestRemoteOriginPermission } from "@/shared/api/host/connection.ts";

const clientCache = new Map<string, PolkadotClient>();


export function getOrCreateClient(
  genesis: `0x${string}`,
  wsUrl: string
): PolkadotClient {
  const cacheKey = `${genesis}`;
  if (clientCache.has(cacheKey)) return clientCache.get(cacheKey)!;
  const provider = createPapiProvider(genesis, getWsProvider(wsUrl));
  const client = createClient(provider);
  clientCache.set(cacheKey, client);
  return client;
}

/** Asset Hub-like main chain client — pallet-revive registry reads (v1 remote). */
export function mainChainClient(): PolkadotClient {
  const { mainChain } = envConfig.network;
  return getOrCreateClient(mainChain.genesisHash as `0x${string}`, mainChain.wsUrl);
}

/**
 * People-system parachain client — `Assets.Transferred` watch + balances.
 * Returns `null` when the active network has no people chain (v1 then surfaces
 * a Notice rather than silently watching nothing).
 */
export function peopleChainClient(): PolkadotClient | null {
  const { peopleChain } = envConfig.network;
  if (!peopleChain) return null;
  return getOrCreateClient(peopleChain.genesisHash as `0x${string}`, peopleChain.wsUrl);
}

/**
 * Drop and recreate the People-chain client. PAPI's `chainHead_v1_follow`
 * lives for the lifetime of the client; if the host suspends and resumes its
 * chain WS without emitting a `Stop` event (observed on iOS host wake), the
 * follow ID held by PAPI is stale and no further blocks surface. Destroying
 * the client tears down the dead follow; recreating forces a fresh
 * `chainHead_v1_follow` on the now-reconnected WS. No-op when no people chain
 * is configured.
 */
export function recreatePeopleChainClient(): PolkadotClient | null {
  const { peopleChain } = envConfig.network;
  if (!peopleChain) return null;
  const key = peopleChain.genesisHash as `0x${string}`;
  const existing = clientCache.get(key);
  if (existing) {
    try {
      existing.destroy();
    } catch {
      // PAPI's destroy can throw when called mid-handshake on the host
      // bridge; the cache eviction below still makes the next lookup recreate.
    }
    clientCache.delete(key);
  }
  return peopleChainClient();
}

/**
 * In-host, ask the host to allowlist outbound WS to the configured chain RPC
 * endpoints for the direct-WS fallback path. No-op standalone. Call once at
 * boot before creating clients.
 */
export async function requestChainRemotePermissions(): Promise<void> {
  if (!isInHost()) return;
  const origins: string[] = [];
  for (const endpoint of [envConfig.network.mainChain, envConfig.network.peopleChain]) {
    if (!endpoint) continue;
    try {
      origins.push(new URL(endpoint.wsUrl).hostname);
    } catch {
      // Malformed wsUrl — skip; the client connect will surface the failure.
    }
  }
  if (origins.length > 0) await requestRemoteOriginPermission([...new Set(origins)]);
}

/** Test / HMR only — drop all cached clients so the next call rebuilds. */
export function resetClientCache(): void {
  clientCache.forEach((client) => client.destroy());
  clientCache.clear();
}
