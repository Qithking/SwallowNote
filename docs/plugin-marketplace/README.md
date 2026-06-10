# Plugin Marketplace — Repository Protocol

This directory is a **sample plugin repository** for SwallowNote's in-app
marketplace (Phase 9.2). A repo is just a static directory of files served over
HTTPS — no server-side code is required.

## Layout

```text
plugin-marketplace/
├── README.md          ← this file
├── repo.json          ← the index (fetched on marketplace open)
├── pubkey.b64         ← base64-encoded 32-byte ed25519 verifying key
│                        (used as the default for entries that don't
│                         ship their own pubkey_b64)
└── artifacts/         ← zips, one per (id, version) tuple
    ├── <id>-<version>.zip
    └── ...
```

## `repo.json`

Top-level shape (mirrors `src-tauri/src/commands/plugin.rs::PluginIndex`):

```ts
interface PluginIndex {
  schema_version: 1
  updated_at: string                  // ISO 8601, refresh hint
  pubkey_b64: string                  // repo-level ed25519 key (b64 raw 32B)
  plugins: PluginIndexEntry[]
}

interface PluginIndexEntry {
  id: string                          // e.g. "com.example.hello-world"
  name: string
  version: string                     // latest semver
  description: string
  author: string
  icon?: string                       // absolute URL to an SVG/PNG
  tags: string[]
  download_url: string                // absolute URL to the zip
  sha256: string                      // lowercase hex of the zip bytes
  signature_b64: string               // ed25519 sig over the zip bytes
  pubkey_b64: string                  // override repo key (optional)
  versions: PluginIndexEntryVersion[] // history (newest first)
  dependencies: string[]              // peer plugin ids
}

interface PluginIndexEntryVersion {
  version: string
  download_url: string
  sha256: string
  changelog: string
  published_at: string                // ISO 8601
}
```

## Signing flow

Each zip is signed once with an ed25519 private key. The host
(`install_plugin_from_bytes` in `src-tauri/src/commands/plugin.rs`) verifies
**two** things before installing:

1. **SHA-256 digest** of the zip bytes matches `entry.sha256`.
2. **ed25519 signature** of the zip bytes (raw) matches `entry.signature_b64`
   under `entry.pubkey_b64` (or the repo-level `pubkey_b64` when the entry
   leaves it empty).

A failure on either check yields `PluginError::Security(...)` and the install
is refused before any file lands on disk.

### Why base64 raw 32 bytes, not PEM?

PEM requires ASN.1 DER parsing of a `SubjectPublicKeyInfo` structure, which
pulls in another dep (or ~80 lines of hand-rolled ASN.1). For a single
fixed-size public key the raw 32-byte form is simpler and the frontend
doesn't need any ed25519 crypto lib at all — only the Rust host does.

### Generating a signed zip

```bash
# 1. Build the plugin (e.g. hello-world)
cd docs/plugin-samples/hello-world
npm install
npm run build           # produces dist/index.js etc.

# 2. Pack the zip
zip -r ../../../plugin-marketplace/artifacts/com.example.hello-world-0.1.0.zip \
  dist manifest.json index.tsx

# 3. Sign with the repo's private key (replace with your own)
PRIV_B64=$(cat ../../plugin-marketplace/priv.b64)
node -e "
  const c = require('crypto');
  const fs = require('fs');
  const buf = fs.readFileSync('artifacts/com.example.hello-world-0.1.0.zip');
  const priv = Buffer.from('${PRIV_B64}', 'base64');
  // Re-import as PKCS8 DER
  const pkcs8 = Buffer.concat([
    Buffer.from('302e020100300506032b657004220420','hex'),
    priv,
  ]);
  const key = c.createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
  const sig = c.sign(null, buf, key);
  console.log('sha256:  ' + c.createHash('sha256').update(buf).digest('hex'));
  console.log('sig_b64: ' + sig.toString('base64'));
"
# → paste `sha256` and `sig_b64` into the corresponding entry in repo.json
```

The host's verifier matches this exactly:

```rust
verifier.verify(zip_bytes, &Signature::from_bytes(&sig_b64_decoded))
```

## How the host fetches a repo

The user pastes a `repo.json` URL into the marketplace UI (or selects a
hard-coded default). `src/lib/plugin-market.ts` then:

1. `fetch(url)` → parse as `PluginIndex`.
2. For each entry, compare `local_version` (from
   `invoke('check_plugin_updates', { repoUrl: url })`) with `entry.version`.
3. On install, look up the entry's `download_url` + `sha256` +
   `signature_b64` (or fall back to the repo-level `pubkey_b64`).
4. Download the zip into an in-memory `Blob` (also cached in IndexedDB by
   `sha256` — second install is a single IndexedDB read).
5. `invoke('install_plugin_from_bytes', { id, version, bytes, sha256, pubkeyB64, signatureB64 })`.

## Security properties

- **Tampered zip**: SHA-256 mismatch → rejected before signature is checked.
- **Wrong key**: signature verification fails → rejected.
- **MITM on `download_url`**: SHA-256 mismatch (or signature failure) → rejected.
- **MITM on `repo.json`**: a malicious index can deny service (point entries
  at unreachable URLs) but cannot ship a plugin that wasn't signed by the
  private key — the signature check is the binding between the zip and
  the index entry.

## Sample keypair

`pubkey.b64` ships with this sample repo. **It is for demonstration only**;
the corresponding private key is not included. To run an end-to-end install
test, generate your own keypair and re-sign your sample zips.

```bash
node -e "
  const c = require('crypto');
  const kp = c.generateKeyPairSync('ed25519');
  const rawPub = kp.publicKey.export({format: 'der', type: 'spki'}).slice(-32);
  const rawPriv = kp.privateKey.export({format: 'der', type: 'pkcs8'}).slice(-32);
  require('fs').writeFileSync('pubkey.b64', rawPub.toString('base64'));
  require('fs').writeFileSync('priv.b64',  rawPriv.toString('base64'));
  console.log('Wrote pubkey.b64 and priv.b64');
"
```
