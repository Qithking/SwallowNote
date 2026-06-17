/**
 * Plugin utility functions
 */
import { type ComponentType, type ReactNode } from 'react'
import type { SidebarView, RightPanelType } from '@/stores'
import type { ContentPosition, PluginPanelProps, ToolbarButtonProps } from '@/types/plugin'
import { getPluginStorage, createPluginEventBus } from './plugin-host'
import { assertPermission } from './plugin-permission-guard'
import { loadSettings, readSetting } from './plugin-settings'
import { writePluginSettings } from './tauri'
import {
  emitPluginSettingsChanged,
  onSettingsChange as sdkOnSettingsChange,
} from '@swallow-note/plugin-sdk'

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
 */
export function renderPluginIcon(
  icon: ComponentType<{ size?: number }> | ReactNode,
  size: number = 18
): ReactNode {
  // Use isComponentLike to correctly identify component-like values,
  // including those wrapped in forwardRef / memo. A bare
  // `typeof === 'function'` check would miss those wrappers and try to
  // render them as a function rather than a component.
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
): PluginPanelProps {
  // Import lazily to avoid pulling the Tauri-side bridge into the
  // bundle for non-Tauri code paths (tests, Storybook).
  return {
    pluginId,
    isActive,
    close,
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
    onSettingsChange: (handler) => sdkOnSettingsChange(pluginId, handler),
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
    onSettingsChange: (handler) => sdkOnSettingsChange(pluginId, handler),
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
