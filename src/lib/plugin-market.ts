/** 插件市场客户端：拉取索引、缓存 zip */
import semver from 'semver'
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
  } catch (e) {
    // IndexedDB 缓存读取失败（浏览器存储损坏/配额）：按 miss 处理但需留痕
    logger.warn('plugin-market', 'zip 缓存读取失败，按缓存未命中处理', e)
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

/** 比较 semver，remote 严格大于 local 时返回 true。解析失败回退字符串比较。 */
export function isNewerVersion(remote: string, local: string): boolean {
  if (!remote || !local) return false
  const r = remote.trim()
  const l = local.trim()
  if (!r || !l) return false
  if (semver.valid(r) !== null && semver.valid(l) !== null) {
    try {
      return semver.gt(r, l)
    } catch {
      // semver 异常时回退字符串比较
    }
  }
  return r > l
}

/**
 * 宿主版本是否满足条目的 minHostVersion。
 * min 缺失/空 = 无要求；宿主版本未知（null）= 保守放行，
 * 避免取版本失败的环境误隐藏全部条目。
 */
export function isHostVersionCompatible(
  hostVersion: string | null | undefined,
  minHostVersion?: string,
): boolean {
  const min = minHostVersion?.trim()
  if (!min) return true
  if (!hostVersion) return true
  // host >= min ⟺ min 不严格大于 host
  return !isNewerVersion(min, hostVersion)
}

/** 过滤索引中宿主版本不满足的条目（市场列表与更新展示共用）。 */
export function filterHostCompatibleEntries(
  index: PluginIndex,
  hostVersion: string | null | undefined,
): PluginIndex {
  return {
    ...index,
    plugins: index.plugins.filter((p) =>
      isHostVersionCompatible(hostVersion, p.minHostVersion),
    ),
  }
}

/**
 * 条目平台兼容判定：platforms 缺失/空 = 全平台兼容（纯前端插件或
 * 旧格式索引）；宿主平台未知（null）= 保守放行——该判定只服务
 * 显示层（禁用安装按钮），真正的门禁在安装路径与更新检查。
 */
export function isPlatformCompatible(
  hostPlatformDir: string | null | undefined,
  platforms?: string[],
): boolean {
  const list = (platforms ?? [])
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
  if (list.length === 0) return true
  if (!hostPlatformDir) return true
  return list.includes(hostPlatformDir)
}

/** 宿主平台目录名缓存：undefined = 未取过，null = 取失败（判定保守放行）。 */
let cachedHostPlatformDir: string | null | undefined

/** 取当前宿主平台目录名（如 darwin-aarch64），失败返回 null。 */
export async function getHostPlatformDirCached(): Promise<string | null> {
  if (cachedHostPlatformDir === undefined) {
    try {
      cachedHostPlatformDir = await invoke<string>('get_host_platform_dir')
    } catch (e) {
      logger.warn('plugin-market', 'get_host_platform_dir failed', e)
      cachedHostPlatformDir = null
    }
  }
  return cachedHostPlatformDir
}

/** PL-7：市场仓库 URL 仅接受 https（Rust 侧 check_plugin_updates / add_market_source 同口径）。 */
export function assertHttpsRepoUrl(url: string): void {
  if (!/^https:\/\//i.test(url.trim())) {
    throw new Error(`repo url must use https scheme: ${url}`)
  }
}

/** 拉取并解析 PluginIndex，snake_case 转 camelCase。 */
export async function fetchPluginIndex(url: string, signal?: AbortSignal): Promise<PluginIndex> {
  if (!url) {
    throw new Error('repo url is empty')
  }
  assertHttpsRepoUrl(url)
  // 走 Rust 侧拉取：release 资产 302 链路无 CORS 头，WebView fetch 必然
  // "Load failed"（详见 plugin_fetch_market_bytes 注释）。
  const text = await fetchWithProgress(url, () => {}, signal)
  const raw = JSON.parse(text)
  return normaliseIndex(raw)
}

/**
 * 带进度的远端资源拉取（经 Rust 绕过 WebView CORS）。
 * signal 无法中止 Rust 请求（invoke 无取消语义），取消语义由调用方在
 * 返回后通过 aborted 复检丢弃结果实现（市场 store 已有代际保护）。
 */
export async function fetchWithProgress(
  url: string,
  onProgress: (percent: number) => void,
  // 历史签名保留（调用方仍传 AbortController.signal）；invoke 无取消语义，
  // 仅作占位，取消语义由调用方在返回后通过 aborted 复检实现。
  _signal?: AbortSignal
): Promise<string> {
  if (!url) {
    throw new Error('repo url is empty')
  }
  assertHttpsRepoUrl(url)

  const channel = new Channel<number>()
  channel.onmessage = onProgress
  const bytes = await invoke<ArrayBuffer>('plugin_fetch_market_bytes', {
    url,
    progress: channel,
  })
  const text = new TextDecoder().decode(new Uint8Array(bytes))
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

  // 2) 基于 repoUrl 解析后经 Rust 拉取（绕过 WebView CORS，同索引链路）
  const url = resolveDownloadUrl(entry.downloadUrl, repoUrl)
  let bytes: ArrayBuffer
  try {
    const raw = await invoke<ArrayBuffer | number[]>('plugin_fetch_market_bytes', {
      url,
      progress: new Channel<number>(),
    })
    // macOS 上 tauri 对 ipc::Response 的 raw 响应经 eval 以 JSON number 数组
    // 回传（非 ArrayBuffer），统一归一化后再参与 sha256/缓存/安装链路
    bytes = raw instanceof ArrayBuffer ? raw : new Uint8Array(raw).buffer
  } catch (e) {
    // 保持既有契约：错误消息形如 "HTTP <status> downloading <id>@<version>"，
    // friendlyInstallError 依赖该形态透传状态码（404 等给用户看原始信息）
    const m = /^HTTP (\d{3}) /.exec(String((e as Error)?.message ?? e))
    if (m) {
      throw new Error(`HTTP ${m[1]} downloading ${entry.id}@${entry.version}`)
    }
    throw e
  }

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
    minHostVersion: raw.min_host_version ?? raw.minHostVersion,
    // 作者声明的权限（可选）：只保留非空字符串项，未知权限由 UI 端兜底展示。
    permissions: Array.isArray(raw.permissions)
      ? raw.permissions.filter((p: unknown): p is string => typeof p === 'string' && p.length > 0)
      : undefined,
    // 支持的平台目录名（可选）：只保留非空字符串项。
    platforms: Array.isArray(raw.platforms)
      ? raw.platforms.filter((p: unknown): p is string => typeof p === 'string' && p.length > 0)
      : undefined,
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

import { invoke, Channel } from '@tauri-apps/api/core'

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

/**
 * 判断插件是否有可用更新（管理页「更新」按钮与角标的共用判定）。
 *
 * 注意：Rust 端 check_plugin_updates 会跳过 upload 安装的插件
 * （目录版本为 upload 哨兵时直接 continue），因此 marketUpdates
 * 对这类插件永远为空；但市场安装流程（install_plugin_from_bytes）
 * 并不依赖旧安装路径，仍可正常更新它们。
 */
export function pluginHasUpdateAvailable(args: {
  pluginId: string
  localVersion: string
  marketUpdates: ReadonlyArray<PluginUpdateInfo>
  marketIndex: PluginIndex | null
}): boolean {
  // 主判定：Rust check_plugin_updates 结果（semver 比较）。
  if (
    args.marketUpdates.some(
      (u) => u.id === args.pluginId && u.localVersion !== u.remoteVersion,
    )
  ) {
    return true
  }
  // 回退：市场索引版本比较（与角标 updateIdSet / 市场卡片同源）。
  // 覆盖 upload 安装的插件 —— Rust 端会跳过它们，但市场安装流程
  // （install_plugin_from_bytes）仍可正常更新这类插件。
  // I17：用 isNewerVersion 严格 semver 比较（曾用 !==——本地版本比索引新
  // 时会误报「有更新」，如手动升级过的插件）。
  const entry = args.marketIndex?.plugins.find((e) => e.id === args.pluginId)
  return !!entry && isNewerVersion(entry.version, args.localVersion)
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
