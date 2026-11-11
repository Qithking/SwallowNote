/** 插件系统类型定义：清单、生命周期 hook、运行时定义、市场索引等。 */
// B7 类型单源：清单/权限/事件/上下文等宿主与插件共享的类型一律从
// @swallow-note/plugin-sdk re-export，宿主侧不再手工双写（防类型漂移）。

import type { ReactNode, ComponentType } from 'react'
import type { NoteFrontmatter } from '@/lib/types/frontmatter'
import type {
  IconPosition,
  ContentPosition,
  ContextMenuLocation,
  PluginPermission,
  PluginEvent,
  PluginEventPayloadMap,
  PluginEventHandler,
  PluginLogger,
  PluginContext,
  PluginLifecycleHook,
  PluginStorage,
  PluginEventBus,
  PluginDependency,
  PluginManifest,
  InvokeBackendStreamOptions,
} from '@swallow-note/plugin-sdk'

// 单源 re-export：宿主侧直接引用 SDK 类型（B7 防手工双写漂移）
export type {
  IconPosition,
  ContentPosition,
  ContextMenuLocation,
  PluginPermission,
  PluginEvent,
  PluginEventPayloadMap,
  PluginEventHandler,
  PluginLogger,
  PluginContext,
  PluginLifecycleHook,
  PluginStorage,
  PluginEventBus,
  PluginDependency,
  PluginManifest,
  InvokeBackendStreamOptions,
}

// 权限类型（宿主 UI 元数据，运行时部分）

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
  { permission: 'editor-write' },
  { permission: 'files' },
  { permission: 'secure-storage' },
]

// 插件清单（来自 index.js）：PluginManifest / PluginContext 等已由 SDK re-export（B7 单源）

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
  /** 插件要求的最低宿主版本；缺失/空 = 无要求。 */
  minHostVersion?: string
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

/** 编辑器选区查询结果：text 为选中文本，lineRange 为 1-based 起止行号（含端点） */
export interface PluginEditorSelection {
  text: string
  lineRange: [number, number]
}

/** 编辑器写 API（P1.2）：插件向当前编辑器写入内容，要求 editor-write 权限 */
export interface PluginEditorApi {
  /** 在当前光标处插入 markdown 文本；返回是否写入成功（编辑器未挂载/解析失败为 false） */
  insertAtCursor(text: string): Promise<boolean>
  /** 替换当前选区；无选区时拒绝并返回 false（绝不整文替换） */
  replaceSelection(text: string): Promise<boolean>
  /** 整文替换当前笔记内容 */
  replaceContent(text: string): Promise<void>
  /** 查询当前选区；无选区/编辑器未挂载返回 null（P1.3，要求 editor-write 权限） */
  getSelection(): Promise<PluginEditorSelection | null>
  /** 读取当前文件全文（P2.5，要求 editor-write 权限）；编辑器未挂载/超时返回 null */
  getActiveContent(): Promise<string | null>
}

/** 工作区文件 API（P1.2）：受限的文件系统访问，要求 files 权限，路径严格限定在工作区根内 */
export interface PluginFilesApi {
  /** 在工作区内创建笔记（相对路径）；已存在时抛错，缺失父目录自动创建 */
  createNote(relPath: string, content: string): Promise<void>
  /** 递归列出工作区内 Markdown 文件（正斜杠相对路径）；query 大小写不敏感子串过滤 */
  listWorkspace(query?: string): Promise<string[]>
  /** 按工作区相对路径读取文本文件内容（UTF-8），超长截断并附加标记 */
  read(relPath: string): Promise<string>
}

/**
 * 安全存储 API（P1.5 / ADR-0003）：AES-256-GCM 加密落盘的按插件隔离键值存储，
 * 要求 secure-storage 权限。值为 string（API 密钥语义，结构化数据请自行序列化）。
 * 威胁模型：防磁盘明文泄露，不防同 webview 内插件互读；换机器后旧密文不可解，
 * get 会抛错（区别于「未存储」返回 null）。
 */
export interface PluginSecureStorage {
  /** 读取并解密；未存储返回 null，密文不可解（换机/损坏）时抛错 */
  get(key: string): Promise<string | null>
  /** 加密写入，同 key 覆盖 */
  set(key: string, value: string): Promise<void>
  /** 删除单个键，幂等 */
  delete(key: string): Promise<void>
  /** 列出该插件全部键名（不含值），按字典序 */
  keys(): Promise<string[]>
}

/**
 * 面板一次性请求（P1.4）：宿主 openPluginPanel 写入 UIStore，面板挂载
 * 消费（props 送达）后由宿主清空；payload 类型由插件自定义（宿主不解析）。
 */
export interface PluginPanelRequest {
  /** 请求目标插件的 ID */
  pluginId: string
  /** 打开面板时携带的负载，结构由插件自定义 */
  payload: unknown
}

/** 插件面板组件的 Props */
export interface PluginPanelProps {
  /** 关闭当前插件面板 */
  close: () => void
  /** 当前面板是否活动/可见 */
  isActive: boolean
  /** 插件 ID */
  pluginId: string
  /**
   * 面板打开请求携带的一次性 payload（P1.4 openPluginPanel 写入）。
   * 仅当 pendingPluginRequest 归属本插件时透出，否则为 null；
   * 面板挂载后宿主自动清空，下次打开不再重复收到。
   */
  pendingRequest: unknown
  /** 调用该插件的后端命令，命令名相对于插件后端命名空间；T 为后端返回的 payload 类型 */
  invokeBackend<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T>
  /** 调用插件后端流式命令：onChunk 逐块回调增量，Promise 以最终响应帧结果终结 */
  invokeBackendStream: <T = unknown, R = unknown>(
    command: string,
    args: Record<string, unknown> | undefined,
    onChunk: (chunk: T) => void,
    options?: InvokeBackendStreamOptions
  ) => Promise<R>
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
  /** 编辑器写 API（要求 editor-write 权限），参见 {@link PluginEditorApi} */
  editor: PluginEditorApi
  /** 工作区文件 API（要求 files 权限），参见 {@link PluginFilesApi} */
  files: PluginFilesApi
  /** 安全存储 API（要求 secure-storage 权限），参见 {@link PluginSecureStorage} */
  secureStorage: PluginSecureStorage
}

/** 自定义工具栏按钮 props。size 为推荐 icon 尺寸。 */
export interface ToolbarButtonProps {
  /** 推荐 icon 尺寸 */
  size: number
  /** 插件面板是否活动 */
  isActive: boolean
  /** 插件 ID */
  pluginId: string
  /** 调用插件后端命令；T 为后端返回的 payload 类型 */
  invokeBackend<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T>
  /** 调用插件后端流式命令，参见 {@link PluginPanelProps.invokeBackendStream} */
  invokeBackendStream: <T = unknown, R = unknown>(
    command: string,
    args: Record<string, unknown> | undefined,
    onChunk: (chunk: T) => void,
    options?: InvokeBackendStreamOptions
  ) => Promise<R>
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
  /** 编辑器写 API（要求 editor-write 权限），参见 {@link PluginPanelProps.editor} */
  editor: PluginEditorApi
  /** 工作区文件 API（要求 files 权限），参见 {@link PluginPanelProps.files} */
  files: PluginFilesApi
  /** 安全存储 API（要求 secure-storage 权限），参见 {@link PluginSecureStorage} */
  secureStorage: PluginSecureStorage
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

// 插件可贡献右键菜单项的位置：ContextMenuLocation 已由 SDK re-export（B7 单源）

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

