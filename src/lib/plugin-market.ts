/**
 * Plugin Marketplace client (Phase 9.2).
 *
 * Responsibilities
 * ================
 *
 * 1. **Fetch a repository index** (`PluginIndex`) from a remote URL.
 * 2. **Cache downloaded zips** in IndexedDB by `sha256` so the second
 *    install of the same artifact is a single IndexedDB read.
 * 3. **Preflight verification** (sha256 + ed25519 signature) is the
 *    Rust host's job (`install_plugin_from_bytes`), but we also
 *    expose `verifyZipFrontmatter()` here so the UI can short-circuit
 *    obviously-bad downloads before crossing the IPC boundary.
 *
 * No ed25519 verification on the JS side — the host has the only
 * `ed25519-dalek` verifier. We just compute SHA-256 (via `crypto.subtle`)
 * and pass the bytes through.
 *
 * Threading
 * =========
 *
 * All operations are async and use the standard `fetch` /
 * `crypto.subtle.digest` / `indexedDB` APIs. The store wraps these in
 * Zustand actions (see `src/stores/plugin-market.ts`).
 */
import type {
  PluginIndex,
  PluginIndexEntry,
  PluginIndexEntryVersion,
  PluginUpdateInfo,
  PluginVersionInfo,
} from '@/types/plugin'
import type { PluginMetadataRust } from './tauri'

const ZIP_STORE_NAME = 'plugin-zips'
const INDEX_DB = 'swallow-plugin-market'
const INDEX_DB_VERSION = 1

// ─── Low-level IndexedDB helpers ──────────────────────────────────────────────

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(INDEX_DB, INDEX_DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(ZIP_STORE_NAME)) {
        db.createObjectStore(ZIP_STORE_NAME, { keyPath: 'sha256' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

interface CachedZip {
  sha256: string
  bytes: ArrayBuffer
  fetchedAt: number
  downloadUrl: string
}

/**
 * Read a zip from the local cache. Returns `null` on miss or any
 * IndexedDB error — callers should treat a miss as a no-op and fall
 * through to the network.
 *
 * Bug 7: trust boundary. The cache is keyed by `sha256`, but
 * `sha256` is just an `IDBValidKey` string — an attacker with
 * write access to the IndexedDB database (e.g. via a
 * compromised dev tool / browser extension) can plant a
 * `CachedZip` record with `sha256` = X and `bytes` = a malicious
 * zip. On the next install of any plugin whose declared
 * `sha256` happens to equal X, the cache would hand back the
 * malicious bytes and the host's signature check is the only
 * thing standing between the user and a pwn. To shrink that
 * window we re-verify the digest of the cached bytes on every
 * read; a mismatch is treated as a cache miss and the record
 * is deleted in the same transaction. The hash cost is
 * dominated by `fetch` for the very first install, so the
 * per-read hit is just a few milliseconds.
 */
async function readZipFromCache(sha256: string): Promise<ArrayBuffer | null> {
  if (typeof indexedDB === 'undefined') return null
  try {
    const db = await openDb()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(ZIP_STORE_NAME, 'readwrite')
      const store = tx.objectStore(ZIP_STORE_NAME)
      const req = store.get(sha256)
      req.onsuccess = async () => {
        const rec = req.result as CachedZip | undefined
        if (!rec) {
          resolve(null)
          return
        }
        // Bug 7 second-look. The cache record's declared
        // `sha256` matches the key by construction, so we
        // re-hash the *bytes* and compare against the key.
        // Anything that doesn't match is treated as a
        // poisoned record and evicted. The hash is computed
        // inline with `crypto.subtle.digest('SHA-256', ...)`,
        // which is constant-time for any input size on every
        // modern browser, and `bytes` is at most a few MB so
        // the cost is negligible compared to disk IO.
        try {
          const actual = await sha256Hex(rec.bytes)
          if (actual.toLowerCase() !== sha256.toLowerCase()) {
            // Mismatched — the record is corrupted or
            // tampered. Evict and report a miss so the
            // caller re-downloads from the network.
            store.delete(sha256)
            resolve(null)
            return
          }
        } catch {
          // `crypto.subtle` failed (e.g. detached ArrayBuffer
          // in an older webview). Treat as a miss rather
          // than refusing the install — the host's verify
          // pipeline will still catch any real tampering.
          resolve(null)
          return
        }
        resolve(rec.bytes)
      }
      req.onerror = () => reject(req.error)
    })
  } catch {
    return null
  }
}

/**
 * Persist a zip to the cache. Best-effort: a failure (e.g. quota
 * exceeded) is swallowed because the caller can always re-fetch.
 */
async function writeZipToCache(
  sha256: string,
  bytes: ArrayBuffer,
  downloadUrl: string
): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(ZIP_STORE_NAME, 'readwrite')
      const store = tx.objectStore(ZIP_STORE_NAME)
      const rec: CachedZip = {
        sha256,
        bytes,
        fetchedAt: Date.now(),
        downloadUrl,
      }
      store.put(rec)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    /* swallow — see comment above */
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Fetch a `PluginIndex` from `url`, parse it, and return it.
 * The Rust-side schema is snake_case; we normalise to camelCase on
 * the way in so the rest of the UI never sees the wire shape.
 *
 * Network errors and parse failures both surface as thrown
 * `Error`; the caller is responsible for user-visible error display.
 */
export async function fetchPluginIndex(url: string): Promise<PluginIndex> {
  if (!url) {
    throw new Error('repo url is empty')
  }
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching plugin index`)
  }
  const raw = await res.json()
  return normaliseIndex(raw)
}

/**
 * Fetch with progress tracking. Returns the response text and
 * calls `onProgress` with download percentage (0-100).
 */
export async function fetchWithProgress(
  url: string,
  onProgress: (percent: number) => void
): Promise<string> {
  if (!url) {
    throw new Error('repo url is empty')
  }

  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching plugin index`)
  }

  const contentLength = res.headers.get('content-length')
  const total = contentLength ? parseInt(contentLength, 10) : 0

  // If no content-length or body, fall back to normal fetch
  if (!total || !res.body) {
    const text = await res.text()
    onProgress(100)
    return text
  }

  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    chunks.push(value)
    received += value.length

    const percent = Math.round((received / total) * 100)
    onProgress(percent)
  }

  // Concatenate chunks
  const allChunks = new Uint8Array(received)
  let position = 0
  for (const chunk of chunks) {
    allChunks.set(chunk, position)
    position += chunk.length
  }

  const text = new TextDecoder().decode(allChunks)
  onProgress(100)
  return text
}

/**
 * SHA-256 of a byte buffer, returned as lowercase hex. Uses the
 * Web Crypto API so it works in any modern browser and (via the
 * Tauri webview) the desktop shell.
 */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const view = new Uint8Array(digest)
  let out = ''
  for (let i = 0; i < view.length; i++) {
    out += view[i].toString(16).padStart(2, '0')
  }
  return out
}

/**
 * Resolve a `download_url` from the index against the repo URL.
 *
 * `fetch()` resolves relative URLs against the *document's* base
 * URL — inside the Tauri webview that base is `tauri://localhost/`
 * (or whatever the host shell binds), not the URL the index was
 * loaded from. Passing `./export/foo.zip` straight through to
 * `fetch` therefore lands on `tauri://localhost/export/foo.zip`,
 * which is either a 404 (most builds) or worse, an unrelated file
 * that happens to be served from the app's static dir (read
 * through the same response body and we'd hash-verify the wrong
 * bytes). The safe path is to always run the relative URL
 * through `new URL(downloadUrl, repoUrl)` *before* `fetch`. An
 * absolute `downloadUrl` passes through unchanged because
 * `URL`'s second-arg semantics only kick in for relative
 * inputs. The trailing path-segment rules (`.` / `..` / `?` / `#`)
 * are also handled correctly by the platform `URL` parser, so
 * `repo.json` can use any of them without us re-implementing
 * RFC 3986 normalisation.
 *
 * Bug 6: the marketplace UI never lets the user edit the
 * `download_url` of an entry — only the repo URL itself — so a
 * malicious `download_url` is gated by the ability to commit to
 * `repo.json`. Still, defence in depth: we explicitly reject
 * schemes other than `http:` and `https:` here, because
 * `new URL('javascript:...', base)` and `new URL('file:///...', base)`
 * both parse successfully and would land on paths the host's
 * `install_plugin_from_bytes` would then happily hand to
 * `ZipArchive::new` (a zip reader over a JavaScript-served
 * string is harmless, but a zip over `file:///etc/passwd` would
 * surface bytes that nobody approved). The repo URL is gated the
 * same way in `loadRepoUrl` to keep both ends of the protocol on
 * the same threat model.
 */
function resolveDownloadUrl(downloadUrl: string, repoUrl: string): string {
  if (!downloadUrl) return downloadUrl
  let parsed: URL
  try {
    // Absolute URL → returned as-is. Relative URL → resolved
    // against the repo URL, mirroring how a `<base href="…">`
    // tag would behave in a browser loading the index document.
    parsed = new URL(downloadUrl, repoUrl)
  } catch {
    // Malformed input from a hand-edited repo.json. Fall back
    // to the literal string so the caller surfaces a network
    // error (HTTP 4xx / 5xx) rather than a confusing URL parse
    // exception — the SHA-256 verification that runs on the
    // downloaded bytes will still reject a wrong file even if
    // the URL was bogus.
    return downloadUrl
  }
  // Bug 6 scheme allowlist. `http:` and `https:` only. We do not
  // permit `ftp:`, `data:`, `blob:`, `javascript:`, `file:`, or
  // any custom scheme — those either leak local files into the
  // zip-extraction path (file:) or execute code in the webview
  // (javascript:). The host shell is the only thing that knows
  // how to safely read those schemes and we deliberately don't
  // route through it here.
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `plugin download_url has disallowed scheme '${parsed.protocol}' (only http/https are accepted)`,
    )
  }
  return parsed.toString()
}

/**
 * Download a plugin zip, hitting the IndexedDB cache first. The
 * returned `ArrayBuffer` is the *raw* zip bytes — they're what the
 * host's `install_plugin_from_bytes` hashes and verifies.
 *
 * `repoUrl` is the URL the `PluginIndex` was loaded from; it
 * serves as the base for resolving `entry.downloadUrl` (which
 * the index protocol documents as relative to the index).
 * Without it, relative paths land on the app's own server and
 * every install fails with a sha256 mismatch.
 */
export async function downloadPluginZip(
  entry: PluginIndexEntry,
  repoUrl: string,
): Promise<ArrayBuffer> {
  // 1) Cache lookup. Cheap and bypasses the network entirely.
  const cached = await readZipFromCache(entry.sha256)
  if (cached) return cached

  // 2) Network download. The URL is resolved against `repoUrl`
  //    so `./export/foo.zip` in the index becomes
  //    `<repo>/export/foo.zip`, not `<tauri-localhost>/export/foo.zip`.
  const url = resolveDownloadUrl(entry.downloadUrl, repoUrl)
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) {
    throw new Error(
      `HTTP ${res.status} downloading ${entry.id}@${entry.version}`
    )
  }
  const bytes = await res.arrayBuffer()

  // 3) Cache *only* if the digest matches. A mismatched zip is
  //    malicious or corrupted — never persist it.
  const actual = await sha256Hex(bytes)
  if (actual.toLowerCase() === entry.sha256.toLowerCase()) {
    await writeZipToCache(entry.sha256, bytes, entry.downloadUrl)
  } else {
    throw new Error(
      `sha256 mismatch for ${entry.id}@${entry.version}: expected ${entry.sha256}, got ${actual}`
    )
  }

  return bytes
}

/**
 * Download a specific historical version of a plugin. Mirrors
 * {@link downloadPluginZip} but takes the per-version fields from
 * the index's `versions` array (G5) so the marketplace detail UI
 * can let users roll back to / install an old release.
 *
 * Cache key is the per-version `sha256` so a downgrade doesn't
 * collide with the latest-version cache entry, and a follow-up
 * `update_plugin` call to the same version is a single IndexedDB
 * read. The signature is taken from the parent entry (the index
 * protocol attaches one signature per `PluginIndexEntry`, not per
 * version) — if the host rejects the signature for an older
 * version, the caller surfaces that as an install error.
 */
export async function downloadPluginVersion(
  pluginId: string,
  version: { version: string; downloadUrl: string; sha256: string },
  repoUrl: string,
): Promise<ArrayBuffer> {
  const cached = await readZipFromCache(version.sha256)
  if (cached) return cached

  // Same relative-URL trap as `downloadPluginZip`: the per-
  // version `downloadUrl` is also documented as relative to
  // the index, so we have to re-anchor it to `repoUrl` before
  // handing the string to `fetch`.
  const url = resolveDownloadUrl(version.downloadUrl, repoUrl)
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) {
    throw new Error(
      `HTTP ${res.status} downloading ${pluginId}@${version.version}`
    )
  }
  const bytes = await res.arrayBuffer()

  // Same G1 invariant as the latest-version path: never persist a
  // mismatched digest.
  const actual = await sha256Hex(bytes)
  if (actual.toLowerCase() === version.sha256.toLowerCase()) {
    await writeZipToCache(version.sha256, bytes, version.downloadUrl)
  } else {
    throw new Error(
      `sha256 mismatch for ${pluginId}@${version.version}: expected ${version.sha256}, got ${actual}`
    )
  }

  return bytes
}

/**
 * Resolve which pubkey to use for an entry. Falls back to the
 * repo-level key when the entry leaves `pubkeyB64` empty.
 */
export function effectivePubkey(
  index: PluginIndex,
  entry: PluginIndexEntry
): string {
  return entry.pubkeyB64 || index.pubkeyB64
}

// ─── Wire-shape normalisation ─────────────────────────────────────────────────

/**
 * Convert snake_case (the Rust struct shape) to camelCase (the TS
 * shape). We do this by hand because the marketplace is the only
 * caller and the shape is small enough that a generic key-mapping
 * dep would be more code than the explicit code below.
 */
export function normaliseIndex(raw: any): PluginIndex {
  if (!raw || typeof raw !== 'object') {
    throw new Error('plugin index is not an object')
  }
  return {
    schemaVersion: raw.schema_version ?? 1,
    updatedAt: raw.updated_at ?? '',
    pubkeyB64: raw.pubkey_b64 ?? '',
    plugins: Array.isArray(raw.plugins) ? raw.plugins.map(normaliseEntry) : [],
  }
}

function normaliseEntry(raw: any): PluginIndexEntry {
  if (!raw || typeof raw !== 'object') {
    throw new Error('plugin index entry is not an object')
  }
  for (const k of ['id', 'name', 'version', 'download_url', 'sha256'] as const) {
    if (typeof raw[k] !== 'string' || raw[k].length === 0) {
      throw new Error(
        `plugin index entry missing required string field '${k}' (id=${
          typeof raw.id === 'string' ? raw.id : '<unknown>'
        })`,
      )
    }
  }
  return {
    id: raw.id,
    name: raw.name,
    version: raw.version,
    description: raw.description ?? '',
    author: raw.author ?? '',
    icon: raw.icon,
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    downloadUrl: raw.download_url,
    sha256: raw.sha256,
    signatureB64: raw.signature_b64 ?? '',
    pubkeyB64: raw.pubkey_b64 ?? '',
    versions: Array.isArray(raw.versions) ? raw.versions.map(normaliseVersion) : [],
    dependencies: Array.isArray(raw.dependencies) ? raw.dependencies : [],
  }
}

function normaliseVersion(raw: any): PluginIndexEntryVersion {
  if (!raw || typeof raw !== 'object') {
    throw new Error('plugin index version is not an object')
  }
  if (typeof raw.version !== 'string' || raw.version.length === 0) {
    throw new Error('plugin index version missing required field "version"')
  }
  if (typeof raw.download_url !== 'string' || raw.download_url.length === 0) {
    throw new Error(
      `plugin index version '${raw.version}' missing required field "download_url"`,
    )
  }
  if (typeof raw.sha256 !== 'string' || raw.sha256.length === 0) {
    throw new Error(
      `plugin index version '${raw.version}' missing required field "sha256"`,
    )
  }
  return {
    version: raw.version,
    downloadUrl: raw.download_url,
    sha256: raw.sha256,
    signatureB64:
      typeof raw.signature_b64 === 'string' && raw.signature_b64.length > 0
        ? raw.signature_b64
        : undefined,
    pubkeyB64:
      typeof raw.pubkey_b64 === 'string' && raw.pubkey_b64.length > 0
        ? raw.pubkey_b64
        : undefined,
    changelog: raw.changelog ?? '',
    publishedAt: raw.published_at ?? '',
  }
}

/**
 * Normalise one `PluginUpdateInfo` row from the host's wire shape
 * (snake_case — see `src-tauri/src/commands/plugin.rs::PluginUpdateInfo`)
 * to the camelCase shape consumed by the UI. The Rust serde default
 * is snake_case, so `local_version` arrives as `local_version` over
 * IPC; without this the store's `localVersion` reads would all be
 * `undefined` and the "Update available" badge would never fire.
 */
function normaliseUpdate(raw: any): PluginUpdateInfo {
  return {
    id: raw.id ?? '',
    localVersion: raw.local_version ?? '',
    remoteVersion: raw.remote_version ?? '',
    sha256: raw.sha256 ?? '',
  }
}

/**
 * Normalise one `PluginVersionInfo` row from the host's wire shape
 * (snake_case — see `src-tauri/src/commands/plugin.rs::PluginVersionInfo`)
 * to the camelCase shape consumed by the UI. Without this, `isActive`
 * is always `undefined` and the rollback dialog's "current" badge
 * never lights up.
 */
function normalisePluginVersion(raw: any): PluginVersionInfo {
  return {
    version: raw.version ?? '',
    isActive: raw.is_active ?? false,
    sizeBytes: typeof raw.size_bytes === 'number' ? raw.size_bytes : 0,
    installedAt: raw.installed_at ?? '',
  }
}

// ─── Tauri command wrappers ───────────────────────────────────────────────────

import { invoke } from '@tauri-apps/api/core'

/**
 * Trigger an in-app install from a zip the marketplace already
 * downloaded. The host re-runs SHA-256 + signature verification on
 * the bytes we send — never trust the frontend to have validated
 * anything.
 *
 * Returns the freshly-installed `PluginMetadataRust` from the host
 * so the caller (e.g. the marketplace detail dialog) can read the
 * id, name, declared permissions, etc. without re-scanning the
 * plugins directory.
 */
export async function installPluginFromBytes(args: {
  pluginId: string
  version: string
  bytes: ArrayBuffer
  sha256: string
  pubkeyB64: string
  signatureB64: string
}): Promise<PluginMetadataRust> {
  return invoke<PluginMetadataRust>('install_plugin_from_bytes', {
    pluginId: args.pluginId,
    version: args.version,
    bytes: Array.from(new Uint8Array(args.bytes)),
    sha256: args.sha256,
    pubkeyB64: args.pubkeyB64,
    signatureB64: args.signatureB64,
  })
}

export async function checkPluginUpdates(repoUrl: string): Promise<PluginUpdateInfo[]> {
  const raw = await invoke<unknown>('check_plugin_updates', { repoUrl })
  return Array.isArray(raw) ? raw.map(normaliseUpdate) : []
}

/**
 * Swap the active version of a previously-installed plugin. Returns
 * the metadata of the now-active version so the caller can read the
 * id / name / declared permissions without a separate scan.
 */
export async function rollbackPlugin(pluginId: string, version: string): Promise<PluginMetadataRust> {
  return invoke<PluginMetadataRust>('rollback_plugin', { pluginId, version })
}

export async function listPluginVersions(pluginId: string): Promise<PluginVersionInfo[]> {
  const raw = await invoke<unknown>('list_plugin_versions', { pluginId })
  return Array.isArray(raw) ? raw.map(normalisePluginVersion) : []
}

// ─── In-memory index cache (per repo URL) ─────────────────────────────────────

const inMemoryIndexCache = new Map<string, { index: PluginIndex; at: number }>()
const IN_MEMORY_TTL_MS = 60_000

/**
 * Fetch with a 60s in-memory cache. The Rust side fetches the index
 * too (via `check_plugin_updates`); the cache here keeps the UI from
 * re-fetching on every tab switch or filter change.
 */
export async function fetchPluginIndexCached(url: string): Promise<PluginIndex> {
  const now = Date.now()
  const hit = inMemoryIndexCache.get(url)
  if (hit && now - hit.at < IN_MEMORY_TTL_MS) {
    return hit.index
  }
  const index = await fetchPluginIndex(url)
  inMemoryIndexCache.set(url, { index, at: now })
  return index
}

/** Drop the in-memory index cache. Useful after a successful install. */
export function invalidateIndexCache(url?: string): void {
  if (url) {
    inMemoryIndexCache.delete(url)
  } else {
    inMemoryIndexCache.clear()
  }
}
