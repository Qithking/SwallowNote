/** 插件系统类型定义：清单、生命周期 hook、运行时定义、市场索引等。 */

import type { ReactNode, ComponentType } from 'react'

// ─── Enum-like types ───────────────────────────────────────────────────────────

/** Where the plugin icon (trigger) is displayed */
export type IconPosition = 'sidebar' | 'editorToolbar' | 'titleBar'

/** Where the plugin panel (content) is displayed */
export type ContentPosition = 'leftPanel' | 'rightPanel' | 'fullPanel' | 'editorArea'

// ─── Permission types ───────────────────────────────────────────────────────────

/**
 * Plugin permission types. Plugins declare what permissions they need
 * in their manifest, and users grant/revoke them during installation
 * or later in settings.
 */
export type PluginPermission =
  | 'storage'           // Access to persistent storage
  | 'events'            // Subscribe to host events
  | 'context-menu'      // Register context menu items
  | 'backend'           // Access to Rust backend IPC
  | 'filesystem-read'   // Read files from filesystem
  | 'filesystem-write'  // Write files to filesystem
  | 'network'           // Make network requests
  | 'clipboard'         // Access clipboard
  | 'notifications'     // Show notifications
  | 'editor'            // Register a custom file editor (editorFileExtensions)

/**
 * Permission metadata for display in UI
 */
export interface PermissionInfo {
  permission: PluginPermission
  icon?: string
}

/**
 * Permission status for a plugin
 */
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

// ─── Event bus types ───────────────────────────────────────────────────────────

/**
 * Host-emitted events that plugins can subscribe to. Each event has a
 * strongly typed payload so subscribers can read the shape without casting.
 */
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

/** Payload shape for each event. Add a new branch when introducing a new event. */
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

/** Handler signature for an event subscription. */
export type PluginEventHandler<E extends PluginEvent = PluginEvent> = (
  payload: PluginEventPayloadMap[E]
) => void

// ─── Plugin manifest (from index.js) ──────────────────────────────────────────

/**
 * The runtime context provided to lifecycle hooks and stored on the
 * PluginPanelProps. It carries the plugin's identity, its on-disk path,
 * a typed backend call, and a logger.
 */
export interface PluginContext {
  pluginId: string
  pluginPath: string
  invokeBackend: (command: string, args?: Record<string, unknown>) => Promise<unknown>
}

/**
 * A lifecycle hook signature. Hooks can be sync or async; the host awaits
 * async ones and catches any rejection so a buggy plugin never blocks the
 * main thread.
 */
export type PluginLifecycleHook = (context: PluginContext) => void | Promise<void>

/**
 * Persistent storage API for plugins. Backed by a JSON file in
 * `<app_data>/plugins/<pluginId>/storage.json`. The host scopes keys to
 * the plugin id so two plugins cannot collide on `theme`/`view`/etc.
 */
export interface PluginStorage {
  get<T = unknown>(key: string): Promise<T | null>
  set<T = unknown>(key: string, value: T): Promise<void>
  delete(key: string): Promise<void>
  clear(): Promise<void>
  /** List all keys in this plugin's namespace. Useful for debug
   *  tooling and "export all" features. */
  keys(): Promise<string[]>
  /** keys(): 列出键。entries(): 返回 [{key, size}] 按 size 降序。 */
  entries(): Promise<Array<{ key: string; size: number }>>
}

/**
 * Event subscription API exposed on the panel. `on` returns an
 * unsubscribe function so consumers can clean up in a `useEffect`
 * return callback without holding a reference to the bus.
 */
export interface PluginEventBus {
  on<E extends PluginEvent>(event: E, handler: PluginEventHandler<E>): () => void
  off<E extends PluginEvent>(event: E, handler: PluginEventHandler<E>): void
  /** Remove all handlers belonging to a specific plugin (called on uninstall). */
  removeAllListenersForPlugin(pluginId: string): void
}

/** 插件间依赖声明。version 为 npm 风格 semver 范围。 */
export interface PluginDependency {
  /** Unique plugin identifier, e.g. "com.example.other-plugin". */
  id: string
  /** Semver range string. Empty / "*" matches any version. */
  version: string
}

/** 插件 index.js 导出的原始清单。 */
export interface PluginManifest {
  /** Unique plugin identifier (e.g. "com.example.my-plugin") */
  id: string
  /** Display name */
  name: string
  /** Plugin description */
  description?: string
  /** Version string (semver recommended) */
  version?: string
  /** Author name */
  author?: string
  /** ISO-8601 published date */
  publishedAt?: string
  /** Where to show the icon */
  iconPosition: IconPosition
  /** Where to show the panel */
  contentPosition: ContentPosition
  /** Sort order in the icon bar (lower = higher), default 100 */
  order?: number
  /** Whether the plugin is enabled, default true */
  enabled?: boolean
  /**
   * Icon – can be a React component or ReactNode.
   * For component type, it will receive { size?: number } props.
   */
  icon: ComponentType<{ size?: number }> | ReactNode
  /**
   * Panel content – can be a React component or ReactNode.
   * For component type, it will receive PluginContext as props.
   */
  panel: ComponentType<PluginPanelProps> | ReactNode
  /** 可选自定义工具栏按钮组件。 */
  toolbarButton?: ComponentType<ToolbarButtonProps> | ReactNode
  /**
   * Optional settings UI component. Renders inside a modal opened from
   * the plugin manager. Same props as `panel`; use `close` to dismiss.
   */
  settings?: ComponentType<PluginPanelProps> | ReactNode
  /**
   * Optional file extensions (with leading dot, lower-cased, e.g.
   * `['.smm']`) this plugin can render. When the host opens a file
   * whose extension is listed here, it delegates rendering to
   * {@link editorComponent} instead of using the built-in Markdown
   * / code editor. Multiple plugins cannot claim the same extension;
   * the host rejects the second installer with a toast. The plugin
   * must also declare `'editor'` in {@link permissions}.
   */
  editorFileExtensions?: string[]
  /**
   * Optional React component used to render files whose extension
   * matches one of {@link editorFileExtensions}. The host passes
   * `{ content, onChange }`: the plugin reads the initial `content`
   * and pushes the new content back via `onChange` so the host can
   * persist it through the same pipeline as Markdown / code edits.
   */
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
  // ── Lifecycle hooks (all optional) ────────────────────────────────────────
  /** Called once after the plugin module has been loaded. */
  onLoad?: PluginLifecycleHook
  /** Called once before the plugin is unregistered. */
  onUnload?: PluginLifecycleHook
  /** Called once when the plugin transitions to enabled. */
  onEnable?: PluginLifecycleHook
  /** Called once when the plugin transitions to disabled. */
  onDisable?: PluginLifecycleHook
  /** Called each time the panel component is mounted. */
  onMount?: PluginLifecycleHook
  /** Called each time the panel component is unmounted. */
  onUnmount?: PluginLifecycleHook
  /** Called when the panel becomes the active/visible one. */
  onActivate?: PluginLifecycleHook
  /** Called when the panel stops being the active/visible one. */
  onDeactivate?: PluginLifecycleHook
}

// ─── Runtime plugin definition (stored in plugin store) ────────────────────────

/**
 * The runtime representation stored in the plugin store.
 * This is the "hydrated" version where icon/panel are guaranteed to be usable.
 */
export interface PluginDefinition {
  id: string
  name: string
  description: string
  version: string
  author: string
  publishedAt: string
  iconPosition: IconPosition
  contentPosition: ContentPosition
  order: number
  enabled: boolean
  /** Resolved icon component or ReactNode */
  icon: ComponentType<{ size?: number }> | ReactNode
  /** Resolved panel component or ReactNode */
  panel: ComponentType<PluginPanelProps> | ReactNode
  /**
   * Optional custom toolbar button component. When provided, the host
   * renders this component instead of the default icon + button pattern.
   * The component receives ToolbarButtonProps and can implement custom
   * interactions (dropdown menus, direct actions, etc.).
   */
  toolbarButton?: ComponentType<ToolbarButtonProps> | ReactNode
  /** 可选设置 UI 组件。 */
  settings?: ComponentType<PluginPanelProps> | ReactNode
  /** File extensions (with leading dot, lower-cased) the plugin can
   *  render. Mirrors {@link PluginManifest.editorFileExtensions};
   *  the host uses the runtime value when wiring up file-open
   *  dispatch. */
  editorFileExtensions?: string[]
  /** Editor component the host mounts for files whose extension
   *  matches one of {@link editorFileExtensions}. Mirrors
   *  {@link PluginManifest.editorComponent}. */
  editorComponent?: ComponentType<{
    content: string
    onChange: (content: string) => void
  }> | ReactNode
  /** Absolute path to the plugin package directory on disk */
  pluginPath: string
  /** Whether the plugin has a Rust backend */
  hasBackend: boolean
  /**
   * Whether the plugin ships a `settings.json` schema. When true,
   * the card shows the schema-driven settings button next to the
   * plugin-built-in `settings` component button.
   */
  hasSettingsSchema?: boolean
  /** Permissions declared by the plugin. These are requested during installation. */
  permissions: PluginPermission[]
  /** Plugin-to-plugin dependencies, normalised from the manifest
   *  (or merged from the marketplace index entry's `dependencies`
   *  string list). Consumed by `resolveDependencies` at install time
   *  to block installs that would otherwise crash on a missing
   *  peer plugin. See `src/lib/plugin-dependencies.ts`. */
  dependencies?: PluginDependency[]
  /** Command palette ids contributed by this plugin. Carried
   *  over from the manifest; consumed by `detectPluginConflicts`
   *  (Task 13 / G13) to flag two plugins fighting over the same
   *  palette id. Omitted when the plugin doesn't speak to the
   *  command palette. */
  commandPalette?: string[]
  /**
   * Mirror of the user-managed "auto-update" opt-in (Task 11 /
   * G11). The store keeps the authoritative value (persisted to
   * localStorage) but copies it onto the runtime definition so
   * the installed-card toggle can render synchronously without
   * re-querying the store on every keystroke. A plugin whose
   * store record is missing or `false` reads as `false` here as
   * well — the flag is opt-in, never opt-out by default.
   */
  autoUpdate?: boolean
  /** Lifecycle hooks carried over from the original manifest. The store
   *  invokes these at register / unregister / enable / disable. All are
   *  optional; missing hooks are simply skipped. */
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

// ─── Plugin metadata (stored / returned by Rust backend) ──────────────────────

/**
 * Metadata about a plugin that the Rust backend knows about.
 * This is what Rust returns when scanning the plugins directory.
 * It does NOT contain icon/panel (those are JS-only).
 */
export interface PluginMetadata {
  id: string
  name: string
  description: string
  version: string
  author: string
  publishedAt: string
  iconPosition: IconPosition
  contentPosition: ContentPosition
  order: number
  enabled: boolean
  /** Absolute path to the plugin package directory */
  pluginPath: string
  /** Whether a backend/ directory exists */
  hasBackend: boolean
}

// ─── Plugin load failures (per-plugin bypass) ───────────────────────────────

/** 单个加载失败的插件记录。 */
export interface PluginLoadFailure {
  /** Plugin id (from Rust metadata, since the manifest may be unreadable). */
  id: string
  /** Display name (from Rust metadata fallback). */
  name: string
  /** Human-readable reason for the failure. */
  reason: string
  /** Unix epoch milliseconds when the failure was recorded. */
  ts: number
  /** Absolute on-disk path of the plugin package, for diagnostics. */
  pluginPath: string
}

// ─── Plugin load result (loader → caller) ───────────────────────────────────

/** loadAllPlugins 的结果。 */
export interface PluginLoadResult {
  plugins: PluginDefinition[]
  failures: PluginLoadFailure[]
}

// ─── Plugin marketplace / Phase 9.2 ───────────────────────────────────────────

/**
 * One row in a remote plugin repository index. Shape mirrors
 * `src-tauri/src/commands/plugin.rs::PluginIndexEntry`. See
 * `docs/plugin-marketplace/README.md` for the protocol spec.
 */
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
  /** Override the repo-level key (optional). */
  pubkeyB64: string
  /** 最新版本的可选 changelog。 */
  changelog?: string
  /** Optional ISO-8601 release timestamp for the latest version. */
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
  /**
   * Optional per-version pubkey override. Falls back to
   * `PluginIndexEntry.pubkeyB64`, then `PluginIndex.pubkeyB64`,
   * via `effectivePubkey` at the install call site.
   */
  pubkeyB64?: string
  changelog: string
  publishedAt: string
}

/**
 * Alias kept for the marketplace detail UI / Task 5 spec; the
 * canonical name in the wire format is `PluginIndexEntryVersion`.
 * Both refer to the same per-version record carried in the
 * `versions` array of a `PluginIndexEntry`.
 */
export type PluginIndexVersion = PluginIndexEntryVersion

export interface PluginIndex {
  schemaVersion: number
  updatedAt: string
  pubkeyB64: string
  plugins: PluginIndexEntry[]
}

/** Returned by the `check_plugin_updates` Tauri command. */
export interface PluginUpdateInfo {
  id: string
  localVersion: string
  remoteVersion: string
  sha256: string
}

/** Returned by the `list_plugin_versions` Tauri command. */
export interface PluginVersionInfo {
  version: string
  isActive: boolean
  sizeBytes: number
  installedAt: string
}

// ─── Plugin context ───────────────────────────────────────────────────────────

/** Props passed to plugin panel components */
export interface PluginPanelProps {
  /** Close the current plugin panel */
  close: () => void
  /** Whether this plugin panel is currently active/visible */
  isActive: boolean
  /** Plugin ID */
  pluginId: string
  /**
   * Call a backend command provided by this plugin.
   * The command name is relative to the plugin's backend namespace.
   */
  invokeBackend: (command: string, args?: Record<string, unknown>) => Promise<unknown>
  /** Persistent key/value store scoped to this plugin. */
  store: PluginStorage
  /** Host event bus. Subscribe to theme / note / locale / settings changes. */
  events: PluginEventBus
  /** Current active note content (markdown string). Empty string if no note is active. */
  activeNoteContent: string
  /** Current active note file path. Empty string if no note is active. */
  activeNotePath: string
  /** 读取单个设置值。 */
  getSetting<T = unknown>(key: string): Promise<T | null>
  /** 持久化单个设置键。 */
  setSetting<T = unknown>(key: string, value: T): Promise<void>
  /**
   * Read every stored setting for this plugin. Useful for seeding
   * local state on mount. Returns the stored values map, falling
   * back to schema defaults for missing keys.
   */
  getAllSettings(): Promise<Record<string, unknown>>
  /** 订阅设置变化。 */
  onSettingsChange(handler: (settings: Record<string, unknown>) => void): () => void
}

/** 自定义工具栏按钮 props。size 为推荐 icon 尺寸。 */
export interface ToolbarButtonProps {
  /** Recommended icon size for the current toolbar context */
  size: number
  /** Whether this plugin's panel is currently active */
  isActive: boolean
  /** Plugin ID */
  pluginId: string
  /** Invoke the plugin's backend command */
  invokeBackend: (command: string, args?: Record<string, unknown>) => Promise<unknown>
  /** Persistent key/value store scoped to this plugin */
  store: PluginStorage
  /** Host event bus */
  events: PluginEventBus
  /** Activate the plugin (show panel based on contentPosition) */
  activate: () => void
  /** Deactivate the plugin (hide panel) */
  deactivate: () => void
  /** Current active note content (markdown string). Empty string if no note is active. */
  activeNoteContent: string
  /** Current active note file path. Empty string if no note is active. */
  activeNotePath: string
  /**
   * Current active note file name (last path segment, e.g.
   * `note.md`). Empty string when no note is active. Plugins use
   * this for UI hints without re-parsing `activeNotePath`.
   */
  activeNoteName: string
  /**
   * Lower-cased file extension of the active note (without the
   * leading dot, e.g. `"md"`, `"markdown"`, `"json"`). Empty string
   * when no note is active or the file has no extension. Plugins
   * gate behaviour on this value (or `isActiveNoteMarkdown`) instead
   * of re-deriving a regex from the path.
   */
  activeNoteExt: string
  /**
   * `true` when the host has detected that the active note is a
   * Markdown file (i.e. `activeNoteExt` is `md` or `markdown`).
   * Plugins that only make sense for Markdown use this to disable
   * their toolbar button (set `aria-disabled`, skip the click
   * handler) instead of relying on the host to hide the icon.
   */
  isActiveNoteMarkdown: boolean
  /** Read a single setting key. See {@link PluginPanelProps.getSetting}. */
  getSetting<T = unknown>(key: string): Promise<T | null>
  /** Persist a single setting key. See {@link PluginPanelProps.setSetting}. */
  setSetting<T = unknown>(key: string, value: T): Promise<void>
  /** Read every stored setting. See {@link PluginPanelProps.getAllSettings}. */
  getAllSettings(): Promise<Record<string, unknown>>
  /** Subscribe to settings changes. See {@link PluginPanelProps.onSettingsChange}. */
  onSettingsChange(handler: (settings: Record<string, unknown>) => void): () => void
}

// ─── Plugin registry ──────────────────────────────────────────────────────────

/** Registry that indexes plugins by iconPosition for efficient lookup */
export interface PluginRegistry {
  sidebar: PluginDefinition[]
  editorToolbar: PluginDefinition[]
  titleBar: PluginDefinition[]
}

/** Empty registry helper */
export const emptyRegistry: PluginRegistry = {
  sidebar: [],
  editorToolbar: [],
  titleBar: [],
}

// ─── Context menu contributions ────────────────────────────────────────────────

/** Surface where a plugin can contribute a context menu item. */
export type ContextMenuLocation =
  | 'fileTree'        // Right-click on a file/folder in the explorer
  | 'fileTreeEmpty'   // Right-click on the empty area below files
  | 'editor'          // Right-click inside an open editor
  | 'tab'             // Right-click on a tab
  | 'tabBarEmpty'     // Right-click on the tab bar's empty area

/** 传给 when 谓词的上下文。 */
export interface ContextMenuContext {
  location: ContextMenuLocation
  /** Path under the cursor, if any (file tree, tab, editor). */
  path?: string
  /** Whether the cursor is on a directory. */
  isDirectory?: boolean
  /** The currently active tab's path, if any. */
  activePath?: string
  /** Selected text in the editor, if any. */
  selection?: string
}

/** A single menu entry contributed by a plugin. */
export interface ContextMenuItem {
  /** Stable id; required for deduping and updates. */
  id: string
  /** Display label, also used as i18n key prefix in the future. */
  label: string
  /** Optional lucide-react icon name, mapped by the host. */
  iconName?: string
  /** Locations this item should appear in. Omit to appear in all. */
  locations?: ContextMenuLocation[]
  /** 谓词，返回 false 隐藏该项。 */
  when?: (ctx: ContextMenuContext) => boolean
  /** 点击处理函数。 */
  onClick: (ctx: ContextMenuContext) => void | Promise<void>
}

/** Registry of menu items by location, indexed for O(1) lookup. */
export type ContextMenuRegistry = Record<ContextMenuLocation, ContextMenuItem[]>

// ─── Command palette contributions ─────────────────────────────────────────────

/** 插件贡献的命令条目，id 必须跨重载稳定。 */
export interface PluginCommand {
  /** Stable id; required for deduping, settings keying, and updates. */
  id: string
  /** Display label, also used as the search term in the command palette. */
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
  /** Read-only snapshot. Callers must not mutate the array. */
  list(): PluginCommand[]
  subscribe(listener: PluginCommandsListener): () => void
}

