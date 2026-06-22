/** 插件市场客户端（Phase 9.2）。职责：拉取索引、IndexedDB 缓存 zip、提供 verifyZipFrontmatter。ed25519 验签在 Rust 宿主侧。 */
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
 * 从缓存读 zip。Bug 7：每次读取重新校验 sha256，不匹配则驱逐。
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
        // 重新 hash 并比对，不匹配则驱逐。
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

/** 拉取并解析 PluginIndex，snake_case 转 camelCase。 */
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

/** 用 Web Crypto API 计算 SHA-256，返回小写 hex。 */
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
 * 用 new URL(downloadUrl, repoUrl) 解析相对路径。Bug 6：仅允许 http/https scheme。
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
    // 解析失败时回退原字符串。
    return downloadUrl
  }
  // 仅允许 http/https。
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `plugin download_url has disallowed scheme '${parsed.protocol}' (only http/https are accepted)`,
    )
  }
  return parsed.toString()
}

/** 下载插件 zip，优先走 IndexedDB 缓存。 */
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

/** 下载指定历史版本（G5），缓存键为 per-version sha256。 */
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

/** snake_case 转 camelCase。 */
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
    // 顶层 changelog/publishedAt 为最新版本；versions[] 可选。
    changelog: raw.changelog,
    publishedAt: raw.published_at ?? raw.publishedAt,
    versions: Array.isArray(raw.versions) ? raw.versions.map(normaliseVersion) : undefined,
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

/** PluginUpdateInfo snake_case 转 camelCase。 */
function normaliseUpdate(raw: any): PluginUpdateInfo {
  return {
    id: raw.id ?? '',
    localVersion: raw.local_version ?? '',
    remoteVersion: raw.remote_version ?? '',
    sha256: raw.sha256 ?? '',
  }
}

/** PluginVersionInfo snake_case 转 camelCase。 */
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

/** 触发宿主从 zip 安装，宿主重新校验 SHA-256 + 签名。 */
export async function installPluginFromBytes(args: {
  pluginId: string
  version: string
  bytes: ArrayBuffer
  sha256: string
  pubkeyB64?: string
  signatureB64?: string
  source?: string
}): Promise<PluginMetadataRust> {
  return invoke<PluginMetadataRust>('install_plugin_from_bytes', {
    pluginId: args.pluginId,
    version: args.version,
    bytes: Array.from(new Uint8Array(args.bytes)),
    sha256: args.sha256,
    pubkeyB64: args.pubkeyB64 ?? '',
    signatureB64: args.signatureB64 ?? '',
    source: args.source,
  })
}

export async function checkPluginUpdates(repoUrl: string): Promise<PluginUpdateInfo[]> {
  const raw = await invoke<unknown>('check_plugin_updates', { repoUrl })
  return Array.isArray(raw) ? raw.map(normaliseUpdate) : []
}

/** 切换已安装插件的活跃版本。 */
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

/** 带 60s 内存缓存的 fetchPluginIndex。 */
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
