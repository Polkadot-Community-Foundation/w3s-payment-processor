/**
 * Remote merchant-credential unlock. The per-merchant secret bundle is NEVER
 * bundled into the SPA: at unlock the merchant enters their `groupId`, the app
 * looks it up in `credentialMap` (src/config.ts) to find the encrypted bundle
 * URL, fetches it, AES-GCM-decrypts it with the passkey, validates it through
 * `loadRemoteCredentialBundle`, and group-id-checks before any monitor mounts.
 *
 * Fail-closed everywhere: an unknown group, a missing URL, an unreachable /
 * oversized source, a wrong passkey, a tampered envelope, malformed JSON, an
 * invalid config, or a group-id mismatch all throw `RemoteCredentialsError`
 * and leave the processor locked. NEVER logs the passkey, PEM, scalar,
 * decrypted JSON, or ciphertext.
 */
import {
  credentialMap,
  envConfig,
  loadRemoteCredentialBundle,
  ProcessorConfigError,
  type ResolvedProcessorConfig,
} from "@/config.ts";
import {
  decryptCredentialEnvelope,
  CredentialEnvelopeError,
} from "@/shared/utils/wire/credential-envelope.ts";

/**
 * A calm, merchant-facing failure. `message` is the plain-language line shown
 * on the locked gate; `detail` goes behind the technical-details expander —
 * both are guaranteed secret-free.
 */
export class RemoteCredentialsError extends Error {
  override readonly name = "RemoteCredentialsError";
  readonly detail?: string;
  constructor(message: string, detail?: string) {
    super(message);
    this.detail = detail;
  }
}

/** Reject envelopes far larger than a real encrypted bundle. */
const MAX_ENVELOPE_BYTES = 256 * 1024;

const IPFS_SCHEME = "ipfs://";

/**
 * Resolve a configured credentials source to a fetchable URL: `ipfs://<cid>`
 * is rewritten through the configured IPFS gateway; `http(s)://` is passed
 * through. Throws `RemoteCredentialsError` on an empty, malformed, or
 * unsupported value.
 */
export function resolveCredentialUrl(url: string, ipfsGateway: string): string {
  const trimmed = url.trim();
  if (trimmed === "") {
    throw new RemoteCredentialsError(
      "this terminal has no credentials source configured",
      "Set VITE_BULLETIN_IPFS_GATEWAY and add the CID to credentialMap in src/config.ts.",
    );
  }
  if (trimmed.startsWith(IPFS_SCHEME)) {
    const cid = trimmed.slice(IPFS_SCHEME.length).replace(/^\/+/, "");
    if (cid === "") {
      throw new RemoteCredentialsError("the credentials source URL is malformed", "ipfs:// URL has no CID.");
    }
    return `${ipfsGateway.replace(/\/+$/, "")}/ipfs/${cid}`;
  }
  if (trimmed.startsWith("https://") || trimmed.startsWith("http://")) return trimmed;
  throw new RemoteCredentialsError(
    "the credentials source URL is unsupported",
    "Use an https:// URL or ipfs://<cid>.",
  );
}

/**
 * Fetch and JSON-parse the encrypted envelope for `groupId`. Looks up the URL
 * from `credentialMap` in `src/config.ts`; fails closed when the group has no
 * entry, the entry is empty, the source is unreachable, oversized, or non-JSON.
 */
export async function fetchCredentialEnvelope(groupId: string): Promise<unknown> {
  const rawUrl = credentialMap[groupId];
  if (!rawUrl) {
    throw new RemoteCredentialsError(
      `no credentials configured for group "${groupId}"`,
      `Add an entry for "${groupId}" in credentialMap in src/config.ts, then run: npm run upload-credentials`,
    );
  }
  const url = resolveCredentialUrl(rawUrl, envConfig.remoteCredentials.ipfsGateway);
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store" });
  } catch {
    throw new RemoteCredentialsError(
      "couldn't reach the credentials source",
      `Network error fetching ${url}.`,
    );
  }
  if (!response.ok) {
    throw new RemoteCredentialsError(
      "the credentials source returned an error",
      `HTTP ${response.status} fetching ${url}.`,
    );
  }
  const text = await response.text();
  if (text.length > MAX_ENVELOPE_BYTES) {
    throw new RemoteCredentialsError(
      "the credentials envelope is unexpectedly large",
      `Envelope exceeds ${MAX_ENVELOPE_BYTES} bytes — refusing to process.`,
    );
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new RemoteCredentialsError(
      "the credentials source did not return a valid envelope",
      "Response body was not JSON.",
    );
  }
}

export interface ResolveRemoteOptions {
  /** Test/provisioning seam: supply the envelope directly instead of fetching. */
  envelope?: unknown;
}

/**
 * The merchant unlock: look up group → fetch → decrypt → validate → group-id
 * check. Returns a fully-resolved `ResolvedProcessorConfig` (non-null v2
 * `privKey`s) the app mounts against. Throws `RemoteCredentialsError` (locked)
 * on any failure.
 */
export async function resolveRemoteProcessorConfig(
  groupId: string,
  passkey: string,
  options: ResolveRemoteOptions = {},
): Promise<ResolvedProcessorConfig> {
  const wantedGroupId = groupId.trim();
  if (wantedGroupId === "") throw new RemoteCredentialsError("enter your POS group id");
  if (passkey === "") throw new RemoteCredentialsError("enter your unlock passkey");

  const envelope = options.envelope ?? (await fetchCredentialEnvelope(wantedGroupId));

  let plaintext: Uint8Array;
  try {
    plaintext = await decryptCredentialEnvelope(envelope, passkey);
  } catch (cause) {
    const detail = cause instanceof CredentialEnvelopeError ? cause.message : undefined;
    throw new RemoteCredentialsError("couldn't unlock — check your passkey", detail);
  }

  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(plaintext)) as unknown;
  } catch {
    throw new RemoteCredentialsError(
      "the unlocked credentials are malformed",
      "Decrypted payload was not valid JSON.",
    );
  } finally {
    // Best-effort wipe of the decrypted bytes; JS strings can't be erased.
    plaintext.fill(0);
  }

  let bundleGroupId: string;
  let config: ResolvedProcessorConfig;
  try {
    const bundle = loadRemoteCredentialBundle(json, envConfig.protocols);
    bundleGroupId = bundle.groupId;
    config = bundle.config;
  } catch (cause) {
    const detail = cause instanceof ProcessorConfigError ? cause.message : undefined;
    throw new RemoteCredentialsError("the unlocked credentials are invalid", detail);
  }

  if (bundleGroupId !== wantedGroupId) {
    throw new RemoteCredentialsError(
      "these credentials are for a different POS group",
      `The envelope's group id does not match "${wantedGroupId}".`,
    );
  }

  return config;
}
