/**
 * All config types — both raw/input shapes and the fully-resolved shapes the
 * runtime works with. Imported by `src/config.ts` (the public surface) and
 * `src/config/processor.ts` (the resolution logic).
 */
import type { AccountId32Hex, H160Hex } from "@/shared/utils/address.ts";
import type { NetworkConfig, NetworkKey } from "@/shared/api/host/networks.ts";

// ── ENV ──────────────────────────────────────────────────────────────────────

/**
 * XCM Location key for the W3T/CASH foreign asset on the People-system
 * parachain. `Assets.Account(<location>, <ss58>)` is keyed by this, and
 * `Assets.Transferred.asset_id` decodes to the same shape — so it doubles as
 * the event matcher. Shape matches polkadot-api's decoded V4/V5 Location.
 */
export interface TokenLocation {
  parents: number;
  interior: {
    type: "X3";
    value: [
      { type: "Parachain"; value: number },
      { type: "PalletInstance"; value: number },
      { type: "GeneralIndex"; value: bigint },
    ];
  };
}

export interface TokenConfig {
  /** Display ticker. */
  symbol: string;
  /** Smallest-unit decimals — chain amounts are `10^decimals` sub-units. */
  decimals: number;
  /** Source parachain of the asset (AssetHub-like). */
  parachainId: number;
  /** `pallet-assets` instance index on the source parachain. */
  palletInstance: number;
  /** Asset id (GeneralIndex) of the token on its source parachain. */
  generalIndex: bigint;
  /** Derived XCM Location used as the `Assets` storage + event key. */
  location: TokenLocation;
}

export interface HostConfig {
  /** Product DOTNS identifier used to resolve the host product account. */
  productDotNs: string;
  /** Product-account derivation index. */
  productDerivationIndex: number;
}

export interface ProtocolEnablement {
  v1Enabled: boolean;
  v2Enabled: boolean;
}

export interface ProcessorEnvConfig {
  networkKey: NetworkKey;
  network: NetworkConfig;
  token: TokenConfig;
  host: HostConfig;
  /** Stable SS58 dry-run origin for revive registry reads. */
  readOnlyOrigin: string;
  /** Build-time defaults for v1/v2 listening; merchant settings can override locally. */
  protocols: ProtocolEnablement;
  /** In-page debug overlay (toolbox button + console/timeline/host panel). */
  debug: { enabled: boolean; openByDefault: boolean };
  /**
   * IPFS gateway used to resolve `ipfs://<cid>` entries in `credentialMap`.
   * The map itself is public; only the encrypted bundle content requires a passkey.
   */
  remoteCredentials: { ipfsGateway: string };
}

export interface TelemetryConfig {
  /** Trimmed Sentry DSN. Empty string disables telemetry (the SDK never loads). */
  dsn: string;
  /** Reported environment; falls back to the Vite build mode. */
  environment: string;
  /** Trace sample rate in [0, 1]; defaults to 1. */
  tracesSampleRate: number;
}

// ── Merchant — input shape ────────────────────────────────────────────────────

/** The per-merchant config shape — the body of the decrypted remote credential bundle. */
export interface PaymentProcessorConfigInput {
  profile: { merchantName: string; merchantId: string };
  v1: {
    type?: string;
    /** On-chain registry read, filtered by groupId. Mutually exclusive with `local`. */
    remote?: { merchantRegistryAddress: string; groupId: string };
    /** Synthesized terminals, no chain read. Mutually exclusive with `remote`. */
    local?: { terminals: { terminalId: string; label?: string; payoutAddress: string }[] };
  };
  v2: {
    type?: string;
    terminals: {
      /** The 32-byte on-wire topic as a 64-character lowercase hex string. */
      topicId: string;
      terminalId: string;
      /** Optional UI label shown instead of terminalId. */
      label?: string;
      payoutAddress: string;
      /** EC private key PEM (P-256), SEC1 or PKCS#8. Supplied ONLY via the encrypted remote envelope, NEVER bundled. */
      pemFile: string;
    }[];
  };
}

// ── Merchant — resolved shapes ────────────────────────────────────────────────

export interface ResolvedProfile {
  merchantName: string;
  merchantId: string;
}

export interface ResolvedPayout {
  /** Canonical 32-byte AccountId32. */
  accountId32: Uint8Array;
  /** SS58 string for display. */
  ss58: string;
  /** 0x-prefixed lowercase hex — stable storage / map key. */
  hex: AccountId32Hex;
}

export interface ResolvedV1Terminal {
  terminalId: string;
  /** Optional UI label for local-config terminals. */
  displayName?: string;
  payout: ResolvedPayout;
}

export type ResolvedV1Mode =
  | { kind: "remote"; merchantRegistryAddress: H160Hex; groupId: string }
  | { kind: "local"; terminals: ResolvedV1Terminal[] };

export interface ResolvedV1 {
  enabled: boolean;
  type: string;
  /** null when v1 is disabled. */
  mode: ResolvedV1Mode | null;
}

export interface ResolvedV2Terminal {
  topicId: string;
  /** 32-byte on-wire topic decoded from `topicId`. */
  topic: Uint8Array;
  /** Lowercase hex of `topic` — the topic→terminal index key. */
  topicHex: string;
  terminalId: string;
  /** Optional UI label shown instead of terminalId. */
  label?: string;
  payout: ResolvedPayout;
  /** 32-byte P-256 private scalar for ECIES decrypt. */
  privKey: Uint8Array;
  /** Uncompressed SEC1 public point (65 bytes). */
  publicKeyUncompressed: Uint8Array;
}

export interface ResolvedV2 {
  enabled: boolean;
  type: string;
  terminals: ResolvedV2Terminal[];
}

export interface ResolvedProcessorConfig {
  profile: ResolvedProfile;
  v1: ResolvedV1;
  v2: ResolvedV2;
  /** True when neither path is active — the UI renders an inert config Notice. */
  inert: boolean;
}

export interface RemoteCredentialBundle {
  /** POS-fleet identifier the merchant enters at unlock; matched against the decrypted envelope. */
  groupId: string;
  /** The validated, fully-resolved merchant config the UI mounts against. */
  config: ResolvedProcessorConfig;
}

// ── Error ─────────────────────────────────────────────────────────────────────

/** Thrown by `loadProcessorConfig` / `loadRemoteCredentialBundle` with the offending field path. */
export class ProcessorConfigError extends Error {
  override readonly name = "ProcessorConfigError";
  readonly path: string;
  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.path = path;
  }
}
