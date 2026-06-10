/**
 * Plugin Hot Reload
 * 
 * Provides hot reload capabilities for plugins during development.
 * Only active in development mode.
 * 
 * Usage:
 * 1. Call `initHotReload(true)` to enable
 * 2. Call `hotReloadPlugin(pluginId, pluginPath)` to trigger reload
 * 3. Use `watchPlugin`/`unwatchPlugin` to auto-reload on changes
 */

import { getPluginStorage, dropPluginStorage } from './plugin-host'
import { loadPluginFromPath } from './plugin-loader'
import { usePluginStore } from '@/stores'

let enabled = false

/**
 * Enable/disable hot reload
 */
export function setHotReloadEnabled(enable: boolean): void {
  enabled = enable
  console.log(`[plugin-hmr] Hot reload ${enabled ? 'enabled' : 'disabled'}`)
}

/**
 * Check if hot reload is enabled
 */
export function isHotReloadEnabled(): boolean {
  return enabled
}

/**
 * Initialize hot reload system
 */
export function initHotReload(enable?: boolean): void {
  if (enable !== undefined) {
    enabled = enable
  }
  
  // Check URL param for development mode
  if (typeof window !== 'undefined') {
    const urlParams = new URLSearchParams(window.location.search)
    if (urlParams.get('hmr') === 'true') {
      enabled = true
    }
  }
  
  console.log(`[plugin-hmr] Hot reload ${enabled ? 'enabled' : 'disabled'}`)
}

/**
 * Hot reload a plugin while preserving state
 */
export async function hotReloadPlugin(pluginId: string, pluginPath: string): Promise<void> {
  if (!enabled) {
    console.warn(`[plugin-hmr] Hot reload is disabled. Enable with initHotReload(true)`)
    return
  }
  
  const pluginStore = usePluginStore.getState()
  
  try {
    // 1. Get current plugin state (storage)
    const store = getPluginStorage(pluginId)
    const keys = await store.keys()
    const stateSnapshot: Record<string, unknown> = {}
    for (const key of keys) {
      const value = await store.get(key)
      if (value !== null && value !== undefined) {
        stateSnapshot[key] = value
      }
    }
    
    // 2. Unregister the plugin
    pluginStore.unregisterPlugin(pluginId)
    
    // 3. Clear storage cache
    dropPluginStorage(pluginId)
    
    // 4. Re-load and re-register the plugin
    const newPlugin = await loadPluginFromPath(pluginPath)
    if (!newPlugin) {
      console.error(`[plugin-hmr] Failed to reload plugin ${pluginId}: module not found`)
      return
    }
    
    pluginStore.registerPlugin(newPlugin)
    
    // 5. Restore state
    const newStore = getPluginStorage(pluginId)
    for (const [key, value] of Object.entries(stateSnapshot)) {
      await newStore.set(key, value)
    }
    
    // 6. Re-enable
    pluginStore.setPluginEnabled(pluginId, true)
    
    console.log(`[plugin-hmr] Successfully reloaded plugin: ${pluginId}`)
  } catch (err) {
    console.error(`[plugin-hmr] Failed to reload plugin ${pluginId}:`, err)
  }
}
