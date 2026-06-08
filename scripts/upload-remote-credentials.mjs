// Provisioning: validate → encrypt → store the per-merchant credential bundle
// on the Bulletin Chain as the ONE documented AES-256-GCM envelope the browser
// unlock path (`src/shared/api/remote-credentials.ts`) decrypts. The plaintext
// bundle (profile + v1 + v2 terminals incl. PEM) NEVER touches the built SPA;
// only the encrypted envelope is uploaded.
//
// Run via vite-node so the TS `@/` alias + import.meta.env resolve:
//
//   # Validate + encrypt + CID + decrypt self-check, no chain writes:
//   REMOTE_CREDENTIALS_PASSKEY=… npm run upload-credentials -- --dry-run
//
//   # Real upload (needs an authorized Bulletin account):
//   REMOTE_CREDENTIALS_PASSKEY=… MNEMONIC=… npm run upload-credentials
//
// Flags:
//   --input <path>        plaintext bundle JSON (default .credentials/remote-credentials.local.json)
//   --dry-run             validate + encrypt + self-check only; never touches the chain
//   --env <id>            bulletin-deploy env id (default $BULLETIN_ENV or paseo-next-v2)
//   --passkey-env <NAME>  env var holding the encryption passkey (default REMOTE_CREDENTIALS_PASSKEY)
//   --mnemonic-env <NAME> env var holding the uploader mnemonic (default MNEMONIC)
//   --iterations <n>      PBKDF2 iterations (default the module default)
//   --receipt <path>      receipt output (default .credentials/remote-credentials.receipt.json)
//
// Secrets (passkey, mnemonic, PEM) are read from files/env ONLY and are NEVER
// printed or written to the receipt. Heavy chain deps load lazily so --dry-run
// pulls nothing it does not need.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { CID } from "multiformats/cid";
import * as Digest from "multiformats/hashes/digest";
import { blake2b } from "@noble/hashes/blake2.js";

import { loadRemoteCredentialBundle } from "../src/config.ts";
import {
  encryptCredentialEnvelope,
  decryptCredentialEnvelope,
  DEFAULT_PBKDF2_ITERATIONS,
} from "../src/shared/utils/wire/credential-envelope.ts";
import { accountId32ToSs58 } from "../src/shared/utils/address.ts";

// Bulletin content-address default: blake2b-256 (0xb220) + raw codec (0x55).
const BLAKE2B_256_CODE = 0xb220;
const RAW_CODEC = 0x55;
// A credential bundle is tiny; refuse sizes that imply a mistake (no chunking).
const MAX_PLAINTEXT_BYTES = 64 * 1024;
const MAX_ENVELOPE_BYTES = 256 * 1024;

const DEFAULT_INPUT = ".credentials/remote-credentials.local.json";
const DEFAULT_RECEIPT = ".credentials/remote-credentials.receipt.json";

function fail(message) {
  console.error(`upload-credentials: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = {
    input: DEFAULT_INPUT,
    dryRun: false,
    env: process.env.BULLETIN_ENV ?? "paseo-next-v2",
    passkeyEnv: "REMOTE_CREDENTIALS_PASSKEY",
    mnemonicEnv: undefined,
    iterations: DEFAULT_PBKDF2_ITERATIONS,
    receipt: DEFAULT_RECEIPT,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) fail(`missing value for ${arg}`);
      return v;
    };
    switch (arg) {
      case "--dry-run": opts.dryRun = true; break;
      case "--input": opts.input = next(); break;
      case "--env": opts.env = next(); break;
      case "--passkey-env": opts.passkeyEnv = next(); break;
      case "--mnemonic-env": opts.mnemonicEnv = next(); break;
      case "--receipt": opts.receipt = next(); break;
      case "--iterations": {
        const n = Number.parseInt(next(), 10);
        if (!Number.isInteger(n)) fail("--iterations must be an integer");
        opts.iterations = n;
        break;
      }
      default:
        if (arg.startsWith("--")) fail(`unknown flag ${arg}`);
        // Ignore non-flag positionals (e.g. vite-node may inject the script path).
    }
  }
  return opts;
}

function computeCid(bytes) {
  const hash = blake2b(bytes, { dkLen: 32 });
  return CID.createV1(RAW_CODEC, Digest.create(BLAKE2B_256_CODE, hash)).toString();
}

function readPasskey(passkeyEnv) {
  const passkey = process.env[passkeyEnv];
  if (!passkey || passkey === "") {
    fail(`set the encryption passkey in $${passkeyEnv} (never pass it as an argument)`);
  }
  return passkey;
}

function readBundle(inputPath) {
  const abs = resolve(inputPath);
  let text;
  try {
    text = readFileSync(abs, "utf8");
  } catch {
    return fail(`cannot read plaintext bundle at ${abs}`);
  }
  if (text.length > MAX_PLAINTEXT_BYTES) {
    fail(`plaintext bundle exceeds ${MAX_PLAINTEXT_BYTES} bytes — refusing (no chunking)`);
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return fail(`plaintext bundle is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  // Validate through the SAME path the app uses after decrypting; throws
  // ProcessorConfigError with the offending field path on any defect.
  try {
    return { json, bundle: loadRemoteCredentialBundle(json) };
  } catch (error) {
    return fail(`plaintext bundle is invalid — ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Encrypt, enforce size, and self-check the envelope decrypts to the same bundle. */
async function buildEnvelope(json, bundle, passkey, iterations) {
  const plaintext = new TextEncoder().encode(JSON.stringify(json));
  const envelope = await encryptCredentialEnvelope(plaintext, passkey, iterations);
  const envelopeBytes = new TextEncoder().encode(JSON.stringify(envelope));
  if (envelopeBytes.length > MAX_ENVELOPE_BYTES) {
    fail(`encrypted envelope exceeds ${MAX_ENVELOPE_BYTES} bytes — refusing (no chunking)`);
  }
  // Never upload an envelope we can't unlock: decrypt + re-validate now.
  const roundTrip = await decryptCredentialEnvelope(JSON.parse(new TextDecoder().decode(envelopeBytes)), passkey);
  const reloaded = loadRemoteCredentialBundle(JSON.parse(new TextDecoder().decode(roundTrip)));
  if (reloaded.groupId !== bundle.groupId) {
    fail("self-check failed: decrypted envelope did not round-trip to the same bundle");
  }
  return envelopeBytes;
}

async function signerFromMnemonic(mnemonicEnv) {
  const name = mnemonicEnv ?? "MNEMONIC";
  const raw = process.env[name];
  if (!raw || raw.trim() === "") {
    fail(`set the uploader mnemonic in $${name} (or choose a different env var with --mnemonic-env NAME)`);
  }
  const { getPolkadotSigner } = await import("polkadot-api/signer");
  const { sr25519CreateDerive } = await import("@polkadot-labs/hdkd");
  const { entropyToMiniSecret, mnemonicToEntropy } = await import("@polkadot-labs/hdkd-helpers");
  const mnemonic = raw.trim().replace(/\s+/g, " ");
  const miniSecret = entropyToMiniSecret(mnemonicToEntropy(mnemonic));
  const keypair = sr25519CreateDerive(miniSecret)("");
  const signer = getPolkadotSigner(keypair.publicKey, "Sr25519", keypair.sign);
  return { signer, address: accountId32ToSs58(keypair.publicKey) };
}

async function resolveBulletin(envId) {
  const { loadEnvironments, resolveEndpoints } = await import("bulletin-deploy");
  const { doc } = await loadEnvironments();
  const endpoints = resolveEndpoints(doc, envId);
  const ws = Array.isArray(endpoints.bulletin) ? endpoints.bulletin[0] : endpoints.bulletin;
  if (!ws) fail(`no bulletin endpoint for env "${envId}"`);
  const gateway = (endpoints.ipfs ?? "").replace(/\/+$/, "");
  if (gateway === "") fail(`no IPFS gateway for env "${envId}"`);
  return { ws, gateway };
}

/** Submit a tx and resolve with its (blockNumber, extrinsicIndex) on best-block inclusion. */
function submitAndWait(tx, signer) {
  return new Promise((resolveTx, rejectTx) => {
    let sub;
    const timeout = setTimeout(() => {
      sub?.unsubscribe();
      rejectTx(new Error("transaction timed out after 180s"));
    }, 180_000);
    sub = tx.signSubmitAndWatch(signer).subscribe({
      next: (ev) => {
        if (ev.type === "txBestBlocksState" && ev.found) {
          clearTimeout(timeout);
          sub.unsubscribe();
          if (!ev.ok) {
            rejectTx(new Error(`extrinsic failed: ${JSON.stringify(ev.dispatchError ?? "unknown")}`));
            return;
          }
          resolveTx({ blockNumber: ev.block.number, extrinsicIndex: ev.block.index });
        }
      },
      error: (err) => {
        clearTimeout(timeout);
        sub?.unsubscribe();
        rejectTx(err instanceof Error ? err : new Error(String(err)));
      },
    });
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const passkey = readPasskey(opts.passkeyEnv);
  const { json, bundle } = readBundle(opts.input);
  const envelopeBytes = await buildEnvelope(json, bundle, passkey, opts.iterations);
  const cid = computeCid(envelopeBytes);
  const terminalCount = bundle.config.v2.terminals.length;

  console.log(
    `bundle OK — group "${bundle.groupId}", merchant "${bundle.config.profile.merchantName}", ` +
      `v2 terminals ${terminalCount}; ` +
      `envelope ${envelopeBytes.length} bytes; CID ${cid}`,
  );

  if (opts.dryRun) {
    console.log("dry-run: chain untouched. Self-check passed (envelope decrypts to the same bundle).");
    console.log(`\nAdd to VITE_CREDENTIAL_MAP in .env.local (merge into the existing JSON object if other groups exist):`);
    console.log(`  "${bundle.groupId}": "ipfs://${cid}"`);
    return;
  }

  const { signer, address } = await signerFromMnemonic(opts.mnemonicEnv);
  const { ws, gateway } = await resolveBulletin(opts.env);
  console.log(`==> Uploading as ${address} to ${ws} (env ${opts.env})...`);

  const { Binary, Enum, createClient } = await import("polkadot-api");
  const { getWsProvider } = await import("@polkadot-api/ws-provider");
  const client = createClient(getWsProvider(ws));
  try {
    const api = client.getUnsafeApi();
    const auth = await api.query.TransactionStorage.Authorizations.getValue(Enum("Account", address));
    if (!auth || Number(auth.extent.transactions) <= 0 || auth.extent.bytes < BigInt(envelopeBytes.length)) {
      fail(
        `account ${address} is not authorized to store ${envelopeBytes.length} bytes on the Bulletin Chain ` +
          `(env ${opts.env}). Request TransactionStorage authorization first.`,
      );
    }
    const tx = api.tx.TransactionStorage.store({ data: Binary.fromHex("0x" + Buffer.from(envelopeBytes).toString("hex")) });
    const { blockNumber, extrinsicIndex } = await submitAndWait(tx, signer);
    const gatewayUrl = `${gateway}/ipfs/${cid}`;
    const receipt = {
      cid,
      gatewayUrl,
      blockNumber,
      extrinsicIndex,
      groupId: bundle.groupId,
      env: opts.env,
      byteSize: envelopeBytes.length,
      iterations: opts.iterations,
      createdAt: new Date().toISOString(),
    };
    const receiptPath = resolve(opts.receipt);
    mkdirSync(dirname(receiptPath), { recursive: true });
    writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);

    console.log("==> Done. Encrypted credential envelope stored.");
    console.log(`  CID:         ${cid}`);
    console.log(`  Gateway URL: ${gatewayUrl}`);
    console.log(`  Stored at:   block ${blockNumber}, extrinsic ${extrinsicIndex} (use to renew before retention expiry)`);
    console.log(`  Receipt:     ${receiptPath}`);
    console.log("\nAdd to VITE_CREDENTIAL_MAP in .env.local (merge into the existing JSON object if other groups exist):");
    console.log(`  "${bundle.groupId}": "ipfs://${cid}"`);
  } finally {
    client.destroy();
  }
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
