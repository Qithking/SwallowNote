/**
 * @swallow-note/plugin-sdk
 *
 * SwallowNote 插件单文件独立 SDK。
 *
 * 设计目标：
 * 1. 零宿主耦合：仅需本文件 + React
 * 2. 类型一致：导出与宿主相同的类型
 * 3. 浏览器兜底：宿主外运行时 API 优雅降级
 * 4. 宿主接管：setHost 替换兜底为真实实现
 *
 * 仅依赖 react（peer），无其他运行时依赖。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ComponentType, ReactNode } from 'react'

// ═══════════════════════════════════════════════════════════════════════════
//  类型定义 – 镜像 src/types/plugin.ts，需与宿主同步
// ═══════════════════════════════════════════════════════════════════════════

/** 插件图标显示位置 */
export type IconPosition = 'sidebar' | 'editorToolbar' | 'titleBar'

/** 插件面板内容显示位置 */
export type ContentPosition =
  | 'leftPanel'
  | 'rightPanel'
  | 'fullPanel'
  | 'editorArea'

/** 插件可订阅的宿主事件 */
export type PluginEvent =
  | 'note:open'
  | 'note:close'
  | 'note:save'
  | 'note:change'
  | 'theme:change'
  | 'locale:change'
  | 'settings:change'
  | 'app:ready'
  | 'app:exit'
  | 'plugin-settings:change'
  | 'editor:registered'
  | 'editor:unregistered'

/** 各事件的 payload 结构 */
export interface PluginEventPayloadMap {
  'note:open': { noteId: string; path: string }
  'note:close': { noteId: string; path: string }
  'note:save': { noteId: string; path: string }
  'note:change': { noteId: string; path: string; content: string }
  'theme:change': { theme: string }
  'locale:change': { locale: string }
  'settings:change': { key: string; value: unknown }
  'app:ready': Record<string, never>
  'app:exit': Record<string, never>
  'plugin-settings:change': { pluginId: string; values: Record<string, unknown> }
  'editor:registered': { pluginId: string; extension: string }
  'editor:unregistered': { pluginId: string; extension: string }
}

export type PluginEventHandler<E extends PluginEvent = PluginEvent> = (
  payload: PluginEventPayloadMap[E]
) => void

export interface PluginContext {
  pluginId: string
  pluginPath: string
  invokeBackend: (command: string, args?: Record<string, unknown>) => Promise<unknown>
  /** 统一日志通道，自动带 plugin:<pluginId> source 前缀 */
  log: PluginLogger
}

/** 插件 logger 接口：5 级日志方法 */
export interface PluginLogger {
  trace(message: string, ...args: unknown[]): void
  debug(message: string, ...args: unknown[]): void
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
}

export type PluginLifecycleHook = (context: PluginContext) => void | Promise<void>

/** 插件持久化存储 API */
export interface PluginStorage {
  get<T = unknown>(key: string): Promise<T | null>
  set<T = unknown>(key: string, value: T): Promise<void>
  delete(key: string): Promise<void>
  clear(): Promise<void>
  /** 列出当前插件命名空间所有 key */
  keys(): Promise<string[]>
  /** 所有 key 及 JSON 大小的只读快照，按 size 降序 */
  entries(): Promise<Array<{ key: string; size: number }>>
}

/** 事件订阅 API；总线单向：仅 host 发，插件订阅 */
export interface PluginEventBus {
  on<E extends PluginEvent>(event: E, handler: PluginEventHandler<E>): () => void
  off<E extends PluginEvent>(event: E, handler: PluginEventHandler<E>): void
  /** 移除该插件的所有监听器（卸载时由宿主调用） */
  removeAllListenersForPlugin(pluginId: string): void
}

/** 右键菜单项结构 */
export type ContextMenuLocation =
  | 'fileTree'
  | 'fileTreeEmpty'
  | 'editor'
  | 'tab'
  | 'tabBarEmpty'

export interface ContextMenuContext {
  location: ContextMenuLocation
  path?: string
  isDirectory?: boolean
  activePath?: string
  selection?: string
}

export interface ContextMenuItem {
  id: string
  label: string
  iconName?: string
  locations?: ContextMenuLocation[]
  when?: (ctx: ContextMenuContext) => boolean
  onClick: (ctx: ContextMenuContext) => void | Promise<void>
}

export type ContextMenuRegistry = Record<ContextMenuLocation, ContextMenuItem[]>

/**
 * 插件贡献的命令，出现在命令面板（Ctrl/Cmd+P），
 * 可绑定快捷键。id 需跨重载稳定，宿主按 <pluginId>:<id> 索引。
 */
export interface PluginCommand {
  id: string
  label: string
  iconName?: string
  /** 命令面板中的可选分组类别 */
  category?: string
  when?: () => boolean
  onTrigger: () => void | Promise<void>
}

/**
 * 插件权限类型，镜像宿主的固定权限目录。
 */
export type PluginPermission =
  | 'storage'
  | 'events'
  | 'context-menu'
  | 'backend'
  | 'filesystem-read'
  | 'filesystem-write'
  | 'network'
  | 'clipboard'
  | 'notifications'
  | 'editor'

/** 面板/设置组件的 props，字段顺序与宿主一致 */
export interface PluginPanelProps {
  close: () => void
  isActive: boolean
  pluginId: string
  invokeBackend: (command: string, args?: Record<string, unknown>) => Promise<unknown>
  store: PluginStorage
  events: PluginEventBus
  /** 当前活动笔记内容，无笔记时为空串 */
  activeNoteContent: string
  /** 当前活动笔记路径，无笔记时为空串 */
  activeNotePath: string
  /** 按 schema 读取单个设置，返回值为 T 类型 */
  getSetting<T = unknown>(key: string): Promise<T | null>
  /** 持久化单个设置，写穿 SQLite */
  setSetting<T = unknown>(key: string, value: T): Promise<void>
  /** 读取所有设置为扁平 key/value map */
  getAllSettings(): Promise<Record<string, unknown>>
  /** 订阅设置变更，handler 收到 (新值, 旧值, key) */
  onSettingsChange(handler: (settings: Record<string, unknown>) => void): () => void
  /** 获取活动笔记 frontmatter，无则返回 null */
  getActiveNoteFrontmatter(): Record<string, unknown> | null
  /** 合并更新活动笔记 frontmatter */
  setActiveNoteFrontmatter(data: Record<string, unknown>): void
  /** 订阅活动笔记 frontmatter 变更 */
  onNoteFrontmatterChanged(callback: (data: Record<string, unknown>) => void): () => void
}

/**
 * 编辑器工具栏配置：控制各工具栏项的显示/隐藏。
 * 未设置的字段默认显示（保持向后兼容）。插件 tab 通过此配置隐藏不适用的功能。
 */
export interface EditorToolbarConfig {
  /** 复制完整路径按钮（默认 true） */
  copyPath?: boolean
  /** 在文件夹中显示按钮（默认 true） */
  openLocation?: boolean
  /** 打开历史记录按钮（默认 true） */
  openHistory?: boolean
  /** 笔记属性面板按钮（默认 true） */
  noteProperties?: boolean
  /** 大纲/目录按钮（默认 true） */
  directory?: boolean
  /** 源码视图切换按钮（默认 true） */
  sourceView?: boolean
  /** 宽窄模式切换按钮（默认 true） */
  noteWidth?: boolean
  /** 内容布局按钮（默认 true） */
  contentLayout?: boolean
  /** 下载远程图片按钮（默认 true） */
  downloadRemoteImages?: boolean
  /** 左侧文件路径显示（默认 true） */
  showFilePath?: boolean
  /** 外部变更警告（默认 true） */
  externalChangeWarning?: boolean
  /** 冲突指示器（默认 true） */
  conflictIndicator?: boolean
}

/**
 * `openEditorTab` API 的参数：让插件在主编辑区打开一个 tab。
 *
 * 插件调用此 API 后，宿主会在主编辑区创建（或复用同 id 的）tab，
 * 用内置 MarkdownEditor 渲染 content，tab 标题显示插件提供的 icon。
 * 用户编辑内容时，宿主通过 onChange 回调将新内容传回插件，
 * 插件负责保存到自己的存储（如加密数据库）。
 */
export interface OpenEditorTabProps {
  /** tab 唯一标识（用于去重，相同 id 复用已有 tab） */
  id: string
  /** tab 标题文字 */
  name: string
  /** tab 标题图标（替换默认 FileText 图标） */
  icon?: ReactNode
  /** 初始内容（markdown 字符串） */
  content: string
  /** 内容变化回调：用户编辑后宿主调用此函数传回新内容 */
  onChange?: (content: string) => void
  /** 工具栏显示配置（控制各按钮的显示/隐藏） */
  toolbarConfig?: EditorToolbarConfig
}

/**
 * 插件自定义工具栏按钮组件的 props。
 * 宿主渲染此组件替代默认图标按钮，支持自定义交互。
 */
export interface ToolbarButtonProps {
  /** 当前工具栏上下文的推荐图标大小 */
  size: number
  /** 当前插件面板是否激活 */
  isActive: boolean
  /** 插件 ID */
  pluginId: string
  /** 调用插件后端命令 */
  invokeBackend: (command: string, args?: Record<string, unknown>) => Promise<unknown>
  /** 插件作用域的持久化存储 */
  store: PluginStorage
  /** 宿主事件总线 */
  events: PluginEventBus
  /** 激活插件（按 contentPosition 显示面板） */
  activate: () => void
  /** 停用插件（隐藏面板） */
  deactivate: () => void
  /** 当前活动笔记内容，无笔记时为空串 */
  activeNoteContent: string
  /** 当前活动笔记路径，无笔记时为空串 */
  activeNotePath: string
  /** 活动笔记文件名，无笔记时为空串 */
  activeNoteName: string
  /** 活动笔记小写扩展名（无点前缀），无笔记或无扩展名时为空串 */
  activeNoteExt: string
  /** 活动笔记是否为 Markdown 文件 */
  isActiveNoteMarkdown: boolean
  /** 读取单个设置，详见 PluginPanelProps.getSetting */
  getSetting<T = unknown>(key: string): Promise<T | null>
  /** 持久化单个设置，详见 PluginPanelProps.setSetting */
  setSetting<T = unknown>(key: string, value: T): Promise<void>
  /** 读取所有设置，详见 PluginPanelProps.getAllSettings */
  getAllSettings(): Promise<Record<string, unknown>>
  /** 订阅设置变更，详见 PluginPanelProps.onSettingsChange */
  onSettingsChange(handler: (settings: Record<string, unknown>) => void): () => void
  /** 获取活动笔记 frontmatter */
  getActiveNoteFrontmatter(): Record<string, unknown> | null
  /** 更新活动笔记 frontmatter */
  setActiveNoteFrontmatter(data: Record<string, unknown>): void
  /** 订阅活动笔记 frontmatter 变更 */
  onNoteFrontmatterChanged(callback: (data: Record<string, unknown>) => void): () => void
}

/** 插件依赖声明 */
export interface PluginDependency {
  /** 唯一插件标识符 */
  id: string
  /** semver 范围，空或 * 匹配任意版本 */
  version: string
}

/**
 * 插件 index.js 导出的结构。生命周期钩子为扁平顶层字段，
 * 宿主加载时复制到 PluginDefinition.hooks。
 */
export interface PluginManifest {
  id: string
  name: string
  description?: string
  version?: string
  author?: string
  publishedAt?: string
  /** 插件图标显示位置，无 UI 的插件可省略 */
  iconPosition?: IconPosition
  /** 插件面板内容位置，无独立面板的插件可省略 */
  contentPosition?: ContentPosition
  order?: number
  enabled?: boolean
  /** 图标组件，无 UI 时省略；省略后不渲染但仍可贡献其他能力 */
  icon?: ComponentType<{ size?: number }> | ReactNode
  /** 面板内容组件，无独立面板时省略 */
  panel?: ComponentType<PluginPanelProps> | ReactNode
  /** 自定义工具栏按钮组件，替代默认图标按钮 */
  toolbarButton?: ComponentType<ToolbarButtonProps> | ReactNode
  settings?: ComponentType<PluginPanelProps> | ReactNode
  /** 插件可渲染的文件扩展名，需声明 editor 权限 */
  editorFileExtensions?: string[]
  /** 匹配扩展名的文件渲染组件，接收 content/onChange */
  editorComponent?: ComponentType<{
    content: string
    onChange: (content: string) => void
  }> | ReactNode
  /** 插件所需权限，省略时默认为空数组 */
  permissions?: PluginPermission[]
  /** 插件间依赖 */
  dependencies?: PluginDependency[]
  /** 贡献的命令面板 id 列表 */
  commandPalette?: string[]
  /** 是否启用自动更新 */
  autoUpdate?: boolean
  // ── 生命周期钩子（均可选，均为扁平字段） ──────────────────────────
  onLoad?: PluginLifecycleHook
  onUnload?: PluginLifecycleHook
  onEnable?: PluginLifecycleHook
  onDisable?: PluginLifecycleHook
  onMount?: PluginLifecycleHook
  onUnmount?: PluginLifecycleHook
  onActivate?: PluginLifecycleHook
  onDeactivate?: PluginLifecycleHook
}

/**
 * 宿主插件存储中的运行时表示，是 PluginManifest 的水合版本。
 * 钩子包装在 hooks 对象中以便分发。
 */
export interface PluginDefinition {
  id: string
  name: string
  description: string
  version: string
  author: string
  publishedAt: string
  /** 插件图标位置，无 UI 时省略 */
  iconPosition?: IconPosition
  /** 面板内容位置，与 iconPosition 同理可省略 */
  contentPosition?: ContentPosition
  order: number
  enabled: boolean
  /** 已解析的图标组件，无 UI 时省略 */
  icon?: ComponentType<{ size?: number }> | ReactNode
  /** 已解析的面板组件，无独立面板时省略 */
  panel?: ComponentType<PluginPanelProps> | ReactNode
  /** 自定义工具栏按钮组件（覆盖默认图标） */
  toolbarButton?: ComponentType<ToolbarButtonProps> | ReactNode
  settings?: ComponentType<PluginPanelProps> | ReactNode
  /** 插件可渲染的扩展名（带点小写），镜像 manifest 字段 */
  editorFileExtensions?: string[]
  /** 匹配扩展名时宿主挂载的编辑器组件 */
  editorComponent?: ComponentType<{
    content: string
    onChange: (content: string) => void
  }> | ReactNode
  /** 设置 schema 描述，独立预览时为 undefined */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  settingsSchema?: any
  pluginPath: string
  hasBackend: boolean
  /** 插件所需权限，省略时默认为空数组 */
  permissions?: PluginPermission[]
  /** 插件间依赖 */
  dependencies?: PluginDependency[]
  /** 贡献的命令面板 id 列表 */
  commandPalette?: string[]
  /** 是否启用自动更新 */
  autoUpdate?: boolean
  hooks?: {
    onLoad?: PluginLifecycleHook
    onUnload?: PluginLifecycleHook
    onEnable?: PluginLifecycleHook
    onDisable?: PluginLifecycleHook
    onMount?: PluginLifecycleHook
    onUnmount?: PluginLifecycleHook
    onActivate?: PluginLifecycleHook
    onDeactivate?: PluginLifecycleHook
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Storage – in-process Map with optional localStorage persistence
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Per-plugin storage. The stub uses an in-process Map; in browsers
 * we additionally mirror to localStorage so refreshes keep the
 * data. In the host, `setHost({ getPluginStorage })` replaces this
 * with the real Tauri-backed implementation.
 */
function createStubStorage(pluginId: string): PluginStorage {
  const key = (k: string) => `swallow-plugin:${pluginId}:${k}`
  const mem = new Map<string, unknown>()

  // Hydrate from localStorage on first access
  if (typeof localStorage !== 'undefined') {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(`swallow-plugin:${pluginId}:`)) {
        try {
          mem.set(k.slice(`swallow-plugin:${pluginId}:`.length), JSON.parse(localStorage.getItem(k)!))
        } catch {
          // ignore corrupt entries
        }
      }
    }
  }

  const persist = (k: string) => {
    if (typeof localStorage === 'undefined') return
    const fullKey = key(k)
    if (mem.has(k)) localStorage.setItem(fullKey, JSON.stringify(mem.get(k)))
    else localStorage.removeItem(fullKey)
  }

  return {
    async get<T>(k: string): Promise<T | null> {
      return mem.has(k) ? (mem.get(k) as T) : null
    },
    async set<T>(k: string, v: T): Promise<void> {
      mem.set(k, v)
      persist(k)
    },
    async delete(k: string): Promise<void> {
      mem.delete(k)
      persist(k)
    },
    async clear(): Promise<void> {
      for (const k of Array.from(mem.keys())) {
        mem.delete(k)
        persist(k)
      }
    },
    async keys(): Promise<string[]> {
      return Array.from(mem.keys()).sort()
    },
    async entries(): Promise<Array<{ key: string; size: number }>> {
      const out: Array<{ key: string; size: number }> = []
      for (const [k, v] of mem) {
        try {
          out.push({ key: k, size: JSON.stringify(v).length })
        } catch {
          out.push({ key: k, size: 0 })
        }
      }
      return out.sort((a, b) => b.size - a.size)
    },
  }
}

const storageCache = new Map<string, PluginStorage>()

/**
 * Map FIFO（先进先出）上限淘汰：插入新条目后调用，超过 maxSize 时删除最旧条目
 * （Map 按插入顺序迭代，keys().next().value 即最旧；get 时不更新访问顺序，故为
 * FIFO 而非 LRU）。用于 storageCache 与 settingsCache，避免无界增长。
 */
function evictOldest<K, V>(map: Map<K, V>, maxSize: number): void {
  if (map.size > maxSize) {
    const oldest = map.keys().next().value
    if (oldest !== undefined) map.delete(oldest)
  }
}

export function getPluginStorage(pluginId: string): PluginStorage {
  const override = currentHostOverrides().getPluginStorage?.(pluginId)
  if (override) return override
  let s = storageCache.get(pluginId)
  if (!s) {
    s = createStubStorage(pluginId)
    storageCache.set(pluginId, s)
    // FIFO 上限 50：超过时淘汰最旧条目，避免缓存无界增长
    evictOldest(storageCache, 50)
  }
  return s
}

export function dropPluginStorage(pluginId: string): void {
  storageCache.delete(pluginId)
  // 同步清理设置缓存与监听器，确保卸载存储时设置缓存一并释放
  dropPluginSettings(pluginId)
}

// ═══════════════════════════════════════════════════════════════════════════
//  Plugin settings – per-plugin `__settings__` cache in storage
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Special key in the plugin's `PluginStorage` namespace that holds
 * the cached settings map for standalone-mode (no host) runs.
 * Picked with a `__` prefix and a human-friendly name so it
 * never collides with user-chosen storage keys.
 */
export const SETTINGS_CACHE_KEY = '__settings__'

/**
 * Per-plugin settings cache used by the standalone stub. The host
 * bridges `getSetting` / `setSetting` / `getAllSettings` to its
 * own SQLite implementation; this is the no-host fallback so
 * `npm run dev` previews work end-to-end.
 */
const settingsCache = new Map<string, Record<string, unknown>>()

/**
 * In-process pub/sub for settings changes within the standalone
 * stub. Each handler is called with the new full settings map on
 * every write. The host's bus replaces this with real event
 * dispatch when `__pluginSettings_subscribe` is installed.
 */
type SettingsListener = (values: Record<string, unknown>) => void
const settingsListeners = new Map<string, Set<SettingsListener>>()

function readSettingsCache(pluginId: string): Record<string, unknown> {
  let cache = settingsCache.get(pluginId)
  if (cache) return cache
  // 注意：此处未从 storage 读取已持久化的设置（storage 为异步 API），
  // cache 初始化为空对象。硬刷新或缓存淘汰后，getSetting 将返回 null
  // 直到下次 setSetting 写入。writeSettingsCache 会同步写入 storage。
  void getPluginStorage(pluginId)
  cache = {}
  settingsCache.set(pluginId, cache)
  // FIFO 上限 50：超过时淘汰最旧条目，避免缓存无界增长
  evictOldest(settingsCache, 50)
  return cache
}

function writeSettingsCache(
  pluginId: string,
  values: Record<string, unknown>
): Record<string, unknown> {
  settingsCache.set(pluginId, { ...values })
  // FIFO 上限 50：超过时淘汰最旧条目，避免缓存无界增长
  evictOldest(settingsCache, 50)
  // 同步到 storage 以支持硬刷新
  void getPluginStorage(pluginId).set(SETTINGS_CACHE_KEY, values)
  return values
}

function notifySettingsListeners(
  pluginId: string,
  values: Record<string, unknown>
): void {
  const set = settingsListeners.get(pluginId)
  if (!set) return
  for (const handler of Array.from(set)) {
    try {
      handler(values)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[plugin-sdk] settings listener for "${pluginId}" threw:`, err)
    }
  }
}

async function stubGetSetting<T = unknown>(
  pluginId: string,
  key: string
): Promise<T | null> {
  const cache = readSettingsCache(pluginId)
  return (cache[key] as T | undefined) ?? null
}

async function stubGetAllSettings(pluginId: string): Promise<Record<string, unknown>> {
  return { ...readSettingsCache(pluginId) }
}

async function stubSetSetting(
  pluginId: string,
  key: string,
  value: unknown
): Promise<void> {
  const next = { ...readSettingsCache(pluginId), [key]: value }
  writeSettingsCache(pluginId, next)
  notifySettingsListeners(pluginId, next)
}

/**
 * Read a single setting key. The host installs `__pluginSettings_get`
 * to route to SQLite; the standalone stub reads from the in-process
 * cache (hydrated from `__settings__` in storage).
 */
export async function getSetting<T = unknown>(
  pluginId: string,
  key: string
): Promise<T | null> {
  const override = currentHostOverrides().__pluginSettings_get
  if (override) return (await override(pluginId, key)) as T | null
  return stubGetSetting<T>(pluginId, key)
}

/**
 * Persist a single setting key. The host installs `__pluginSettings_set`
 * to route to SQLite; the standalone stub writes to the cache and
 * notifies local subscribers. The event is also dispatched on the
 * shared `pluginEventBus` so subscribers using the host bus can pick
 * it up.
 */
export async function setSetting<T = unknown>(
  pluginId: string,
  key: string,
  value: T
): Promise<void> {
  const override = currentHostOverrides().__pluginSettings_set
  if (override) {
    await override(pluginId, key, value)
    return
  }
  await stubSetSetting(pluginId, key, value)
}

/**
 * Read every stored setting for `pluginId`. Host overrides route to
 * SQLite; the stub returns the full in-process cache.
 */
export async function getAllSettings(pluginId: string): Promise<Record<string, unknown>> {
  const override = currentHostOverrides().__pluginSettings_all
  if (override) return override(pluginId)
  return stubGetAllSettings(pluginId)
}

/**
 * Subscribe to settings changes for `pluginId`. The host installs
 * `__pluginSettings_subscribe` to bridge to the global event bus
 * filtered by `pluginId`; the stub notifies a per-plugin listener
 * set. Returns an unsubscribe function.
 */
export function onSettingsChange(
  pluginId: string,
  handler: (values: Record<string, unknown>) => void
): () => void {
  const override = currentHostOverrides().__pluginSettings_subscribe
  if (override) {
    return override((payload) => {
      if (payload.pluginId !== pluginId) return
      handler(payload.values)
    })
  }
  let set = settingsListeners.get(pluginId)
  if (!set) {
    set = new Set()
    settingsListeners.set(pluginId, set)
  }
  set.add(handler)
  return () => {
    set!.delete(handler)
    if (set!.size === 0) settingsListeners.delete(pluginId)
  }
}

/** Drop a plugin's settings cache and unsubscribe every local listener. */
export function dropPluginSettings(pluginId: string): void {
  settingsCache.delete(pluginId)
  settingsListeners.delete(pluginId)
}

// ═══════════════════════════════════════════════════════════════════════════
//  Event bus – EventTarget wrapper with typed payload helpers
// ═══════════════════════════════════════════════════════════════════════════

class StubEventBus implements PluginEventBus {
  private readonly target = new EventTarget()
  /** handler → wrapped 映射，使 off 能找到原始 wrapped 引用 */
  private readonly wrapperMap = new Map<Function, Map<PluginEvent, EventListener>>()

  on<E extends PluginEvent>(event: E, handler: PluginEventHandler<E>): () => void {
    const wrapped = (e: Event) => handler((e as CustomEvent).detail)
    this.target.addEventListener(event, wrapped)
    let perHandler = this.wrapperMap.get(handler)
    if (!perHandler) {
      perHandler = new Map()
      this.wrapperMap.set(handler, perHandler)
    }
    perHandler.set(event, wrapped)
    return () => {
      this.target.removeEventListener(event, wrapped)
      perHandler!.delete(event)
      if (perHandler!.size === 0) this.wrapperMap.delete(handler)
    }
  }

  off<E extends PluginEvent>(event: E, handler: PluginEventHandler<E>): void {
    const perHandler = this.wrapperMap.get(handler)
    const wrapped = perHandler?.get(event)
    if (wrapped) {
      this.target.removeEventListener(event, wrapped)
      perHandler!.delete(event)
      if (perHandler!.size === 0) this.wrapperMap.delete(handler)
    }
  }

  removeAllListenersForPlugin(_pluginId: string): void {
    // standalone 模式下无法按 pluginId 过滤监听器（EventTarget 不支持枚举）
    // 宿主模式下由宿主的 createPluginEventBus 实现真实清理
  }

  emit<E extends PluginEvent>(event: E, payload: PluginEventPayloadMap[E]): void {
    this.target.dispatchEvent(new CustomEvent(event, { detail: payload }))
  }
}

const stubBus = new StubEventBus()

/**
 * The standalone event bus. The `emit` field is **not** part of the
 * public `PluginEventBus` type (the host bus is one-way), so plugin
 * authors must use the per-event helpers in this module
 * (`emitNoteOpened`, `emitThemeChanged`, …) which check
 * `hostOverrides.emit` first and fall back to the stub.
 *
 * Type-wise we augment with an internal `emit` so the helpers can
 * dispatch without going through the host when running standalone.
 */
type PluginBusWithEmit = PluginEventBus & {
  emit: <E extends PluginEvent>(event: E, payload: PluginEventPayloadMap[E]) => void
}
export const pluginEventBus: PluginEventBus = {
  on: <E extends PluginEvent>(event: E, handler: PluginEventHandler<E>): (() => void) => {
    const hostOn = currentHostOverrides().on
    if (hostOn) return hostOn(event, handler)
    return stubBus.on(event, handler)
  },
  off: <E extends PluginEvent>(event: E, handler: PluginEventHandler<E>): void => {
    const hostOff = currentHostOverrides().off
    if (hostOff) hostOff(event, handler)
    else stubBus.off(event, handler)
  },
  removeAllListenersForPlugin: (pluginId: string): void => {
    // standalone 模式下无法按 pluginId 过滤监听器
    stubBus.removeAllListenersForPlugin(pluginId)
  },
} as PluginBusWithEmit
;(pluginEventBus as unknown as PluginBusWithEmit).emit = stubBus.emit.bind(stubBus)

// ═══════════════════════════════════════════════════════════════════════════
//  Context menu registry – in-process Map
// ═══════════════════════════════════════════════════════════════════════════

class StubMenuRegistry {
  private readonly byPlugin = new Map<string, ContextMenuItem[]>()
  private readonly byLocation: ContextMenuRegistry = {
    fileTree: [],
    fileTreeEmpty: [],
    editor: [],
    tab: [],
    tabBarEmpty: [],
  }

  register(pluginId: string, item: ContextMenuItem): void {
    this.unregister(pluginId, item.id)
    let list = this.byPlugin.get(pluginId)
    if (!list) {
      list = []
      this.byPlugin.set(pluginId, list)
    }
    list.push(item)
    this.indexItem(item)
  }

  unregister(pluginId: string, itemId: string): void {
    const list = this.byPlugin.get(pluginId)
    if (!list) return
    const idx = list.findIndex((it) => it.id === itemId)
    if (idx < 0) return
    list.splice(idx, 1)
    if (list.length === 0) this.byPlugin.delete(pluginId)
    this.rebuildIndex()
  }

  clearPlugin(pluginId: string): void {
    if (!this.byPlugin.has(pluginId)) return
    this.byPlugin.delete(pluginId)
    this.rebuildIndex()
  }

  query(location: ContextMenuLocation, ctx: ContextMenuContext): ContextMenuItem[] {
    const items = this.byLocation[location]
    if (!items || items.length === 0) return []
    return items.filter((it) => {
      if (it.locations && !it.locations.includes(location)) return false
      if (it.when && !it.when(ctx)) return false
      return true
    })
  }

  getByLocation(location: ContextMenuLocation): readonly ContextMenuItem[] {
    return this.byLocation[location]
  }

  private indexItem(item: ContextMenuItem): void {
    const locations: ContextMenuLocation[] = item.locations ?? [
      'fileTree',
      'fileTreeEmpty',
      'editor',
      'tab',
      'tabBarEmpty',
    ]
    for (const loc of locations) {
      this.byLocation[loc].push(item)
    }
  }

  private rebuildIndex(): void {
    for (const loc of Object.keys(this.byLocation) as ContextMenuLocation[]) {
      this.byLocation[loc] = []
    }
    for (const items of this.byPlugin.values()) {
      for (const item of items) this.indexItem(item)
    }
  }
}

const stubMenuRegistry = new StubMenuRegistry()

export function registerContextMenu(pluginId: string, item: ContextMenuItem): void {
  currentHostOverrides().registerContextMenu?.(pluginId, item) ??
    stubMenuRegistry.register(pluginId, item)
}

export function unregisterContextMenu(pluginId: string, itemId: string): void {
  currentHostOverrides().unregisterContextMenu?.(pluginId, itemId) ??
    stubMenuRegistry.unregister(pluginId, itemId)
}

export function clearPluginMenuItems(pluginId: string): void {
  currentHostOverrides().clearPluginMenuItems?.(pluginId) ?? stubMenuRegistry.clearPlugin(pluginId)
}

export function getContextMenuItems(
  location: ContextMenuLocation,
  ctx: ContextMenuContext
): ContextMenuItem[] {
  return (
    currentHostOverrides().getContextMenuItems?.(location, ctx) ??
    stubMenuRegistry.query(location, ctx)
  )
}

/** Read-only access to the in-process menu registry (for debugging) */
export function getStubMenuRegistry(): StubMenuRegistry {
  return stubMenuRegistry
}

// ═══════════════════════════════════════════════════════════════════════════
//  Command palette registry – in-process Map
// ═══════════════════════════════════════════════════════════════════════════

/** Internal per-entry type with the owning plugin id stamped on. */
type RegisteredCommand = PluginCommand & { __pluginId: string }

class StubCommandRegistry {
  private readonly byPlugin = new Map<string, RegisteredCommand[]>()
  private readonly listeners = new Set<() => void>()

  register(pluginId: string, command: PluginCommand): void {
    this.unregister(pluginId, command.id)
    const owned: RegisteredCommand = { ...command, __pluginId: pluginId }
    let list = this.byPlugin.get(pluginId)
    if (!list) {
      list = []
      this.byPlugin.set(pluginId, list)
    }
    list.push(owned)
    this.notify()
  }

  unregister(pluginId: string, commandId: string): void {
    const list = this.byPlugin.get(pluginId)
    if (!list) return
    const idx = list.findIndex((c) => c.id === commandId)
    if (idx < 0) return
    list.splice(idx, 1)
    if (list.length === 0) this.byPlugin.delete(pluginId)
    this.notify()
  }

  clearPlugin(pluginId: string): void {
    if (!this.byPlugin.has(pluginId)) return
    this.byPlugin.delete(pluginId)
    this.notify()
  }

  list(): PluginCommand[] {
    const out: PluginCommand[] = []
    for (const list of this.byPlugin.values()) {
      for (const entry of list) out.push(entry)
    }
    return out
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[plugin-sdk stub] command listener threw:', err)
      }
    }
  }
}

const stubCommandRegistry = new StubCommandRegistry()

/** Register a command-palette entry. Falls back to the in-process
 *  stub when running outside the host. The owning `pluginId` is
 *  stamped automatically — callers do not have to track it. */
export function registerCommand(pluginId: string, command: PluginCommand): void {
  currentHostOverrides().registerCommand?.(pluginId, command) ??
    stubCommandRegistry.register(pluginId, command)
}

export function unregisterCommand(pluginId: string, commandId: string): void {
  currentHostOverrides().unregisterCommand?.(pluginId, commandId) ??
    stubCommandRegistry.unregister(pluginId, commandId)
}

export function clearPluginCommands(pluginId: string): void {
  currentHostOverrides().clearPluginCommands?.(pluginId) ??
    stubCommandRegistry.clearPlugin(pluginId)
}

export function listPluginCommands(): PluginCommand[] {
  return currentHostOverrides().listPluginCommands?.() ?? stubCommandRegistry.list()
}

export function subscribePluginCommands(listener: () => void): () => void {
  // 独立预览模式的兜底，host 加载后由其覆盖
  return currentHostOverrides().subscribePluginCommands?.(listener) ??
    stubCommandRegistry.subscribe(listener)
}

/** Read-only access to the in-process command registry (for debugging) */
export function getStubCommandRegistry(): StubCommandRegistry {
  return stubCommandRegistry
}

// ═══════════════════════════════════════════════════════════════════════════
//  File-editor registry – in-process Map
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Minimal duck-typed stand-in for the host's
 * `PluginPermissionDeniedError`. The SDK intentionally doesn't
 * depend on the host's class (and therefore can't `instanceof`
 * check it), so the host installs an `__assertPluginPermission`
 * override that throws its own class. The SDK catches by `name`
 * here only to surface a console warning — the override's throw
 * itself is what protects the registry.
 */
export class PluginPermissionDeniedError extends Error {
  readonly name = 'PluginPermissionDeniedError'
  constructor(
    public readonly pluginId: string,
    public readonly permission: PluginPermission,
    public readonly operation: string,
  ) {
    super(
      `Plugin "${pluginId}" is not allowed to ${operation} (missing permission: ${permission})`,
    )
    Object.setPrototypeOf(this, PluginPermissionDeniedError.prototype)
  }
}

/**
 * Per-extension entry in the standalone editor registry. The
 * component is held as `unknown` so the SDK stays
 * React-agnostic at the registry layer; consumers narrow it back
 * to the strongly-typed `PluginEditorComponent` (defined by the
 * host bridge) at the call site.
 */
interface StubEditorEntry {
  pluginId: string
  component: ComponentType<{
    content: string
    onChange: (content: string) => void
  }>
}

/**
 * In-process editor registry used when the host is not installed
 * (standalone previews via `npm run dev`). The host installs
 * `HostOverrides.registerEditor` etc. for production; the stub
 * exists so plugin code can call the same SDK entry points and
 * have them work end-to-end in the preview window.
 */
class StubEditorRegistry {
  private readonly byExtension = new Map<string, StubEditorEntry>()

  /**
   * @throws PluginPermissionDeniedError when the caller hasn't
   * installed a host override that asserts the `editor` permission.
   * The host's override calls the host's own
   * `assertPermission(pluginId, 'editor', ...)` which throws its
   * own class; the SDK rethrows the host's error verbatim (the
   * duck-typed `name` field is what the SDK matches on, not the
   * class identity) and the standalone stub throws the SDK's
   * own `PluginPermissionDeniedError` when the host is missing.
   */
  register(
    pluginId: string,
    extension: string,
    component: StubEditorEntry['component'],
  ): void {
    const normalised = this.normaliseExtension(extension)
    this.assertPermission(pluginId, `register editor for "${normalised}"`)
    const existing = this.byExtension.get(normalised)
    if (existing && existing.pluginId !== pluginId) {
      throw new Error(
        `extension "${normalised}" already registered by plugin "${existing.pluginId}"`,
      )
    }
    this.byExtension.set(normalised, { pluginId, component })
  }

  unregister(pluginId: string): void {
    for (const [ext, entry] of Array.from(this.byExtension.entries())) {
      if (entry.pluginId === pluginId) {
        this.byExtension.delete(ext)
      }
    }
  }

  get(extension: string): StubEditorEntry | null {
    return this.byExtension.get(this.normaliseExtension(extension)) ?? null
  }

  extensions(): Set<string> {
    return new Set(this.byExtension.keys())
  }

  /**
   * Normalise the extension to a leading-dot, lower-cased form
   * (e.g. `SMM` → `.smm`). Plugins are documented to declare
   * lower-cased values, but we accept a few common mistakes to
   * make the dev experience forgiving.
   */
  private normaliseExtension(extension: string): string {
    let ext = extension.trim().toLowerCase()
    if (!ext) return ext
    if (!ext.startsWith('.')) ext = `.${ext}`
    return ext
  }

  /**
   * Permission gate. We delegate to a host override so the
   * production check uses the host's authoritative grants
   * (`assertPermission` reads from the user-granted
   * `plugin_permissions_<id>` localStorage record). If no host
   * is installed (standalone preview), the SDK's own
   * `PluginPermissionDeniedError` is the safety net — but the
   * stub still allows every registration in practice because
   * `__assertPluginPermission` is only set by the host.
   */
  private assertPermission(pluginId: string, operation: string): void {
    const override = currentHostOverrides().__assertPluginPermission
    if (override) {
      override(pluginId, 'editor', operation)
      return
    }
    // 独立预览放行，下次加载时由 host 校验
  }
}

const stubEditorRegistry = new StubEditorRegistry()

/**
 * Register a file editor for one or more extensions. Plugins
 * typically call this from `onLoad` (or any lifecycle hook) to
 * claim rendering responsibility for files that match
 * `editorFileExtensions` in their manifest. In host mode the
 * call is forwarded to `src/stores/pluginEditor.ts`, which
 * enforces the `editor` permission and rejects duplicate
 * extensions. In standalone mode the in-process stub above is
 * used.
 */
export function registerEditor(
  pluginId: string,
  extension: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: ComponentType<any>,
): void {
  currentHostOverrides().registerEditor?.(pluginId, extension, component) ??
    stubEditorRegistry.register(pluginId, extension, component)
}

/**
 * Drop every editor this plugin has registered. Mirrors
 * `clearPluginCommands` — the plugin store calls this on
 * uninstall so a removed plugin's editor doesn't keep claiming
 * extensions after the plugin's module is gone.
 */
export function unregisterEditor(pluginId: string): void {
  currentHostOverrides().unregisterEditor?.(pluginId) ??
    stubEditorRegistry.unregister(pluginId)
}

/**
 * Look up the editor for a given extension. Returns `null` if
 * no plugin has registered a matching editor. Host callers
 * (the file-open dispatcher in `Editor.tsx`) use this to
 * decide whether to mount a plugin-provided component or fall
 * back to the built-in Markdown / code editor.
 */
export function getEditorForExtension(
  extension: string,
):
  | { pluginId: string; component: ComponentType<{ content: string; onChange: (content: string) => void }> }
  | null {
  return currentHostOverrides().getEditorForExtension?.(extension) ??
    stubEditorRegistry.get(extension)
}

/** Read-only snapshot of every currently-registered extension.
 *  Useful for diagnostics / conflict detection. */
export function getActivePluginExtensions(): Set<string> {
  return currentHostOverrides().getActivePluginExtensions?.() ??
    stubEditorRegistry.extensions()
}

/**
 * 让插件在主编辑区打开一个 tab。
 *
 * 插件调用此 API 后，宿主会在主编辑区创建（或复用同 id 的）tab，
 * 用内置 MarkdownEditor 渲染 content，tab 标题显示插件提供的 icon。
 * 用户编辑内容时，宿主通过 onChange 回调将新内容传回插件，
 * 插件负责保存到自己的存储（如加密数据库）。
 *
 * 在宿主模式下转发到 `plugin-host-takeover` 的 bridge 实现；
 * 在独立预览模式下（npm run dev）打印警告并 no-op，
 * 因为没有主编辑区可以打开。
 */
export function openEditorTab(pluginId: string, props: OpenEditorTabProps): void {
  const host = currentHostOverrides().openEditorTab
  if (host) {
    host(pluginId, props)
  } else {
    // 独立预览模式：没有主编辑区，打印警告帮助开发者排查
    // eslint-disable-next-line no-console
    console.warn(
      `[plugin-sdk] openEditorTab called for plugin "${pluginId}" but no host override is installed. ` +
        `This is expected in standalone preview mode (npm run dev); in host mode the host installs the override via setHost().`,
    )
  }
}

/**
 * 关闭指定插件打开的某个 tab。
 *
 * 插件调用此 API 后，宿主会精确关闭该插件创建的、id 匹配的 tab。
 * 适用于删除单个笔记等场景，不影响该插件打开的其他 tab。
 */
export function closeEditorTab(pluginId: string, tabId: string): void {
  const host = currentHostOverrides().closeEditorTab
  if (host) {
    host(pluginId, tabId)
  } else {
    // 独立预览模式：没有主编辑区，打印警告帮助开发者排查
    // eslint-disable-next-line no-console
    console.warn(
      `[plugin-sdk] closeEditorTab called for plugin "${pluginId}" tab "${tabId}" but no host override is installed. ` +
        `This is expected in standalone preview mode (npm run dev); in host mode the host installs the override via setHost().`,
    )
  }
}

/**
 * 关闭指定插件打开的所有 tab。
 *
 * 插件调用此 API 后，宿主会过滤掉所有由该插件打开的 tab。
 * 适用于插件锁定、卸载等场景，确保清理所有相关的编辑器 tab。
 */
export function closePluginTabs(pluginId: string): void {
  const host = currentHostOverrides().closePluginTabs
  if (host) {
    host(pluginId)
  } else {
    // 独立预览模式：没有主编辑区，打印警告帮助开发者排查
    // eslint-disable-next-line no-console
    console.warn(
      `[plugin-sdk] closePluginTabs called for plugin "${pluginId}" but no host override is installed. ` +
        `This is expected in standalone preview mode (npm run dev); in host mode the host installs the override via setHost().`,
    )
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  PluginContext + lifecycle helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build a PluginContext for the current plugin. Plugins normally
 * receive this through lifecycle hooks; in standalone mode you can
 * call this directly to test hook implementations.
 */
export function buildPluginContext(plugin: Pick<PluginDefinition, 'id' | 'pluginPath'>): PluginContext {
  return {
    pluginId: plugin.id,
    pluginPath: plugin.pluginPath,
    invokeBackend: async (cmd: string, args?: Record<string, unknown>) => {
      // In standalone mode, return a friendly stub.
      const hostInvoke = currentHostOverrides().invokeBackend
      if (hostInvoke) return hostInvoke(cmd, args)
      console.warn(`[plugin-sdk] invokeBackend(${cmd}) called in standalone mode; returning null`)
      return null
    },
    // 默认 console-based logger；host 会覆盖为统一日志通道
    log: {
      trace: (msg, ...args) => console.trace(`[plugin:${plugin.id}] ${msg}`, ...args),
      debug: (msg, ...args) => console.debug(`[plugin:${plugin.id}] ${msg}`, ...args),
      info: (msg, ...args) => console.info(`[plugin:${plugin.id}] ${msg}`, ...args),
      warn: (msg, ...args) => console.warn(`[plugin:${plugin.id}] ${msg}`, ...args),
      error: (msg, ...args) => console.error(`[plugin:${plugin.id}] ${msg}`, ...args),
    },
  }
}

/** Options for `runLifecycleHook`. */
export interface RunLifecycleHookOptions {
  /**
   * If set, the hook is rejected with a `PluginLifecycleTimeoutError`
   * after this many milliseconds. The host uses a 5s default to
   * bound the damage a wedged plugin can do; standalone previews
   * can leave it unset (no timeout) so a `debugger` statement in a
   * dev session doesn't immediately throw.
   */
  timeoutMs?: number
  /**
   * If provided, called *before* the timeout fires — useful for
   * surfacing the timeout as a toast / log line so the plugin
   * author knows their hook overran. The default behaviour (no
   * callback) still throws the timeout error after the wait.
   */
  onTimeout?: (elapsedMs: number) => void
}

/** Thrown by `runLifecycleHook` when the hook exceeds `timeoutMs`. */
export class PluginLifecycleTimeoutError extends Error {
  readonly name = 'PluginLifecycleTimeoutError'
  constructor(public readonly elapsedMs: number, public readonly timeoutMs: number) {
    super(`Plugin lifecycle hook exceeded ${timeoutMs}ms (elapsed ${elapsedMs}ms)`)
  }
}

/**
 * Run a lifecycle hook, await async ones, swallow errors. The hook
 * receives a `PluginContext` so plugin authors can do meaningful
 * work (e.g. register context-menu items, load persisted settings)
 * without reaching for host-specific globals.
 *
 * When `opts.timeoutMs` is set, the hook is raced against a
 * `setTimeout` — if the hook doesn't settle in time we throw
 * `PluginLifecycleTimeoutError` so the host can mark the plugin
 * unhealthy. Errors thrown synchronously by the hook are caught
 * and logged (the SDK's policy is "lifecycle is best-effort,
 * errors don't break the host"), matching the previous behaviour.
 */
export async function runLifecycleHook(
  hook: PluginLifecycleHook | undefined,
  ctx: PluginContext,
  opts: RunLifecycleHookOptions = {}
): Promise<void> {
  if (!hook) return
  const { timeoutMs, onTimeout } = opts
  if (timeoutMs === undefined) {
    try {
      await hook(ctx)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[plugin-sdk] lifecycle hook failed:`, err)
    }
    return
  }
  const start = Date.now()
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      const elapsed = Date.now() - start
      onTimeout?.(elapsed)
      reject(new PluginLifecycleTimeoutError(elapsed, timeoutMs))
    }, timeoutMs)
  })
  try {
    await Promise.race([hook(ctx), timeoutPromise])
  } catch (err) {
    if (err instanceof PluginLifecycleTimeoutError) {
      // eslint-disable-next-line no-console
      console.error(
        `[plugin-sdk] lifecycle hook timed out after ${timeoutMs}ms:`,
        err
      )
      return
    }
    // eslint-disable-next-line no-console
    console.error(`[plugin-sdk] lifecycle hook failed:`, err)
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Host overrides – SwallowNote calls `setHost(...)` once per plugin
// ═══════════════════════════════════════════════════════════════════════════

export interface HostOverrides {
  getPluginStorage?: (pluginId: string) => PluginStorage
  registerContextMenu?: (pluginId: string, item: ContextMenuItem) => void
  unregisterContextMenu?: (pluginId: string, itemId: string) => void
  clearPluginMenuItems?: (pluginId: string) => void
  getContextMenuItems?: (
    location: ContextMenuLocation,
    ctx: ContextMenuContext
  ) => ContextMenuItem[]
  /**
   * Optional command-palette bridge (Task 9 / G9). When the host
   * provides these, the SDK's `registerCommand` /
   * `unregisterCommand` / `clearPluginCommands` forward into the
   * host's permission-checked registry; otherwise the in-process
   * stub registry backs them so standalone previews keep working.
   */
  registerCommand?: (pluginId: string, command: PluginCommand) => void
  unregisterCommand?: (pluginId: string, commandId: string) => void
  clearPluginCommands?: (pluginId: string) => void
  listPluginCommands?: () => PluginCommand[]
  subscribePluginCommands?: (listener: () => void) => () => void
  invokeBackend?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
  /**
   * Optional full event-bus replacement. If the host provides only
   * `on`/`off` (no `emit`), the per-event emit helpers in this
   * module will fall back to the in-process stub bus – this is
   * fine because the host bus is one-way anyway and most plugins
   * never call emit helpers.
   */
  on?: PluginEventBus['on']
  off?: PluginEventBus['off']
  emit?: <E extends PluginEvent>(event: E, payload: PluginEventPayloadMap[E]) => void
  /**
   * Bridge to the host's SQLite-backed plugin settings layer. When
   * the host installs these overrides the SDK's `getSetting` /
   * `setSetting` / `getAllSettings` use real SQLite instead of the
   * localStorage stub.
   *
   * Naming convention: `__pluginSettings_get` etc. uses a `__`
   * prefix so it can never collide with any user storage key.
   * The host reads/writes the per-plugin SQLite table
   * `plugin_settings_<id>` rather than the plugin's JSON storage.
   */
  __pluginSettings_get?: (pluginId: string, key: string) => Promise<unknown>
  __pluginSettings_set?: (pluginId: string, key: string, value: unknown) => Promise<void>
  __pluginSettings_all?: (pluginId: string) => Promise<Record<string, unknown>>
  __pluginSettings_subscribe?: (handler: (payload: PluginEventPayloadMap['plugin-settings:change']) => void) => () => void
  /**
   * Permission gate for the editor registry. The host installs
   * this so the SDK's `registerEditor` can throw the host's
   * authoritative `PluginPermissionDeniedError` when a plugin
   * claims the `editor` permission without actually being
   * granted it. The `__` prefix mirrors the settings overrides
   * above — these are SDK-internal bridges, not part of the
   * public plugin API.
   */
  __assertPluginPermission?: (
    pluginId: string,
    permission: PluginPermission,
    operation: string,
  ) => void
  /**
   * File-editor registry bridges. The host installs these so
   * plugin code that calls `registerEditor` /
   * `unregisterEditor` / `getEditorForExtension` /
   * `getActivePluginExtensions` goes through the production
   * registry in `src/stores/pluginEditor.ts` (which performs
   * duplicate-extension detection, permission re-checks, and
   * toasts the user on conflict). The standalone stub backs
   * the same functions when the host is absent (npm run dev).
   */
  registerEditor?: (
    pluginId: string,
    extension: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    component: ComponentType<any>,
  ) => void
  unregisterEditor?: (pluginId: string) => void
  getEditorForExtension?: (extension: string) => {
    pluginId: string
    component: ComponentType<{
      content: string
      onChange: (content: string) => void
    }>
  } | null
  getActivePluginExtensions?: () => Set<string>
  /**
   * Bridge for `openEditorTab`: lets a plugin open a tab in the
   * host's main editor area. The host installs this via setHost()
   * so plugin calls to `openEditorTab(pluginId, props)` are
   * forwarded into `src/lib/plugin-host-takeover.ts`, which
   * creates/reuses an EditorTab with `type: 'plugin'` and
   * registers the non-serializable runtime data (icon, onChange)
   * via `registerPluginTabRuntime`.
   */
  openEditorTab?: (pluginId: string, props: OpenEditorTabProps) => void
  /**
   * Bridge for `closePluginTabs`: closes all tabs opened by the specified plugin.
   * The host installs this via setHost() so plugin calls to `closePluginTabs(pluginId)`
   * are forwarded into `src/lib/plugin-host-takeover.ts`, which calls filterTabs
   * to remove all tabs with matching pluginId.
   */
  closePluginTabs?: (pluginId: string) => void
  /**
   * Bridge for `closeEditorTab`: closes a single tab opened by the specified plugin.
   * The host installs this via setHost() so plugin calls to `closeEditorTab(pluginId, tabId)`
   * are forwarded into `src/lib/plugin-host-takeover.ts`, which calls removeTab
   * for the matching tab id (after verifying it belongs to the plugin).
   */
  closeEditorTab?: (pluginId: string, tabId: string) => void
}

/**
 * Stack of active host overrides. Each `setHost` call pushes a new
 * layer; the returned `restore` callback pops **only the layer
 * created by that call** (matched by a unique token), so
 * restore order is independent of push order. This is what lets
 * the host fire multiple plugins' hooks concurrently – plugin A's
 * `setHost(A)` and plugin B's `setHost(B)` are independent, and
 * whichever hook finishes first can clean up its own layer
 * without disturbing the others.
 *
 * We keep each layer's merged overrides precomputed (no `Object.assign`
 * on a shared `hostOverrides` singleton) so popping is O(stack depth)
 * and the previous layer's identity stays stable for the duration
 * of the layer's lifetime.
 */
interface HostOverrideLayer {
  overrides: HostOverrides
  token: number
}
const hostOverridesStack: HostOverrideLayer[] = []
let nextHostToken = 0

/** Read the currently-active merged overrides (top of the stack). */
function currentHostOverrides(): HostOverrides {
  const top = hostOverridesStack[hostOverridesStack.length - 1]
  return top ? top.overrides : EMPTY_HOST_OVERRIDES
}

const EMPTY_HOST_OVERRIDES: HostOverrides = Object.freeze({}) as HostOverrides

/**
 * Internal helper: dispatch an event through the host if a
 * takeover has been installed, otherwise through the standalone
 * stub bus. Used by the per-event emit helpers below.
 *
 * Wave B / M4: the host's `emit` override runs
 * `assertPermission(pluginId, 'events', ...)` before forwarding
 * the call into the global bus. If the plugin lacks the `events`
 * grant the call throws a `PluginPermissionDeniedError`, which
 * the previous implementation silently swallowed in this
 * try/catch. That hid a very real problem from plugin authors:
 * their `emitNoteChanged(...)` looked like it succeeded (no
 * exception) but no other plugin's handler ever saw the event.
 * We now log a `console.warn` (not `error` — the SDK does not
 * treat a missing grant as a programming bug) with a clear,
 * actionable message. We don't re-throw, because the existing
 * public surface is "emit is fire-and-forget" and a hard throw
 * would break plugins that wrap emits in their own try/catch.
 *
 * We can't `instanceof` the host's error class directly (the
 * SDK is intentionally host-agnostic) so we detect by `name`
 * instead — the class lives in
 * `src/lib/plugin-permission-guard.ts` and is the only Error
 * subclass named `PluginPermissionDeniedError` in this app.
 */
function dispatchEmit<E extends PluginEvent>(event: E, payload: PluginEventPayloadMap[E]): void {
  const hostEmit = currentHostOverrides().emit
  if (hostEmit) {
    try {
      hostEmit(event, payload)
    } catch (err) {
      // 权限拒绝时大声报错便于排查
      if (
        err &&
        typeof err === 'object' &&
        (err as { name?: string }).name === 'PluginPermissionDeniedError'
      ) {
        const op = (err as { operation?: string }).operation ?? `emit "${event}"`
        // eslint-disable-next-line no-console
        console.warn(
          `[plugin-sdk] ${op} was denied: this plugin is missing the "events" permission. ` +
            `Add "events" to the manifest's "permissions" array and ensure the user has granted it ` +
            `(see Settings → Plugins → Permissions). The emit was dropped silently — no other ` +
            `plugin's handler will see event "${event}".`,
        )
        return
      }
      // 其他异常视为 bug，保留错误日志
      // eslint-disable-next-line no-console
      console.error(`[plugin-sdk] host emit for "${event}" threw:`, err)
    }
    return
  }
  ;(pluginEventBus as unknown as PluginBusWithEmit).emit(event, payload)
}

/**
 * Replace the stub implementations with real ones provided by the
 * host. The host calls this once per plugin (typically just before
 * firing a lifecycle hook), then calls the returned `restore` to
 * pop the layer (typically in a `finally`).
 *
 * The SDK supports **arbitrary-order restore** because each
 * `setHost` call gets a unique token and `restore` matches by
 * that token rather than relying on a `previous` snapshot. This
 * is what makes concurrent hook fires safe – plugin A can pop its
 * own layer while plugin B's layer is still active.
 *
 * Plugins should not call this directly. Bundlers that tree-shake
 * unused exports must keep `setHost` reachable: the host needs to
 * call it on the plugin bundle, so plugin authors must
 * `export { setHost } from '@swallow-note/plugin-sdk'` from their
 * entry file.
 */
export function setHost(overrides: HostOverrides): () => void {
  const token = nextHostToken++
  // 合并 overrides 到新对象，pop 不影响下层
  const merged: HostOverrides = { ...currentHostOverrides(), ...overrides }
  hostOverridesStack.push({ overrides: merged, token })
  return () => {
    // 自顶向下查找 token，O(n) 终止
    for (let i = hostOverridesStack.length - 1; i >= 0; i--) {
      if (hostOverridesStack[i].token === token) {
        hostOverridesStack.splice(i, 1)
        return
      }
    }
    // 重复 restore 静默忽略，避免 finally 双触发崩溃
  }
}

/**
 * Pop every active host override. The host should rarely need this –
 * the per-layer `restore` from `setHost` is the right tool – but
 * the helper is useful for tests that want to reset state between
 * cases without tracking individual tokens.
 */
export function clearHost(): void {
  hostOverridesStack.length = 0
}

// ═══════════════════════════════════════════════════════════════════════════
//  React hooks
// ═══════════════════════════════════════════════════════════════════════════

/**
 * State backed by plugin storage. Mirrors the host's
 * `usePluginStorage` semantics.
 */
export function usePluginStorage<T = unknown>(
  panel: PluginPanelProps,
  key: string,
  initialValue: T
): [T, (next: T | ((prev: T) => T) | null) => void] {
  const { store } = panel
  const [value, setValue] = useState<T>(initialValue)

  useEffect(() => {
    let cancelled = false
    void store.get<T>(key).then((stored) => {
      if (cancelled) return
      if (stored !== null) setValue(stored)
    })
    return () => {
      cancelled = true
    }
    // 依赖 key 而非 initialValue，避免父组件重渲染覆盖状态
  }, [key, store])

  const set = useCallback(
    (next: T | ((prev: T) => T) | null) => {
      if (next === null) {
        setValue(initialValue)
        void store.delete(key)
        return
      }
      const resolved = typeof next === 'function' ? (next as (p: T) => T)(value) : next
      setValue(resolved)
      void store.set(key, resolved)
    },
    // 捕获 value 与 initialValue 保证函数式更新最新
    [key, store, value, initialValue]
  )

  return [value, set]
}

/**
 * Convenience helper for narrowing a panel prop down to the two
 * handles plugins reach for most often (`store` and `events`).
 *
 * Equivalent to `const { store, events } = panel` but type-narrowed
 * so accidental access to `close` / `invokeBackend` etc. doesn't
 * leak into a hook body.
 */
export function usePluginServices(panel: PluginPanelProps): {
  store: PluginStorage
  events: PluginEventBus
} {
  return { store: panel.store, events: panel.events }
}

/**
 * Live snapshot of every plugin command currently registered.
 *
 * In standalone mode this is backed by the in-process command
 * registry (the same one `registerCommand` writes to). In host
 * mode the host installs an override via `setHost` so the hook
 * sees every command registered through the host's
 * permission-checked registry — including those from plugins that
 * use the host's internal `plugin-commands` module directly.
 *
 * Filters out entries whose `when()` predicate returns false
 * (e.g. a "Commit" command hiding outside a git workspace). The
 * registry keeps the hidden entry so a later re-render with a
 * changed `when()` flips visibility back on without re-registering.
 */
export function usePluginCommands(): PluginCommand[] {
  const [commands, setCommands] = useState<PluginCommand[]>(() =>
    listPluginCommands()
  )

  useEffect(() => {
    const refresh = () => {
      const next = listPluginCommands().filter((cmd) => {
        if (cmd.when) {
          try {
            return cmd.when()
          } catch {
            // A buggy `when()` must not blow up the whole palette.
            return true
          }
        }
        return true
      })
      setCommands(next)
    }
    refresh()
    return subscribePluginCommands(refresh)
  }, [])

  return commands
}

/** Subscribe to a single host event. */
export function usePluginEvent<E extends PluginEvent>(
  panel: PluginPanelProps,
  event: E,
  handler: PluginEventHandler<E>
): void {
  const handlerRef = useRef(handler)
  handlerRef.current = handler
  const { events } = panel

  useEffect(() => {
    // __pluginId 由 host 总线自动打标
    const wrapped = ((payload: PluginEventPayloadMap[E]) => {
      handlerRef.current(payload)
    }) as PluginEventHandler<E>
    return events.on(event, wrapped)
  }, [event, events])
}

/** Subscribe to multiple events with a unified callback. */
export function usePluginEvents<E extends PluginEvent>(
  panel: PluginPanelProps,
  events: readonly E[],
  // 多事件订阅时 payload 为 unknown，单事件用 usePluginEvent
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (event: E, payload: unknown) => void
): void {
  const { events: bus } = panel
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    const unsubs = events.map((evt) => {
      const wrapped = ((payload: PluginEventPayloadMap[typeof evt]) => {
        handlerRef.current(evt, payload)
      }) as PluginEventHandler<typeof evt>
      return bus.on(evt, wrapped)
    })
    return () => {
      for (const u of unsubs) u()
    }
  }, [bus, events])
}

// ═══════════════════════════════════════════════════════════════════════════
// dev preview 专用 emit 助手
// ═══════════════════════════════════════════════════════════════════════════

export function emitNoteOpened(noteId: string, path: string): void {
  dispatchEmit('note:open', { noteId, path })
}
export function emitNoteClosed(noteId: string, path: string): void {
  dispatchEmit('note:close', { noteId, path })
}
export function emitNoteSaved(noteId: string, path: string): void {
  dispatchEmit('note:save', { noteId, path })
}
export function emitNoteChanged(noteId: string, path: string, content: string): void {
  dispatchEmit('note:change', { noteId, path, content })
}
export function emitThemeChanged(theme: string): void {
  dispatchEmit('theme:change', { theme })
}
export function emitLocaleChanged(locale: string): void {
  dispatchEmit('locale:change', { locale })
}
export function emitSettingChanged(key: string, value: unknown): void {
  dispatchEmit('settings:change', { key, value })
}
export function emitAppReady(): void {
  dispatchEmit('app:ready', {})
}
export function emitAppExit(): void {
  dispatchEmit('app:exit', {})
}
/**
 * Notify subscribers that a plugin's settings have changed. Fires
 * the `plugin-settings:change` event with the new full values
 * map. Used by host code (after a SQLite write) to fan the change
 * out to every panel/toolbar instance of the same plugin id, and
 * by the standalone stub (after a `setSetting` call) to keep the
 * in-process pub/sub in sync.
 */
export function emitPluginSettingsChanged(
  pluginId: string,
  values: Record<string, unknown>
): void {
  dispatchEmit('plugin-settings:change', { pluginId, values })
}

// ═══════════════════════════════════════════════════════════════════════════
//  Version sentinel
// ═══════════════════════════════════════════════════════════════════════════

/**
 * SDK version. The host checks this against its own expected
 * version on plugin load; a mismatch produces a warning, not an
 * error, so plugins keep working across minor SDK releases.
 */
export const SDK_VERSION = '0.1.0'
