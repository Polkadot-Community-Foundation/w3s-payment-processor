// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * Network registry. Source of truth for per-network chain endpoints. The
 * active network is chosen at deploy time via `VITE_NETWORK`; `resolveNetwork`
 * throws on unknown keys so a misconfigured deploy fails loudly at boot.
 *
 * - `mainChain` — Asset Hub-like parachain where the pallet-revive
 *   `W3SPayRegistry` lives (v1 remote registry reads).
 * - `peopleChain` — People-system parachain where the W3T/CASH foreign asset
 *   lives (`pallet-assets`): the v1 `Assets.Transferred` watch + balance reads.
 *
 * Trimmed from `apps/w3spay-admin/src/shared/api/host/networks.ts`; genesis
 * hashes mirror that registry (verified live against the running chains).
 */
export type NetworkKey = "paseo" | "paseo-next-v2" | "previewnet" | "summit";

export const SUPPORTED_NETWORKS: NetworkKey[] = ["paseo", "paseo-next-v2", "previewnet", "summit"];

/**
 * Summit is the production network — default there so a bare build (no
 * VITE_NETWORK) targets production. Override via VITE_NETWORK for paseo dev.
 */
export const DEFAULT_NETWORK: NetworkKey = "summit";

export interface ChainEndpoint {
  /** WebSocket RPC URL for direct (standalone) connection. */
  wsUrl: string;
  /** Genesis hash — PAPI client cache key + host `createPapiProvider` chain id. */
  genesisHash: `0x${string}` | "";
}

export interface NetworkConfig {
  key: NetworkKey;
  displayName: string;
  isTestnet: boolean;
  /** Asset Hub-like parachain — pallet-revive registry contracts. */
  mainChain: ChainEndpoint;
  /** People-system parachain — W3T/CASH foreign asset. null ⇒ unavailable. */
  peopleChain: ChainEndpoint | null;
  /**
   * HTTP IPFS gateway used to resolve the `ipfs://<cid>` per-merchant config
   * envelopes (`remote-credentials.ts` appends `/ipfs/<cid>`). Network-derived
   * so a deploy gets the right gateway from `VITE_NETWORK` alone; the
   * `VITE_BULLETIN_IPFS_GATEWAY` env var still overrides per-deploy.
   */
  ipfsGateway: string;
}

export const NETWORKS: Record<NetworkKey, NetworkConfig> = {
  paseo: {
    key: "paseo",
    displayName: "Paseo Asset Hub",
    isTestnet: true,
    mainChain: {
      wsUrl: "wss://asset-hub-paseo.ibp.network",
      genesisHash: "0xd6eec26135305a8ad257a20d003357284c8aa03d0bdb2b357ab0a22371e11ef2",
    },
    peopleChain: null,
    ipfsGateway: "https://paseo-ipfs.polkadot.io",
  },
  "paseo-next-v2": {
    key: "paseo-next-v2",
    displayName: "Paseo Next V2",
    isTestnet: true,
    mainChain: {
      wsUrl: "wss://paseo-asset-hub-next-rpc.polkadot.io",
      genesisHash: "0xbf0488dbe9daa1de1c08c5f743e26fdc2a4ecd74cf87dd1b4b1eeb99ae4ef19f",
    },
    peopleChain: {
      wsUrl: "wss://paseo-people-next-system-rpc.polkadot.io",
      genesisHash: "0xc5af1826b31493f08b7e2a823842f98575b806a784126f28da9608c68665afa5",
    },
    ipfsGateway: "https://paseo-bulletin-next-ipfs.polkadot.io",
  },
  previewnet: {
    key: "previewnet",
    displayName: "Previewnet (substrate.dev)",
    isTestnet: true,
    mainChain: {
      wsUrl: "wss://previewnet.substrate.dev/asset-hub",
      genesisHash: "0x29f7b15e6227f86b90bf5199b5c872c28649a30e5f15fae6dd8fa9d5d48d6fbb",
    },
    peopleChain: null,
    ipfsGateway: "https://previewnet.substrate.dev/ipfs/",
  },
  summit: {
    key: "summit",
    displayName: "Summit",
    isTestnet: true,
    // Endpoints + genesis hashes verified live against the Summit chains
    // (chain_getBlockHash(0)); they mirror the Summit deployment register and
    // the polkadot-app-deploy built-in `summit` env. Native token SUM/10-dec.
    mainChain: {
      wsUrl: "wss://summit-asset-hub-rpc.polkadot.io",
      genesisHash: "0xf388dc6d6cdf6fb77eac3c4a91f31bc0c8642b142f1a757512ab7849f9f70660",
    },
    // Summit People — hosts the CASH foreign asset (v1 Assets watch + balance).
    // Null-guarded consumers degrade gracefully if absent.
    peopleChain: {
      wsUrl: "wss://summit-people-rpc.polkadot.io",
      genesisHash: "0xbe5238f82c3553bc57ac3be43bef110bd58c49ad0744110814985195ca7d8c4e",
    },
    ipfsGateway: "https://summit-ipfs.polkadot.io",
  },
};

export function parseNetworkKey(value: string | undefined | null): NetworkKey | null {
  if (!value) return null;
  return (SUPPORTED_NETWORKS as string[]).includes(value) ? (value as NetworkKey) : null;
}

/** Resolve a network key to its config; throws on unknown so deploys fail loud. */
export function resolveNetwork(key: string | undefined | null): NetworkConfig {
  if (!key) return NETWORKS[DEFAULT_NETWORK];
  const parsed = parseNetworkKey(key);
  if (!parsed) {
    throw new Error(`Unknown network "${key}". Valid values: ${SUPPORTED_NETWORKS.join(", ")}`);
  }
  return NETWORKS[parsed];
}
