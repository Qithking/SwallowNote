/**
 * Plugin utility functions
 */
import { type ComponentType, type ReactNode } from 'react'
import type { SidebarView, RightPanelType } from '@/stores'
import type { ContentPosition, PluginPanelProps } from '@/types/plugin'
import { getPluginStorage, pluginEventBus } from './plugin-host'

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
  close: () => void
): PluginPanelProps {
  // Import lazily to avoid pulling the Tauri-side bridge into the
  // bundle for non-Tauri code paths (tests, Storybook).
  return {
    pluginId,
    isActive,
    close,
    // TODO: Backend IPC layer is not yet implemented on the Rust side
    // (see `src-tauri/src/commands/plugin.rs` invoke_plugin entry and
    // `.work/执行文档.md` 2026-06-10 design doc). This call will return
    // "command not found" until invoke_plugin is implemented. Plugins
    // should treat this as a graceful-degradation path (e.g. show
    // "backend unavailable" UI) rather than crashing.
    invokeBackend: async (command: string, args?: Record<string, unknown>) => {
      const { invoke } = await import('@tauri-apps/api/core')
      try {
        return await invoke(`plugin_${pluginId}_${command}`, args)
      } catch (err) {
        // Surface a clearer error to the panel so the user knows the
        // backend layer is not yet wired up, instead of a raw tauri
        // "command not found" string.
        throw new Error(
          `Plugin backend IPC not implemented yet (plugin_id=${pluginId}, command=${command}): ${String(err)}`,
        )
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
    events: pluginEventBus,
  }
}
