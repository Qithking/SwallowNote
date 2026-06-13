/**
 * Plugin System Type Definitions
 *
 * Plugin manifest fields:
 * - name:         Plugin display name
 * - icon:         ReactNode for the trigger icon
 * - panel:        ReactNode for the panel content
 * - iconPosition: Where the icon appears (sidebar / editorToolbar / titleBar)
 * - contentPosition: Where the panel appears (leftPanel / rightPanel / fullPanel / editorArea)
 * - publishedAt:  Release date (ISO string)
 * - description:  Plugin description
 *
 * Lifecycle hooks (all optional, all receive a PluginContext):
 * - onLoad:        Called once after the plugin module has been loaded
 * - onUnload:      Called once before the plugin is unregistered
 * - onEnable:      Called once when the plugin transitions to enabled
 * - onDisable:     Called once when the plugin transitions to disabled
 * - onMount:       Called each time the panel component is mounted
 * - onUnmount:     Called each time the panel component is unmounted
 * - onActivate:    Called when the panel becomes the active/visible one
 * - onDeactivate:  Called when the panel stops being the active/visible one
 *
 * Plugin package structure:
 *   <plugin-id>/
 *     index.js    - Plugin entry, exports manifest + React components
 *     backend/    - Optional Rust backend (compiled .so/.dylib/.dll)
 */

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

/**
 * Permission metadata for display in UI
 */
export interface PermissionInfo {
  permission: PluginPermission
  name: string
  description: string
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

/** Permission descriptions for UI */
export const PLUGIN_PERMISSIONS: PermissionInfo[] = [
  {
    permission: 'storage',
    name: 'Storage',
    description: 'Access persistent storage for saving plugin data',
  },
  {
    permission: 'events',
    name: 'Events',
    description: 'Subscribe to host events (note open/save, theme change, etc.)',
  },
  {
    permission: 'context-menu',
    name: 'Context Menu',
    description: 'Add items to right-click menus',
  },
  {
    permission: 'backend',
    name: 'Backend',
    description: 'Communicate with native Rust backend',
  },
  {
    permission: 'filesystem-read',
    name: 'Filesystem Read',
    description: 'Read files from your system',
  },
  {
    permission: 'filesystem-write',
    name: 'Filesystem Write',
    description: 'Write files to your system',
  },
  {
    permission: 'network',
    name: 'Network',
    description: 'Make network requests',
  },
  {
    permission: 'clipboard',
    name: 'Clipboard',
    description: 'Read from and write to clipboard',
  },
  {
    permission: 'notifications',
    name: 'Notifications',
    description: 'Show desktop notifications',
  },
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

/**
 * The raw manifest exported by a plugin's index.js.
 *
 * icon and panel can be either:
 * - A React component (ComponentType) – will be rendered with <Icon /> / <Panel />
 * - A ReactNode directly – will be rendered as-is
 *
 * Because we cannot serialize ReactNode across the Rust bridge, the Rust side
 * only stores the metadata (name, description, …). The actual icon/panel
 * components are loaded at the JS layer via dynamic import.
 */
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
  /**
   * Optional custom toolbar button component. When provided, the host
   * renders this component instead of the default icon + button pattern.
   * The component receives ToolbarButtonProps and can implement custom
   * interactions (dropdown menus, direct actions, etc.).
   * If omitted, the host renders the `icon` inside a standard button
   * that toggles the panel on click.
   */
  toolbarButton?: ComponentType<ToolbarButtonProps> | ReactNode
  /**
   * Optional settings UI component. Renders inside a modal opened from
   * the plugin manager. Same props as `panel`; use `close` to dismiss.
   */
  settings?: ComponentType<PluginPanelProps> | ReactNode
  /**
   * Permissions required by the plugin. Declare what access the plugin needs
   * (storage, events, context-menu, backend, filesystem, network, etc.).
   * Users will be asked to grant these permissions during installation.
   */
  permissions?: PluginPermission[]
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
  /**
   * Optional settings UI component. Rendered in a modal opened from
   * the plugin manager. Receives the same `PluginPanelProps` as the
   * main panel so it has access to `store`, `events`, `close`, etc.
   * Settings dialogs should call `close` from props to dismiss
   * themselves.
   */
  settings?: ComponentType<PluginPanelProps> | ReactNode
  /** Absolute path to the plugin package directory on disk */
  pluginPath: string
  /** Whether the plugin has a Rust backend */
  hasBackend: boolean
  /** Permissions declared by the plugin. These are requested during installation. */
  permissions: PluginPermission[]
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

// ─── Plugin Marketplace / Phase 9.2 ───────────────────────────────────────────

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
  versions: PluginIndexEntryVersion[]
  dependencies: string[]
}

export interface PluginIndexEntryVersion {
  version: string
  downloadUrl: string
  sha256: string
  changelog: string
  publishedAt: string
}

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
}

/**
 * Props for a plugin's custom toolbar button component.
 *
 * When a plugin provides `toolbarButton` in its manifest, the host renders
 * this component instead of the default icon + button. This allows plugins
 * to implement custom interactions such as dropdown menus, direct actions,
 * or any other toolbar-level UI.
 *
 * The `size` prop indicates the recommended icon size for the current
 * toolbar context (14px for editorToolbar/titleBar, 18px for sidebar).
 * Plugins should respect this size for visual consistency but can render
 * larger UI elements (e.g. dropdown menus) that extend beyond the button.
 */
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

/**
 * Context passed to a menu item's `when` predicate. The host fills in
 * the current state of the surface (selected file, active tab, etc.)
 * so plugins can decide whether to show their entry without
 * re-querying stores.
 */
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
  /**
   * Predicate. Return false to hide the item. Use this to disable
   * items that don't make sense for the current selection (e.g. a
   * "Decode image" entry should hide on a non-image file).
   * The default (no `when`) is "always show".
   */
  when?: (ctx: ContextMenuContext) => boolean
  /**
   * Click handler. Receives the resolved `ContextMenuContext` so
   * plugins don't need to thread the surface state through their
   * own module-scope variables.
   */
  onClick: (ctx: ContextMenuContext) => void | Promise<void>
}

/** Registry of menu items by location, indexed for O(1) lookup. */
export type ContextMenuRegistry = Record<ContextMenuLocation, ContextMenuItem[]>

