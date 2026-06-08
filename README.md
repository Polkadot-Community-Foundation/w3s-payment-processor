# W3sPay Payment Processor

A per-merchant, always-on SPA that monitors two payment paths in parallel for
**one** merchant. Read-only on v1; host-mediated claims on v2. Runs standalone
(browser + direct WebSocket to the chain) or inside a Polkadot host container
(chain + statement-store + payment over the host bridge). Gated by a merchant
credential unlock before any monitor starts.

It is **standalone**: it has no `@parity/*` workspace dependencies and can be
lifted into its own repo. The Coinage wire contract is vendored verbatim in
`src/wire/` (kept byte-identical to `scripts/w3s-listener.py` /
`scripts/w3s-make-cheque-qr.py`).

## The two paths

- **v1 — `rfc6-payments`** — watches `Assets.Transferred` (W3T credits) on the
  People-system parachain for the merchant's terminal payout accounts.
  Read-only; the chain has already settled. Tracks the finalized head, persists
  a `lastObservedBlock` checkpoint, and **backfills** missed transfers from the
  checkpoint on restart so nothing is dropped across downtime.
- **v2 — `coinage-key-payments`** — subscribes to per-terminal statement-store
  topics, ECIES-decrypts incoming Coinage payloads, dedupes by payload id, and
  **claims** the bearer coins into the host wallet via `paymentTopUp(Coins)`.
  Host-only (standalone v2 is decode-only/inert). Idempotent across restarts.

Either path is independently enable-able; both off is a valid (inert) config
that surfaces a Notice.

## Configuration

The per-merchant config is **never bundled**. It is provisioned as an encrypted
envelope, fetched at unlock time, and decrypted on-device with the merchant
passkey. Login is `{ groupId, passkey }`: `groupId` names the POS fleet and is
matched against the decrypted bundle; `passkey` decrypts it.

### Credential bundle (plaintext, provisioned locally)

Authored in `.credentials/remote-credentials.local.json` (gitignored; template
at `.credentials/remote-credentials.example.json`):

```ts
{
  groupId: string;                       // POS-fleet id, entered at unlock
  profile: { merchantName: string; merchantId: string };
  v1: {
    type?: string;                         // payment protocol kind, not enablement
    remote?: { merchantRegistryAddress: string /*0x..H160*/; groupId: string };
    local?:  { terminals: { terminalId: string; label?: string; payoutAddress: string /*SS58*/ }[] };
  };
  v2: {
    type?: string;                         // payment protocol kind, not enablement
    terminals: { topicId: string; terminalId: string; label?: string; payoutAddress: string; pemFile: string }[];
  };
}
```

`loadProcessorConfig` (pure/sync) resolves this and throws `ProcessorConfigError`
with the offending **field path** on any defect; `loadRemoteCredentialBundle`
adds the `groupId` check. The SAME validator runs in the upload script (before
encrypting) and in the app (after decrypting):

- `pemFile` → 32-byte P-256 scalar (SEC1 `EC PRIVATE KEY` or PKCS#8
  `PRIVATE KEY`; non-P-256 rejected).
- `topicId` → `blake2b256("pay-w3s:" + topicId)` (no space — byte-identical to
  the Python reference).
- `payoutAddress` (SS58) → canonical 32-byte AccountId32.
- v1 requires **exactly one** of `remote` / `local`; active v2 listening requires
  non-empty terminals with **unique** topics.
  v1/v2 listening enablement comes from `VITE_V1_LISTENING_ENABLED` /
  `VITE_V2_LISTENING_ENABLED` and can be overridden on-device in Settings.

### Encrypted envelope + provisioning

`npm run upload-credentials` validates the local bundle, encrypts it
(AES-256-GCM; key derived from the passkey via PBKDF2-SHA256; the envelope
header is bound as authenticated data), self-checks that it decrypts back,
uploads **only** the encrypted bytes to the Bulletin Chain, and prints the CID,
gateway URL, and the JSON entry to merge into `VITE_CREDENTIAL_MAP` — plus a
gitignored receipt (`cid`, `blockNumber`, `extrinsicIndex`, …) for renewal
before Bulletin retention expiry. `--dry-run` does everything except touch the chain.

Envelope wire shape (UTF-8 JSON):
`{ format, version, kdf, iterations, cipher, salt, iv, ciphertext }` — `salt` /
`iv` / `ciphertext` are base64; the plaintext under `ciphertext` is the JSON
bundle above.

Chain/token/host wiring stays separate (`src/config.ts`, `VITE_*` — see
`.env.example`): network, token, host product DOTNS + derivation index, protocol
listener defaults, and credential sources (`VITE_CREDENTIAL_MAP`, `VITE_BULLETIN_IPFS_GATEWAY`).

## Persistence

Durable host KV (the `host.data` extension), scope `w3s-payment-processor:`.
Survives reload, device sleep, and webview storage eviction; standalone/dev
falls back to browser `localStorage`. Append-heavy logs use an index + per-item
layout (bounded writes):

- v1: `v1-txlog:*`, `v1-checkpoint`, `v1-report-state`, `v1-zreports:*`
- v2: `v2-records:index` + `v2-records:item:<id>`

## UI

A friendly, mobile-first **"Daybook"** console on the LocalDOT warm-stone design
system (light **+** dark, toggle in the header/sidebar). It leads with money and
a single unified payment stream — no v1/v2 method split surfaced to the owner —
and exposes only the two real actions: **check off** a payment (v1 reconcile) and
**close out the day** (v1 Z-report commit). Responsive: a sidebar on desktop, a
bottom tab bar on a phone.

Tabs: **Today** (serif takings hero, per-terminal totals, latest payments),
**All payments** (the unified stream grouped by the hour with status/terminal
filters), **Reports** (X running total → `Close out the day` → past Z closes).

Machine states render as calm plain sentences (`StateScreen`): config error
(fail-closed, with a technical-details expander), no-paths, reconnecting, and
connection-lost. When v2 is enabled but claims are off, a banner surfaces it so
"you're not collecting" never goes silent. Amounts show the configured token
symbol (`VITE_TOKEN_SYMBOL`, default `W3T`).

## Security / invariants

- v1 never signs. v2 never signs — the host claims into **its own** wallet.
  Configured `payoutAddress` values are settlement metadata for later payout,
  not a host-wallet claim gate.
- PEM keys are **never** in the SPA bundle. They live only inside the encrypted
  remote envelope and are decrypted into in-memory P-256 scalars at unlock; the
  passkey is never persisted or logged.
- Unlock fails closed: a missing/unreachable source, a wrong passkey, a tampered
  envelope, malformed JSON, an invalid config, or a `groupId` mismatch all keep
  the processor locked and mount no monitors.
- The ECIES envelope + `W3sPaymentDataV1` wire contract is shared verbatim with
  `@parity/w3s-receiver-core` and pinned to the two Python reference scripts.

## Develop / deploy

```sh
npm --workspace apps/w3s-payment-processor run dev          # http://localhost:5176
npm --workspace apps/w3s-payment-processor run typecheck
npm --workspace apps/w3s-payment-processor run test
npm --workspace apps/w3s-payment-processor run validate-config        # static chain/token/host only
REMOTE_CREDENTIALS_PASSKEY=… npm run upload-credentials -- --dry-run  # validate + encrypt the bundle
MNEMONIC="…" ./deploy.sh                                    # builds + publishes to DotNS
```

`deploy.sh` validates the **static** config (chain/token/host env — not merchant
PEMs) before building and requires `VITE_NETWORK == BULLETIN_ENV`. Merchant
credentials are provisioned separately with `npm run upload-credentials`, which
records a renewal receipt with the Bulletin `(blockNumber, extrinsicIndex)`.
