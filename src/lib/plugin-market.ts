/** 插件市场客户端：拉取索引、缓存 zip */
import type {
  PluginIndex,
  PluginIndexEntry,
  PluginIndexEntryVersion,
  PluginUpdateInfo,
  PluginVersionInfo,
} from '@/types/plugin'
import type { PluginMetadataRust } from './tauri'
import { logger } from '@/lib/logger'

const ZIP_STORE_NAME = 'plugin-zips'
const INDEX_DB = 'swallow-plugin-market'
const INDEX_DB_VERSION = 1

// IndexedDB 辅助

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

/** 从缓存读 zip，校验 sha256 不匹配则驱逐 */
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
            // 损坏或篡改，驱逐并重下
            store.delete(sha256)
            resolve(null)
            return
          }
        } catch (e) {
          // crypto.subtle 失败按 miss 处理
          logger.warn('plugin-market', 'cache sha256 verify failed', e)
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

/** 写入 zip 缓存，LRU 上限 20 */
const ZIP_CACHE_LIMIT = 20

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

      // LRU 淘汰：写入后若总数超过上限，按 fetchedAt 升序删除最旧条目
      const countReq = store.count()
      countReq.onsuccess = () => {
        if (countReq.result > ZIP_CACHE_LIMIT) {
          const getAllReq = store.getAll()
          getAllReq.onsuccess = () => {
            const all = getAllReq.result as CachedZip[]
            // 升序后删除多出的最旧条目
            all.sort((a, b) => a.fetchedAt - b.fetchedAt)
            const toEvict = all.length - ZIP_CACHE_LIMIT
            for (let i = 0; i < toEvict; i++) {
              store.delete(all[i].sha256)
            }
          }
        }
      }

      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch (e) {
    logger.warn('plugin-market', 'cache write failed', e)
  }
}

// 公共 API

/** 拉取并解析 PluginIndex，snake_case 转 camelCase。 */
export async function fetchPluginIndex(url: string, signal?: AbortSignal): Promise<PluginIndex> {
  if (!url) {
    throw new Error('repo url is empty')
  }
  const res = await fetch(url, { cache: 'no-store', signal })
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching plugin index`)
  }
  const raw = await res.json()
  return normaliseIndex(raw)
}

/** 带进度的 fetch，回调百分比 */
export async function fetchWithProgress(
  url: string,
  onProgress: (percent: number) => void,
  signal?: AbortSignal
): Promise<string> {
  if (!url) {
    throw new Error('repo url is empty')
  }

  const res = await fetch(url, { cache: 'no-store', signal })
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching plugin index`)
  }

  const contentLength = res.headers.get('content-length')
  const total = contentLength ? parseInt(contentLength, 10) : 0

  // 无 content-length 退回普通 fetch
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

  // 合并分块
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

/** 解析下载 URL，仅允许 http/https */
function resolveDownloadUrl(downloadUrl: string, repoUrl: string): string {
  if (!downloadUrl) return downloadUrl
  let parsed: URL
  try {
    // 绝对 URL 原样返回，相对 URL 基于 repoUrl 解析
    parsed = new URL(downloadUrl, repoUrl)
  } catch (e) {
    // 解析失败时回退原字符串。
    logger.warn('plugin-market', 'download url parse failed', e)
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
  // 1) 查缓存，绕过网络
  const cached = await readZipFromCache(entry.sha256)
  if (cached) return cached

  // 2) 基于 repoUrl 解析后下载
  const url = resolveDownloadUrl(entry.downloadUrl, repoUrl)
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) {
    throw new Error(
      `HTTP ${res.status} downloading ${entry.id}@${entry.version}`
    )
  }
  const bytes = await res.arrayBuffer()

  // 3) 仅摘要匹配才缓存
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

  // 同上，相对 URL 需重新锚定到 repoUrl
  const url = resolveDownloadUrl(version.downloadUrl, repoUrl)
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) {
    throw new Error(
      `HTTP ${res.status} downloading ${pluginId}@${version.version}`
    )
  }
  const bytes = await res.arrayBuffer()

  // 同样不持久化摘要不匹配的 zip
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

/** 解析条目公钥，缺省回退 repo 级 */
export function effectivePubkey(
  index: PluginIndex,
  entry: PluginIndexEntry
): string {
  return entry.pubkeyB64 || index.pubkeyB64
}

// 字段规范化

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

// Tauri 命令封装

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

// 内存索引缓存

const inMemoryIndexCache = new Map<string, { index: PluginIndex; at: number }>()
const IN_MEMORY_TTL_MS = 60_000

/** 带 60s 内存缓存的 fetchPluginIndex。 */
export async function fetchPluginIndexCached(url: string, signal?: AbortSignal): Promise<PluginIndex> {
  const now = Date.now()
  const hit = inMemoryIndexCache.get(url)
  if (hit && now - hit.at < IN_MEMORY_TTL_MS) {
    return hit.index
  }
  const index = await fetchPluginIndex(url, signal)
  inMemoryIndexCache.set(url, { index, at: now })
  return index
}

/** 失效内存索引缓存 */
export function invalidateIndexCache(url?: string): void {
  if (url) {
    inMemoryIndexCache.delete(url)
    // 遍历清理已过期的条目
    const now = Date.now()
    for (const [key, entry] of inMemoryIndexCache) {
      if (now - entry.at >= IN_MEMORY_TTL_MS) {
        inMemoryIndexCache.delete(key)
      }
    }
  } else {
    inMemoryIndexCache.clear()
  }
}
