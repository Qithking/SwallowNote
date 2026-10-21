/**
 * Plugin utility functions
 */
import { type ComponentType, type ReactNode } from 'react'
import type { SidebarView, RightPanelType } from '@/stores'
import type {
  ContentPosition,
  PluginPanelProps,
  PluginPanelRequest,
  ToolbarButtonProps,
} from '@/types/plugin'
import type { NoteFrontmatter } from '@/lib/types/frontmatter'
import { useUIStore, usePluginStore } from '@/stores'
import { getPluginStorage, createPluginEventBus } from './plugin-host'
import { assertPermission, hasPermission } from './plugin-permission-guard'
import { invokePluginBackendStream } from './plugin-stream'
import { loadSettings, readSetting } from './plugin-settings'
import {
  writePluginSettings,
  readSecureStorage,
  writeSecureStorage,
  deleteSecureStorage,
  listSecureStorageKeys,
} from './tauri'
import { logger } from './logger'
import {
  pluginEditorInsertAtCursor,
  pluginEditorGetSelection,
  pluginEditorReplaceSelection,
  pluginEditorReplaceContent,
  pluginFilesCreateNote,
  pluginFilesListWorkspace,
} from './plugin-write-api'
import { emitPluginSettingsChanged } from '@swallow-note/plugin-sdk'
import { useEditorStore } from '@/stores/editor'

/**
 * Detect whether `value` is a React component-like (function/class component,
 * or wrapped in forwardRef / memo). This is more thorough than
 * `typeof === 'function'` which misses `forwardRef` and `memo` wrappers —
 * those are objects with a `$$typeof` symbol, not callable directly.
 */
function isComponentLike(value: unknown): value is ComponentType<{ size?: number }> {
  if (value == null) return false
  if (typeof value === 'function') return true
  if (typeof value === 'object') {
    const t = (value as { $$typeof?: symbol }).$$typeof
    // Symbol.for names are stable across realms, but the React team's
    // official exports use these named descriptions in @types/react.
    // We check the description rather than identity to be safe.
    if (typeof t === 'symbol') {
      const desc = t.description
      if (
        desc === 'react.forward_ref' ||
        desc === 'react.memo' ||
        desc === 'react.lazy' ||
        desc === 'react.context'
      ) {
        return true
      }
    }
  }
  return false
}

// ─── View ID helpers ──────────────────────────────────────────────────────────

/**
 * Generate a SidebarView value for a plugin.
 * Used by left-panel and full-panel plugins.
 */
export function pluginSidebarView(pluginId: string): SidebarView {
  return `plugin:${pluginId}` as SidebarView
}

/**
 * Generate a RightPanelType value for a plugin.
 * Used by right-panel plugins.
 */
export function pluginRightPanelType(pluginId: string): RightPanelType {
  return `plugin:${pluginId}` as RightPanelType
}

// ─── Panel request pipeline (P1.4) ───────────────────────────────────────────

/**
 * 预热插件后端进程：调用 Rust `prewarm_plugin`（仅拉起进程，不发送 JSON-RPC
 * 请求）。失败静默——面板打开不因预热受阻，首次 invoke 会自然兜底拉起。
 */
async function prewarmPluginBackend(pluginId: string): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('prewarm_plugin', { pluginId })
  } catch (err) {
    logger.debug('plugin-utils', `prewarm_plugin failed (pluginId=${pluginId})`, err)
  }
}

/**
 * 打开插件右侧面板（P1.4 面板请求管道入口）。
 *
 * ① 写入 `rightPanelType('plugin:<id>')` 并激活插件；② payload 存入
 * UIStore `pendingPluginRequest` 供面板 props `pendingRequest` 一次性消费
 * （面板挂载后宿主自动清空，连续触发以最新覆盖；无 payload 时清空残留）；
 * ③ 拥有 backend 权限的插件同时预热后端进程，消除首请求冷启动延迟。
 */
export function openPluginPanel(pluginId: string, payload?: unknown): void {
  useUIStore.getState().setRightPanelType(pluginRightPanelType(pluginId))
  usePluginStore.getState().setActivePlugin(pluginId, 'rightPanel')
  useUIStore
    .getState()
    .setPendingPluginRequest(payload === undefined ? null : { pluginId, payload })
  if (hasPermission(pluginId, 'backend')) {
    void prewarmPluginBackend(pluginId)
  }
}

/**
 * Check if a SidebarView is a plugin view
 */
export function isPluginSidebarView(view: SidebarView): view is `plugin:${string}` {
  return view.startsWith('plugin:')
}

/**
 * Check if a RightPanelType is a plugin panel
 */
export function isPluginRightPanelType(type: RightPanelType): type is `plugin:${string}` {
  return type !== null && type.startsWith('plugin:')
}

/**
 * Extract plugin id from a SidebarView or RightPanelType
 */
export function extractPluginId(value: string): string {
  return value.replace('plugin:', '')
}

// ─── Content position → sidebar view / right panel type mapping ────────────────

/**
 * Determine if a content position uses the sidebar view system
 * (leftPanel, fullPanel) vs the right panel system (rightPanel)
 */
export function contentPositionUsesSidebar(pos: ContentPosition): boolean {
  return pos === 'leftPanel' || pos === 'fullPanel'
}

export function contentPositionUsesRightPanel(pos: ContentPosition): boolean {
  return pos === 'rightPanel'
}

export function contentPositionUsesEditorArea(pos: ContentPosition): boolean {
  return pos === 'editorArea'
}

/**
 * Check if a full-panel plugin is currently active.
 * Full-panel plugins occupy the same space as the settings view
 * (sidebar + editor area).
 */
export function isFullPanelPluginActive(
  settingsPanelVisible: boolean,
  sidebarView: SidebarView,
  pluginId: string
): boolean {
  return settingsPanelVisible && sidebarView === pluginSidebarView(pluginId)
}

// ─── Icon / Panel rendering helpers ───────────────────────────────────────────

/**
 * Render a plugin's icon. Handles both ComponentType and ReactNode.
 *
 * Returns `null` when the icon is `undefined` so the caller can
 * safely invoke the helper on a headless plugin (one that
 * doesn't declare a UI surface) without a type guard. This is
 * what lets a file-format editor (e.g. the `mindmap` plugin)
 * slip through `buildRegistry` / `getActivePluginExtensions`
 * paths without crashing the title bar / activity bar
 * rendering.
 */
export function renderPluginIcon(
  icon: ComponentType<{ size?: number }> | ReactNode | undefined,
  size: number = 18
): ReactNode {
  // Use isComponentLike to correctly identify component-like values,
  // including those wrapped in forwardRef / memo. A bare
  // `typeof === 'function'` check would miss those wrappers and try to
  // render them as a function rather than a component.
  if (icon == null) return null
  if (isComponentLike(icon)) {
    const IconComponent = icon as ComponentType<{ size?: number }>
    return <IconComponent size={size} />
  }
  // It's already a ReactNode
  return icon as ReactNode
}

/**
 * Create PluginPanelProps for a plugin panel component.
 */
export function createPluginPanelProps(
  pluginId: string,
  isActive: boolean,
  close: () => void,
  activeNoteContent: string = '',
  activeNotePath: string = '',
  // 一次性请求状态（P1.4）：由已订阅 UIStore 的调用方显式传入，面板已挂载时
  // 连续 openPluginPanel 也能随重渲染送达；缺省回退 store 快照（未订阅调用点的原有行为）。
  pendingRequestState: PluginPanelRequest | null = useUIStore.getState().pendingPluginRequest,
): PluginPanelProps {
  // Import lazily to avoid pulling the Tauri-side bridge into the
  // bundle for non-Tauri code paths (tests, Storybook).
  return {
    pluginId,
    isActive,
    close,
    // 一次性请求管道（P1.4）：仅当请求归属本插件时透出 payload，
    // 面板挂载后由 PluginPanelHost 清空宿主状态，下次打开不再重复收到。
    pendingRequest:
      pendingRequestState && pendingRequestState.pluginId === pluginId
        ? pendingRequestState.payload
        : null,
    // The Rust host spawns a per-plugin backend subprocess on the
    // first call and keeps it alive for subsequent calls. Wire
    // protocol: line-delimited JSON-RPC 2.0 over stdin/stdout. See
    // `src-tauri/src/commands/plugin_invoke.rs` for the host side and
    // `docs/plugin-system/backend.md` for plugin author guidance. If
    // the plugin has no `backend/` directory, the host returns
    // "plugin backend not found" which the panel can catch and treat
    // as a graceful-degradation path (e.g. show "backend unavailable"
    // UI) rather than crashing.
    invokeBackend: async (command: string, args?: Record<string, unknown>) => {
      // Backend IPC is opt-in. The Rust host would happily spawn a
      // subprocess for any plugin that calls this, but we cut the
      // call short here so a plugin without the `backend` grant
      // gets a synchronous-style error rather than a confusing
      // "plugin backend not found" deep in the host.
      assertPermission(pluginId, 'backend', `invoke backend command "${command}"`)
      const { invoke } = await import('@tauri-apps/api/core')
      const start = performance.now()
      let success = true
      let errorMsg: string | undefined
      try {
        return await invoke('invoke_plugin', { pluginId, command, args })
      } catch (err) {
        success = false
        errorMsg = String(err)
        throw err
      } finally {
        // Record backend metrics for the diagnostics panel. Lazy-import
        // the telemetry module so this file stays free of a hard
        // dependency on it (telemetry has no other importers).
        const durationMs = performance.now() - start
        void import('./plugin-telemetry').then(({ recordBackendMetric }) => {
          recordBackendMetric(pluginId, command, durationMs, success, errorMsg)
        })
      }
    },
    // 流式调用：权限检查与遥测已内聚在共享桥接函数中。
    invokeBackendStream: <T = unknown, R = unknown>(
      command: string,
      args: Record<string, unknown> | undefined,
      onChunk: (chunk: T) => void,
      options?: { firstChunkTimeoutSecs?: number }
    ): Promise<R> =>
      invokePluginBackendStream<T, R>(pluginId, command, args, onChunk, options),
    // Per-plugin persistent storage. `getPluginStorage` already caches
    // one PluginStorage per pluginId internally, so no extra cache is
    // needed here. `dropPluginStorage` (called on plugin unload)
    // invalidates the underlying entry.
    store: getPluginStorage(pluginId),
    // Global event bus. The same bus instance is shared by every panel
    // and lifecycle hook, so two plugins can subscribe to the same
    // event without coordinating.
    events: createPluginEventBus(pluginId),
    activeNoteContent,
    activeNotePath,
    // Schema-driven settings bridge. The host reads/writes through
    // the per-plugin SQLite table and emits `plugin-settings:change`
    // for every successful write; subscribers on the same plugin
    // id pick up the new map regardless of which instance wrote.
    getSetting: async <T = unknown>(key: string): Promise<T | null> => {
      assertPermission(pluginId, 'storage', `read plugin setting "${key}"`)
      const view = await loadSettings(pluginId, true)
      return readSetting(view, key) as T | null
    },
    setSetting: async <T = unknown>(key: string, value: T): Promise<void> => {
      assertPermission(pluginId, 'storage', `write plugin setting "${key}"`)
      const view = await loadSettings(pluginId, true)
      const next = { ...view.values, [key]: value }
      await writePluginSettings(pluginId, next)
      emitPluginSettingsChanged(pluginId, next)
    },
    getAllSettings: async (): Promise<Record<string, unknown>> => {
      assertPermission(pluginId, 'storage', `read all plugin settings`)
      const view = await loadSettings(pluginId, true)
      return { ...view.values }
    },
    // 宿主实例上 SDK stub 订阅表无通知来源（setHost 层只装在插件 bundle 副本），
    // 直接订阅宿主事件总线并按 pluginId 过滤，语义与 SDK override 分支一致。
    onSettingsChange: (handler) =>
      createPluginEventBus(pluginId).on('plugin-settings:change', (payload) => {
        if (payload.pluginId !== pluginId) return
        handler(payload.values)
      }),
    // Frontmatter API – reads from / writes to the editor store.
    getActiveNoteFrontmatter: (): Record<string, unknown> | null => {
      const tab = useEditorStore.getState().getActiveTab()
      return tab?.frontmatter ?? null
    },
    setActiveNoteFrontmatter: (data: Partial<NoteFrontmatter>): void => {
      const tab = useEditorStore.getState().getActiveTab()
      if (!tab) return
      useEditorStore.getState().updateTabFrontmatter(tab.id, data)
    },
    onNoteFrontmatterChanged: (callback: (data: Record<string, unknown>) => void): () => void => {
      let prevFm = useEditorStore.getState().getActiveTab()?.frontmatter ?? null
      let prevFmJson = prevFm ? JSON.stringify(prevFm) : null
      return useEditorStore.subscribe((state) => {
        const activeTab = state.tabs.find((t) => t.id === state.activeTabId)
        const nextFm = activeTab?.frontmatter ?? null
        // Fast path: when the frontmatter reference is unchanged
        // (e.g. content-only updates from typing), skip the
        // JSON.stringify cost entirely.
        if (nextFm === prevFm) return
        const nextFmJson = nextFm ? JSON.stringify(nextFm) : null
        prevFm = nextFm
        if (prevFmJson !== nextFmJson) {
          prevFmJson = nextFmJson
          callback(nextFm ?? {})
        }
      })
    },
    // 编辑器写 / 文件 API：闭包 pluginId 显式正确（面板场景不走模块级隐式解析），权限检查内聚在桥接。
    editor: {
      insertAtCursor: (text: string) => pluginEditorInsertAtCursor(pluginId, text),
      replaceSelection: (text: string) => pluginEditorReplaceSelection(pluginId, text),
      replaceContent: (text: string) => pluginEditorReplaceContent(pluginId, text),
      getSelection: () => pluginEditorGetSelection(pluginId),
    },
    files: {
      createNote: (relPath: string, content: string) => pluginFilesCreateNote(pluginId, relPath, content),
      listWorkspace: (query?: string) => pluginFilesListWorkspace(pluginId, query),
    },
    // 安全存储（P1.5 / ADR-0003）：加密落盘，独立 'secure-storage' 权限门控，
    // 加解密内聚在 Rust 侧，此处仅权限检查 + IPC 转发。
    secureStorage: {
      get: (key: string) => {
        assertPermission(pluginId, 'secure-storage', `read secure storage key "${key}"`)
        return readSecureStorage(pluginId, key)
      },
      set: async (key: string, value: string) => {
        assertPermission(pluginId, 'secure-storage', `write secure storage key "${key}"`)
        await writeSecureStorage(pluginId, key, value)
      },
      delete: (key: string) => {
        assertPermission(pluginId, 'secure-storage', `delete secure storage key "${key}"`)
        return deleteSecureStorage(pluginId, key)
      },
      keys: () => {
        assertPermission(pluginId, 'secure-storage', `list secure storage keys`)
        return listSecureStorageKeys(pluginId)
      },
    },
  }
}

// ─── Toolbar button helpers ──────────────────────────────────────────────────

/**
 * Derive the active-note helpers passed to plugin toolbar buttons.
 *
 * `isActiveNoteMarkdown` uses the same regex the editor itself uses
 * (`.md` / `.markdown`, case-insensitive). Centralised here so a
 * plugin doesn't have to re-implement (or drift from) the host's
 * notion of "is this a markdown note".
 */
function deriveActiveNoteMeta(activeNotePath: string): {
  activeNoteName: string
  activeNoteExt: string
  isActiveNoteMarkdown: boolean
} {
  if (!activeNotePath) {
    return { activeNoteName: '', activeNoteExt: '', isActiveNoteMarkdown: false }
  }
  const name = activeNotePath.split(/[\\/]/).pop() || activeNotePath
  const dotIdx = name.lastIndexOf('.')
  const ext = dotIdx >= 0 ? name.slice(dotIdx + 1).toLowerCase() : ''
  return {
    activeNoteName: name,
    activeNoteExt: ext,
    isActiveNoteMarkdown: ext === 'md' || ext === 'markdown',
  }
}

/**
 * Create ToolbarButtonProps for a plugin's custom toolbar button component.
 * Similar to createPluginPanelProps but tailored for toolbar-level rendering.
 */
export function createToolbarButtonProps(
  pluginId: string,
  isActive: boolean,
  size: number,
  activate: () => void,
  deactivate: () => void,
  activeNoteContent: string = '',
  activeNotePath: string = '',
): ToolbarButtonProps {
  const { activeNoteName, activeNoteExt, isActiveNoteMarkdown } =
    deriveActiveNoteMeta(activeNotePath)
  return {
    size,
    isActive,
    pluginId,
    invokeBackend: async (command: string, args?: Record<string, unknown>) => {
      assertPermission(pluginId, 'backend', `invoke backend command "${command}"`)
      const { invoke } = await import('@tauri-apps/api/core')
      const start = performance.now()
      let success = true
      let errorMsg: string | undefined
      try {
        return await invoke('invoke_plugin', { pluginId, command, args })
      } catch (err) {
        success = false
        errorMsg = String(err)
        throw err
      } finally {
        const durationMs = performance.now() - start
        void import('./plugin-telemetry').then(({ recordBackendMetric }) => {
          recordBackendMetric(pluginId, command, durationMs, success, errorMsg)
        })
      }
    },
    // 流式调用：与面板版本一致，委托共享桥接函数。
    invokeBackendStream: <T = unknown, R = unknown>(
      command: string,
      args: Record<string, unknown> | undefined,
      onChunk: (chunk: T) => void,
      options?: { firstChunkTimeoutSecs?: number }
    ): Promise<R> =>
      invokePluginBackendStream<T, R>(pluginId, command, args, onChunk, options),
    store: getPluginStorage(pluginId),
    events: createPluginEventBus(pluginId),
    activate,
    deactivate,
    activeNoteContent,
    activeNotePath,
    activeNoteName,
    activeNoteExt,
    isActiveNoteMarkdown,
    // Schema-driven settings bridge – same shape as the panel
    // version. Toolbar buttons sometimes toggle a single
    // setting (e.g. "open the editor in dark mode") and need
    // to read the current value, write a new one, and observe
    // changes from other instances.
    getSetting: async <T = unknown>(key: string): Promise<T | null> => {
      assertPermission(pluginId, 'storage', `read plugin setting "${key}"`)
      const view = await loadSettings(pluginId, true)
      return readSetting(view, key) as T | null
    },
    setSetting: async <T = unknown>(key: string, value: T): Promise<void> => {
      assertPermission(pluginId, 'storage', `write plugin setting "${key}"`)
      const view = await loadSettings(pluginId, true)
      const next = { ...view.values, [key]: value }
      await writePluginSettings(pluginId, next)
      emitPluginSettingsChanged(pluginId, next)
    },
    getAllSettings: async (): Promise<Record<string, unknown>> => {
      assertPermission(pluginId, 'storage', `read all plugin settings`)
      const view = await loadSettings(pluginId, true)
      return { ...view.values }
    },
    // 宿主实例上 SDK stub 订阅表无通知来源（setHost 层只装在插件 bundle 副本），
    // 直接订阅宿主事件总线并按 pluginId 过滤，语义与 SDK override 分支一致。
    onSettingsChange: (handler) =>
      createPluginEventBus(pluginId).on('plugin-settings:change', (payload) => {
        if (payload.pluginId !== pluginId) return
        handler(payload.values)
      }),
    // Frontmatter API – same implementation as the panel version.
    getActiveNoteFrontmatter: (): Record<string, unknown> | null => {
      const tab = useEditorStore.getState().getActiveTab()
      return tab?.frontmatter ?? null
    },
    setActiveNoteFrontmatter: (data: Partial<NoteFrontmatter>): void => {
      const tab = useEditorStore.getState().getActiveTab()
      if (!tab) return
      useEditorStore.getState().updateTabFrontmatter(tab.id, data)
    },
    onNoteFrontmatterChanged: (callback: (data: Record<string, unknown>) => void): () => void => {
      let prevFm = useEditorStore.getState().getActiveTab()?.frontmatter ?? null
      let prevFmJson = prevFm ? JSON.stringify(prevFm) : null
      return useEditorStore.subscribe((state) => {
        const activeTab = state.tabs.find((t) => t.id === state.activeTabId)
        const nextFm = activeTab?.frontmatter ?? null
        // Fast path: when the frontmatter reference is unchanged
        // (e.g. content-only updates from typing), skip the
        // JSON.stringify cost entirely.
        if (nextFm === prevFm) return
        const nextFmJson = nextFm ? JSON.stringify(nextFm) : null
        prevFm = nextFm
        if (prevFmJson !== nextFmJson) {
          prevFmJson = nextFmJson
          callback(nextFm ?? {})
        }
      })
    },
    // 编辑器写 / 文件 API：同面板版本，闭包 pluginId 显式正确。
    editor: {
      insertAtCursor: (text: string) => pluginEditorInsertAtCursor(pluginId, text),
      replaceSelection: (text: string) => pluginEditorReplaceSelection(pluginId, text),
      replaceContent: (text: string) => pluginEditorReplaceContent(pluginId, text),
      getSelection: () => pluginEditorGetSelection(pluginId),
    },
    files: {
      createNote: (relPath: string, content: string) => pluginFilesCreateNote(pluginId, relPath, content),
      listWorkspace: (query?: string) => pluginFilesListWorkspace(pluginId, query),
    },
    // 安全存储：同面板版本，独立 'secure-storage' 权限门控。
    secureStorage: {
      get: (key: string) => {
        assertPermission(pluginId, 'secure-storage', `read secure storage key "${key}"`)
        return readSecureStorage(pluginId, key)
      },
      set: async (key: string, value: string) => {
        assertPermission(pluginId, 'secure-storage', `write secure storage key "${key}"`)
        await writeSecureStorage(pluginId, key, value)
      },
      delete: (key: string) => {
        assertPermission(pluginId, 'secure-storage', `delete secure storage key "${key}"`)
        return deleteSecureStorage(pluginId, key)
      },
      keys: () => {
        assertPermission(pluginId, 'secure-storage', `list secure storage keys`)
        return listSecureStorageKeys(pluginId)
      },
    },
  }
}

/**
 * Render a plugin's custom toolbar button component.
 * Handles both ComponentType and ReactNode, same pattern as renderPluginIcon.
 */
export function renderPluginToolbarButton(
  toolbarButton: ComponentType<ToolbarButtonProps> | ReactNode,
  props: ToolbarButtonProps,
): ReactNode {
  if (isComponentLike(toolbarButton)) {
    const ButtonComponent = toolbarButton as ComponentType<ToolbarButtonProps>
    return <ButtonComponent {...props} />
  }
  return toolbarButton as ReactNode
}
