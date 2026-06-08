/**
 * The app's single config module. Two concerns, one file, so there is exactly
 * one place to look:
 *
 *   ENV      — everything resolved from `import.meta.env`: chain/token/host
 *              wiring (`envConfig`), telemetry (`telemetryConfig`), and the dev
 *              flag (`isDev`). The single audit point for what a deploy can
 *              override; NEVER read `import.meta.env` anywhere else.
 *
 *   MERCHANT — the per-merchant config (WHO + which v1/v2 terminals) is NEVER
 *              bundled. It is fetched at unlock time as an encrypted envelope
 *              (`@/shared/api/remote-credentials`), AES-GCM-decrypted with the
 *              merchant passkey, then validated + resolved by the SAME
 *              `loadProcessorConfig` (PEM → P-256 scalar, topicId → topic,
 *              SS58 → AccountId32). `loadRemoteCredentialBundle` adds the
 *              group-id check; no secret-bearing config exists at module init.
 *
 * Types live in `./config/types.ts`; resolution logic in `./config/processor.ts`.
 * This file is the single import point — consumers always import from `@/config`.
 */
import { resolveNetwork, type NetworkKey } from "@/shared/api/host/networks.ts";

// ── Re-exports — keep "@/config" as the one import point for consumers ────────

export type {
  HostConfig,
  PaymentProcessorConfigInput,
  ProcessorEnvConfig,
  ProtocolEnablement,
  RemoteCredentialBundle,
  ResolvedPayout,
  ResolvedProcessorConfig,
  ResolvedProfile,
  ResolvedV1,
  ResolvedV1Mode,
  ResolvedV1Terminal,
  ResolvedV2,
  ResolvedV2Terminal,
  TelemetryConfig,
  TokenConfig,
  TokenLocation,
} from "./config/types.ts";
export { ProcessorConfigError } from "./config/types.ts";
export { loadProcessorConfig, loadRemoteCredentialBundle } from "./config/processor.ts";

// ── ENV (import.meta.env) ═════════════════════════════════════════════════════

// Helpers — private to this module; only `import.meta.env` is read here.

function readString(key: string, fallback: string): string {
  const value = import.meta.env[key];
  return typeof value === "string" && value.trim() !== "" ? value : fallback;
}

function readInt(key: string, fallback: number): number {
  const value = import.meta.env[key];
  if (typeof value !== "string" || value.trim() === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readBigInt(key: string, fallback: bigint): bigint {
  const value = import.meta.env[key];
  if (typeof value !== "string" || value.trim() === "") return fallback;
  try {
    return BigInt(value);
  } catch {
    return fallback;
  }
}

function readBool(key: string, fallback: boolean): boolean {
  const value = import.meta.env[key];
  if (typeof value !== "string" || value.trim() === "") return fallback;
  return value.trim().toLowerCase() === "true";
}

function readEnv() {
  const networkKey = (import.meta.env.VITE_NETWORK as NetworkKey | undefined) ?? undefined;
  const network = resolveNetwork(networkKey);

  const parachainId = readInt("VITE_TOKEN_PARACHAIN_ID", 1500);
  const palletInstance = readInt("VITE_TOKEN_PALLET_INSTANCE", 50);
  const generalIndex = readBigInt("VITE_TOKEN_ASSET_ID", 50_000_413n);

  return {
    networkKey: network.key,
    network,
    token: {
      symbol: readString("VITE_TOKEN_SYMBOL", "CASH"),
      decimals: readInt("VITE_TOKEN_DECIMALS", 6),
      parachainId,
      palletInstance,
      generalIndex,
      location: {
        parents: 1,
        interior: {
          type: "X3" as const,
          value: [
            { type: "Parachain" as const, value: parachainId },
            { type: "PalletInstance" as const, value: palletInstance },
            { type: "GeneralIndex" as const, value: generalIndex },
          ],
        },
      },
    },
    host: {
      productDotNs: readString("VITE_HOST_PRODUCT_DOTNS", "w3spaymentprocessor.dot"),
      productDerivationIndex: readInt("VITE_HOST_DERIVATION_INDEX", 0),
    },
    // Default dry-run origin = the well-known Alice account; reads are gasless
    // dry-runs so the origin only needs to be a valid, funded-enough AccountId.
    readOnlyOrigin: readString(
      "VITE_READ_ONLY_ORIGIN",
      "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
    ),
    protocols: {
      v1Enabled: readBool("VITE_V1_LISTENING_ENABLED", true),
      v2Enabled: readBool("VITE_V2_LISTENING_ENABLED", true),
    },
    debug: {
      enabled: readBool("VITE_DEBUG_PANEL", true),
      openByDefault: readBool("VITE_DEBUG_PANEL_OPEN", false),
    },
    remoteCredentials: {
      ipfsGateway: readString(
        "VITE_BULLETIN_IPFS_GATEWAY",
        "https://paseo-bulletin-next-ipfs.polkadot.io",
      ),
    },
  };
}

/** Process-wide chain/token/host env singleton, resolved once at module load. */
export const envConfig = readEnv();

/**
 * Maps each POS group id to the HTTPS URL or `ipfs://<cid>` of its
 * AES-256-GCM-encrypted credential bundle. Parsed from `VITE_CREDENTIAL_MAP`
 * — a JSON object string so deployments require no source change:
 *
 *   VITE_CREDENTIAL_MAP={"funkhaus-pos":"ipfs://bafk...","westside":"https://host/w.json"}
 *
 * CIDs are not secrets; only the merchant passkey unlocks the content.
 * An unset or empty env var yields an empty map (app stays locked until configured).
 */
export const credentialMap: Record<string, string> = (() => {
  const raw = (import.meta.env.VITE_CREDENTIAL_MAP as string | undefined) ?? "";
  if (!raw.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      console.error("VITE_CREDENTIAL_MAP must be a JSON object — ignoring");
      return {};
    }
    const map: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string" && k && v) map[k] = v;
    }
    return map;
  } catch {
    console.error("VITE_CREDENTIAL_MAP is not valid JSON — ignoring");
    return {};
  }
})();

/**
 * Resolved Sentry config. Pure (never throws), so importing this module — which
 * `instrument.ts` does as the very first import — stays side-effect-free.
 * `instrument.ts` owns the opt-in: it only initialises the SDK when `dsn` is set.
 */
export const telemetryConfig = {
  dsn: (import.meta.env.VITE_SENTRY_DSN ?? "").trim(),
  environment: import.meta.env.VITE_SENTRY_ENV ?? import.meta.env.MODE,
  tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE ?? "1") || 1,
};

/** True under `vite dev`; false in any production bundle. */
export const isDev: boolean = import.meta.env.DEV;
