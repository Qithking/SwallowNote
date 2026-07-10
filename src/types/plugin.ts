/** 插件系统类型定义：清单、生命周期 hook、运行时定义、市场索引等。 */

import type { ReactNode, ComponentType } from 'react'
import type { NoteFrontmatter } from '@/lib/types/frontmatter'

// 枚举类型

/** 插件图标显示位置 */
export type IconPosition = 'sidebar' | 'editorToolbar' | 'titleBar'

/** 插件面板显示位置 */
export type ContentPosition = 'leftPanel' | 'rightPanel' | 'fullPanel' | 'editorArea'

// 权限类型

/** 插件权限类型，清单中声明，安装或设置时授权 */
export type PluginPermission =
  | 'storage'           // 持久化存储
  | 'events'            // 订阅宿主事件
  | 'context-menu'      // 注册右键菜单项
  | 'backend'           // Rust 后端 IPC
  | 'filesystem-read'   // 读文件系统
  | 'filesystem-write'  // 写文件系统
  | 'network'           // 网络请求
  | 'clipboard'         // 访问剪贴板
  | 'notifications'     // 显示通知
  | 'editor'            // 注册自定义编辑器

/** 权限元数据（UI 展示用） */
export interface PermissionInfo {
  permission: PluginPermission
  icon?: string
}

/** 插件权限状态 */
export interface PluginPermissionStatus {
  permission: PluginPermission
  granted: boolean
  requested: boolean
}

/** 已知权限的规范列表。 */
export const PLUGIN_PERMISSIONS: PermissionInfo[] = [
  { permission: 'storage' },
  { permission: 'events' },
  { permission: 'context-menu' },
  { permission: 'backend' },
  { permission: 'filesystem-read' },
  { permission: 'filesystem-write' },
  { permission: 'network' },
  { permission: 'clipboard' },
  { permission: 'notifications' },
  { permission: 'editor' },
]

// 事件总线类型

/** 宿主事件，每个事件有强类型 payload */
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

/** 各事件 payload 类型，新增事件时添加分支 */
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

/** 事件订阅 handler 签名 */
export type PluginEventHandler<E extends PluginEvent = PluginEvent> = (
  payload: PluginEventPayloadMap[E]
) => void

// 插件清单（来自 index.js）

/** 运行时上下文，传递给生命周期 hook */
export interface PluginContext {
  pluginId: string
  pluginPath: string
  invokeBackend: (command: string, args?: Record<string, unknown>) => Promise<unknown>
}

/** 生命周期 hook 签名，可同步或异步 */
export type PluginLifecycleHook = (context: PluginContext) => void | Promise<void>

/** 插件持久化存储，按插件 id 隔离键空间 */
export interface PluginStorage {
  get<T = unknown>(key: string): Promise<T | null>
  set<T = unknown>(key: string, value: T): Promise<void>
  delete(key: string): Promise<void>
  clear(): Promise<void>
  /** 列出键，用于调试和导出 */
  keys(): Promise<string[]>
  /** keys(): 列出键。entries(): 返回 [{key, size}] 按 size 降序。 */
  entries(): Promise<Array<{ key: string; size: number }>>
}

/** 面板事件订阅 API，on 返回取消函数 */
export interface PluginEventBus {
  on<E extends PluginEvent>(event: E, handler: PluginEventHandler<E>): () => void
  off<E extends PluginEvent>(event: E, handler: PluginEventHandler<E>): void
  /** 移除该插件的所有监听器（卸载时调用） */
  removeAllListenersForPlugin(pluginId: string): void
}

/** 插件间依赖声明。version 为 npm 风格 semver 范围。 */
export interface PluginDependency {
  /** 唯一插件标识符 */
  id: string
  /** semver 范围，空或 * 匹配任意版本 */
  version: string
}

/** 插件 index.js 导出的原始清单。 */
export interface PluginManifest {
  /** 唯一插件标识符 */
  id: string
  /** 显示名 */
  name: string
  /** 插件描述 */
  description?: string
  /** 版本号（建议 semver） */
  version?: string
  /** 作者名 */
  author?: string
  /** ISO-8601 发布日期 */
  publishedAt?: string
  /** 图标位置，无 UI 的插件可省略 */
  iconPosition?: IconPosition
  /** 面板位置，仅贡献编辑器组件时可省略 */
  contentPosition?: ContentPosition
  /** 图标栏排序（小者靠前），默认 100 */
  order?: number
  /** 是否启用，默认 true */
  enabled?: boolean
  /** 图标，可为组件或 ReactNode，省略则不渲染 */
  icon?: ComponentType<{ size?: number }> | ReactNode
  /** 面板内容，可为组件或 ReactNode，省略则不挂载 */
  panel?: ComponentType<PluginPanelProps> | ReactNode
  /** 可选自定义工具栏按钮组件。 */
  toolbarButton?: ComponentType<ToolbarButtonProps> | ReactNode
  /** 设置 UI 组件，在弹窗中渲染，用 close 关闭 */
  settings?: ComponentType<PluginPanelProps> | ReactNode
  /** 可渲染的文件扩展名（带点小写），同一扩展名仅允许一个插件注册 */
  editorFileExtensions?: string[]
  /** 编辑器组件，接收 content/onChange */
  editorComponent?: ComponentType<{
    content: string
    onChange: (content: string) => void
  }> | ReactNode
  /** 插件所需权限。 */
  permissions?: PluginPermission[]
  /** 依赖的其他插件。 */
  dependencies?: PluginDependency[]
  /** 贡献给命令面板的 id 列表。 */
  commandPalette?: string[]
  /** 用户 opt-in 的自动更新标志，持久化在 localStorage。 */
  autoUpdate?: boolean
  // 生命周期 hook（均可选）
  /** 插件模块加载后调用一次 */
  onLoad?: PluginLifecycleHook
  /** 插件注销前调用一次 */
  onUnload?: PluginLifecycleHook
  /** 插件切换为启用时调用一次 */
  onEnable?: PluginLifecycleHook
  /** 插件切换为禁用时调用一次 */
  onDisable?: PluginLifecycleHook
  /** 面板组件挂载时调用 */
  onMount?: PluginLifecycleHook
  /** 面板组件卸载时调用 */
  onUnmount?: PluginLifecycleHook
  /** 面板变为活动/可见时调用 */
  onActivate?: PluginLifecycleHook
  /** 面板不再活动/可见时调用 */
  onDeactivate?: PluginLifecycleHook
}

// 运行时插件定义（存储在 plugin store 中）

/** 运行时表示，icon/panel 已解析为可用 */
export interface PluginDefinition {
  id: string
  name: string
  description: string
  version: string
  author: string
  publishedAt: string
  /** 图标位置，未定义时不出现在任何工具栏 */
  iconPosition?: IconPosition
  /** 面板位置，同 iconPosition 可省略 */
  contentPosition?: ContentPosition
  order: number
  enabled: boolean
  /** 已解析的图标组件或 ReactNode，无 UI 时省略 */
  icon?: ComponentType<{ size?: number }> | ReactNode
  /** 已解析的面板组件或 ReactNode */
  panel?: ComponentType<PluginPanelProps> | ReactNode
  /** 自定义工具栏按钮组件，接收 ToolbarButtonProps */
  toolbarButton?: ComponentType<ToolbarButtonProps> | ReactNode
  /** 可选设置 UI 组件。 */
  settings?: ComponentType<PluginPanelProps> | ReactNode
  /** 可渲染的文件扩展名，镜像清单中的字段 */
  editorFileExtensions?: string[]
  /** 编辑器组件，镜像清单中的字段 */
  editorComponent?: ComponentType<{
    content: string
    onChange: (content: string) => void
  }> | ReactNode
  /** 插件包目录的绝对路径 */
  pluginPath: string
  /** 是否有 Rust 后端 */
  hasBackend: boolean
  /** 是否包含 settings.json schema */
  hasSettingsSchema?: boolean
  /** 插件声明的权限，安装时请求 */
  permissions: PluginPermission[]
  /** 插件间依赖，安装时由 resolveDependencies 消费 */
  dependencies?: PluginDependency[]
  /** 贡献的命令面板 id，由 detectPluginConflicts 消费 */
  commandPalette?: string[]
  /** 自动更新标志的镜像，store 持有权威值 */
  autoUpdate?: boolean
  /** 安装来源 URL，本地 zip 上传时为空 */
  source: string
  /** 生命周期 hook，注册/注销/启用/禁用时调用 */
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

// 插件元数据（Rust 后端存储/返回）

/** Rust 后端扫描插件目录返回的元数据，不含 icon/panel */
export interface PluginMetadata {
  id: string
  name: string
  description: string
  version: string
  author: string
  publishedAt: string
  /** 图标位置，未定义时跳过渲染 */
  iconPosition?: IconPosition
  /** 面板位置，同 iconPosition 可省略 */
  contentPosition?: ContentPosition
  order: number
  enabled: boolean
  /** 插件包目录的绝对路径 */
  pluginPath: string
  /** 是否有 backend 目录 */
  hasBackend: boolean
  /** 安装来源 URL，本地 zip 上传时为空 */
  source: string
}

// 插件加载失败记录

/** 单个加载失败的插件记录。 */
export interface PluginLoadFailure {
  /** 插件 id（来自 Rust 元数据） */
  id: string
  /** 显示名（来自 Rust 元数据回退） */
  name: string
  /** 可读的失败原因 */
  reason: string
  /** 记录时间（Unix 毫秒） */
  ts: number
  /** 插件包绝对路径，用于诊断 */
  pluginPath: string
}

// 插件加载结果（loader → 调用方）

/** loadAllPlugins 的结果。 */
export interface PluginLoadResult {
  plugins: PluginDefinition[]
  failures: PluginLoadFailure[]
}

// 插件市场

/** 远程仓库索引中的一行，镜像 Rust 的 PluginIndexEntry */
export interface PluginIndexEntry {
  id: string
  name: string
  version: string
  description: string
  author: string
  icon?: string
  tags: string[]
  downloadUrl: string
  sha256: string
  signatureB64: string
  /** 可选的仓库级 key 覆盖 */
  pubkeyB64: string
  /** 最新版本的可选 changelog。 */
  changelog?: string
  /** 可选 ISO-8601 发布时间 */
  publishedAt?: string
  /** 可选历史版本记录。 */
  versions?: PluginIndexEntryVersion[]
  dependencies: string[]
}

export interface PluginIndexEntryVersion {
  version: string
  downloadUrl: string
  sha256: string
  /** 每版本 ed25519 签名，缺失时回退到 entry 级签名。 */
  signatureB64?: string
  /** 可选每版本 pubkey 覆盖，回退到 entry 或 index 级 */
  pubkeyB64?: string
  changelog: string
  publishedAt: string
}

/** 市场详情 UI 的别名，规范名为 PluginIndexEntryVersion */
export type PluginIndexVersion = PluginIndexEntryVersion

export interface PluginIndex {
  schemaVersion: number
  updatedAt: string
  pubkeyB64: string
  plugins: PluginIndexEntry[]
}

/** check_plugin_updates 命令的返回类型 */
export interface PluginUpdateInfo {
  id: string
  localVersion: string
  remoteVersion: string
  sha256: string
}

/** list_plugin_versions 命令的返回类型 */
export interface PluginVersionInfo {
  version: string
  isActive: boolean
  sizeBytes: number
  installedAt: string
}

// 插件上下文

/** 插件面板组件的 Props */
export interface PluginPanelProps {
  /** 关闭当前插件面板 */
  close: () => void
  /** 当前面板是否活动/可见 */
  isActive: boolean
  /** 插件 ID */
  pluginId: string
  /** 调用该插件的后端命令，命令名相对于插件后端命名空间 */
  invokeBackend: (command: string, args?: Record<string, unknown>) => Promise<unknown>
  /** 插件隔离的持久化键值存储 */
  store: PluginStorage
  /** 宿主事件总线，订阅主题/笔记/语言/设置变更 */
  events: PluginEventBus
  /** 当前活动笔记内容（markdown），无活动笔记时为空 */
  activeNoteContent: string
  /** 当前活动笔记路径，无活动笔记时为空 */
  activeNotePath: string
  /** 读取单个设置值。 */
  getSetting<T = unknown>(key: string): Promise<T | null>
  /** 持久化单个设置键。 */
  setSetting<T = unknown>(key: string, value: T): Promise<void>
  /** 读取所有设置，缺失键回退到 schema 默认值 */
  getAllSettings(): Promise<Record<string, unknown>>
  /** 订阅设置变化。 */
  onSettingsChange(handler: (settings: Record<string, unknown>) => void): () => void
  /** 获取当前笔记的 frontmatter 对象。无活动笔记时返回 null。 */
  getActiveNoteFrontmatter(): Record<string, unknown> | null
  /** 更新当前笔记的 frontmatter，合并传入的数据。无活动笔记时为空操作。 */
  setActiveNoteFrontmatter(data: Partial<NoteFrontmatter>): void
  /** 监听 frontmatter 变更事件。返回取消订阅函数。 */
  onNoteFrontmatterChanged(callback: (data: Record<string, unknown>) => void): () => void
}

/** 自定义工具栏按钮 props。size 为推荐 icon 尺寸。 */
export interface ToolbarButtonProps {
  /** 推荐 icon 尺寸 */
  size: number
  /** 插件面板是否活动 */
  isActive: boolean
  /** 插件 ID */
  pluginId: string
  /** 调用插件后端命令 */
  invokeBackend: (command: string, args?: Record<string, unknown>) => Promise<unknown>
  /** 插件隔离的持久化存储 */
  store: PluginStorage
  /** 宿主事件总线 */
  events: PluginEventBus
  /** 激活插件（按 contentPosition 显示面板） */
  activate: () => void
  /** 停用插件（隐藏面板） */
  deactivate: () => void
  /** 当前活动笔记内容，无活动笔记时为空 */
  activeNoteContent: string
  /** 当前活动笔记路径，无活动笔记时为空 */
  activeNotePath: string
  /** 活动笔记文件名（末段），无活动笔记时为空 */
  activeNoteName: string
  /** 活动笔记扩展名（小写无点），无活动笔记时为空 */
  activeNoteExt: string
  /** 活动笔记是否为 Markdown 文件 */
  isActiveNoteMarkdown: boolean
  /** 读取单个设置键，参见 PluginPanelProps.getSetting */
  getSetting<T = unknown>(key: string): Promise<T | null>
  /** 持久化单个设置键，参见 PluginPanelProps.setSetting */
  setSetting<T = unknown>(key: string, value: T): Promise<void>
  /** 读取所有设置，参见 PluginPanelProps.getAllSettings */
  getAllSettings(): Promise<Record<string, unknown>>
  /** 订阅设置变化，参见 PluginPanelProps.onSettingsChange */
  onSettingsChange(handler: (settings: Record<string, unknown>) => void): () => void
  /** 获取当前笔记的 frontmatter 对象。参见 {@link PluginPanelProps.getActiveNoteFrontmatter}。 */
  getActiveNoteFrontmatter(): Record<string, unknown> | null
  /** 更新当前笔记的 frontmatter。参见 {@link PluginPanelProps.setActiveNoteFrontmatter}。 */
  setActiveNoteFrontmatter(data: Partial<NoteFrontmatter>): void
  /** 监听 frontmatter 变更事件。参见 {@link PluginPanelProps.onNoteFrontmatterChanged}。 */
  onNoteFrontmatterChanged(callback: (data: Record<string, unknown>) => void): () => void
}

// 插件注册表

/** 按 iconPosition 索引的插件注册表 */
export interface PluginRegistry {
  sidebar: PluginDefinition[]
  editorToolbar: PluginDefinition[]
  titleBar: PluginDefinition[]
}

/** 空注册表辅助函数 */
export const emptyRegistry: PluginRegistry = {
  sidebar: [],
  editorToolbar: [],
  titleBar: [],
}

// 右键菜单贡献

/** 插件可贡献右键菜单项的位置 */
export type ContextMenuLocation =
  | 'fileTree'        // 文件树中右键文件/文件夹
  | 'fileTreeEmpty'   // 文件树空白处右键
  | 'editor'          // 编辑器内右键
  | 'tab'             // 右键 tab
  | 'tabBarEmpty'     // tab 栏空白处右键

/** 传给 when 谓词的上下文。 */
export interface ContextMenuContext {
  location: ContextMenuLocation
  /** 光标下的路径（文件树、tab、编辑器） */
  path?: string
  /** 光标是否在目录上 */
  isDirectory?: boolean
  /** 当前活动 tab 的路径 */
  activePath?: string
  /** 编辑器中选中的文本 */
  selection?: string
}

/** 插件贡献的单个菜单项 */
export interface ContextMenuItem {
  /** 稳定 id，用于去重和更新 */
  id: string
  /** 显示标签，未来也用作 i18n key 前缀 */
  label: string
  /** 可选 lucide-react 图标名，由宿主映射 */
  iconName?: string
  /** 出现位置，省略则在所有位置出现 */
  locations?: ContextMenuLocation[]
  /** 谓词，返回 false 隐藏该项。 */
  when?: (ctx: ContextMenuContext) => boolean
  /** 点击处理函数。 */
  onClick: (ctx: ContextMenuContext) => void | Promise<void>
}

/** 按位置索引的菜单项注册表 */
export type ContextMenuRegistry = Record<ContextMenuLocation, ContextMenuItem[]>

// 命令面板贡献

/** 插件贡献的命令条目，id 必须跨重载稳定。 */
export interface PluginCommand {
  /** 稳定 id，用于去重、设置键和更新 */
  id: string
  /** 显示标签，也用作命令面板搜索词 */
  label: string
  /** 可选 lucide-react 图标名，默认 "zap"。 */
  iconName?: string
  /** 可选分类，默认为插件显示名。 */
  category?: string
  /** 可选谓词。 */
  when?: () => boolean
  /** 触发处理函数。 */
  onTrigger: () => void | Promise<void>
}

/** 命令注册表变化监听器。 */
export type PluginCommandsListener = () => void

/** host 端注册表公共接口。 */
export interface PluginCommandRegistry {
  register(pluginId: string, command: PluginCommand): void
  unregister(pluginId: string, commandId: string): void
  clearPlugin(pluginId: string): void
  /** 只读快照，调用方不可修改 */
  list(): PluginCommand[]
  subscribe(listener: PluginCommandsListener): () => void
}

