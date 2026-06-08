# W3sPay Payment Processor

> [!WARNING]
> The following is a prototype, reference implementation, and proof-of-concept. This open source code is provided for research, experimentation, and developer education only. This code has not been audited, is actively experimental, and may contain bugs, vulnerabilities, or incomplete features. Use at your own risk.

This is code developed and published by Parity as an experimental proof-of-concept. It is **not** a Parity product or service, and Parity does not operate, host, deploy, or endorse any downstream deployment of it — downstream operators run their own forks at their own discretion.

Per-merchant, always-on dashboard for the W3sPay payment surface. The app unlocks merchant credentials on device, monitors v1 on-chain CASH credits and v2 Statement Store payments in parallel, claims supported v2 bearer coins through the Polkadot host, and gives staff live totals, reconciliation, reports, and network status.

## Getting Started

### Deploy

```bash
npm install
cp .env.example .env.local        # set VITE_DOTNS_PRODUCT_DOMAIN and confirm VITE_* values
npm run validate-config
npm run deploy                    # builds and publishes the configured .dot product
```

`deploy.sh` requires a deployment mnemonic from `MNEMONIC` or `DOTNS_MNEMONIC`, and it requires `VITE_NETWORK` to match `BULLETIN_ENV`.

### Provision remote merchant credentials

```bash
# Validate + encrypt + CID + decrypt self-check; no chain writes.
REMOTE_CREDENTIALS_PASSKEY=... npm run upload-credentials -- --dry-run

# Real upload; needs an authorized Bulletin account.
REMOTE_CREDENTIALS_PASSKEY=... MNEMONIC=... npm run upload-credentials
```

The upload script reads `.credentials/remote-credentials.local.json` by default, writes a receipt to `.credentials/remote-credentials.receipt.json`, and prints the `VITE_CREDENTIAL_MAP` entry to add to the deployed environment.

### Frontend (local dev)

```bash
npm install
cp .env.example .env.local        # then set VITE_DOTNS_PRODUCT_DOMAIN and VITE_* values
npm run dev                       # http://localhost:5176
```

The app renders a merchant unlock gate first. Monitors do not mount until the POS group and passkey resolve a valid remote credential bundle.

### Checks

```bash
npm run validate-config
npm test
npm run typecheck
npm run build
```

## Adding a Network

There are two supported paths:

- **One-off deploy** — set `VITE_NETWORK` and `BULLETIN_ENV` to an existing supported key (`paseo-next-v2`, `paseo`, or `previewnet`) before running `npm run deploy`.
- **Permanent built-in network** — commit a new network entry so the app and deployment script agree on the same chain.

For a permanent network:

1. Add the key to `NetworkKey`, `SUPPORTED_NETWORKS`, and `NETWORKS` in `src/shared/api/host/networks.ts`.
2. Add the same key to the supported-network check in `deploy.sh`.
3. Confirm the network has the main-chain and People-chain endpoints required by the enabled v1 / v2 flows.
4. Add `.env.<network>.example` templates if contributors need a starting point.
5. Confirm `bulletin-deploy` supports the same `BULLETIN_ENV` value before publishing.

## Security

Before deploying it for real use cases, you are responsible for:

- Reviewing the code yourself; this is a reference proof-of-concept, not a hardened production build.
- Checking that dependencies are up to date and free of known vulnerabilities.
- Securing your own fork or deployment environment, especially mnemonics, CI secrets, remote credential passkeys, PEMs, DotNS ownership, and Bulletin upload authority.
- Tracking the latest tagged release / commits for security fixes; older releases are not backported (exceptions might apply).

For Parity's security disclosure process and Bug Bounty program, see [parity.io/bug-bounty](https://parity.io/bug-bounty).

## License

Licensed under [GPL-3.0-or-later](./LICENSE).
