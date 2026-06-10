/**
 * Plugin Loader - Responsible for loading plugin packages from disk
 *
 * Each plugin package is a directory under <app_data_dir>/plugins/<plugin-id>/
 * containing at minimum an index.js that exports:
 *   - manifest: PluginManifest metadata
 *   - icon: React component or ReactNode
 *   - panel: React component or ReactNode
 *
 * The index.js may also contain a special comment for Rust-side parsing:
 *   // @swallow-manifest { "id": "...", "name": "...", ... }
 */
import type { PluginDefinition, PluginManifest, PluginMetadata } from '@/types/plugin'
import type { PluginMetadataRust } from '@/lib/tauri'

/**
 * Convert Rust PluginMetadata to frontend PluginMetadata
 */
export function rustMetaToPluginMeta(meta: PluginMetadataRust): PluginMetadata {
  return {
    id: meta.id,
    name: meta.name,
    description: meta.description,
    version: meta.version,
    author: meta.author,
    publishedAt: meta.published_at,
    iconPosition: meta.icon_position as PluginMetadata['iconPosition'],
    contentPosition: meta.content_position as PluginMetadata['contentPosition'],
    order: meta.order,
    enabled: meta.enabled,
    pluginPath: meta.plugin_path,
    hasBackend: meta.has_backend,
  }
}

/**
 * Dynamically load a plugin's index.js module.
 *
 * In a Tauri app, plugin index.js files are located in the app data directory.
 * We use a dynamic import with the Tauri asset protocol to load them.
 */
export async function loadPluginModule(pluginPath: string): Promise<PluginManifest | null> {
  try {
    const { convertFileSrc } = await import('@tauri-apps/api/core')
    const indexJsUrl = convertFileSrc(`${pluginPath}/index.js`)

    // Dynamic import of the plugin module
    // Use a cache-busting query param to ensure fresh load during HMR
    const cacheBuster = `?v=${Date.now()}`
    const module = await import(/* @vite-ignore */ `${indexJsUrl}${cacheBuster}`)
    return module.default || module.manifest || null
  } catch (err) {
    console.error(`[PluginLoader] Failed to load plugin from ${pluginPath}:`, err)
    return null
  }
}

/**
 * Load a single plugin from a path. Used for hot reload.
 */
export async function loadPluginFromPath(pluginPath: string): Promise<PluginDefinition | null> {
  const manifest = await loadPluginModule(pluginPath)
  
  if (!manifest) {
    return null
  }

  // Extract plugin ID from manifest or path
  const pluginId = manifest.id || extractPluginIdFromPath(pluginPath)
  
  return {
    id: pluginId,
    name: manifest.name,
    description: manifest.description || '',
    version: manifest.version || '1.0.0',
    author: manifest.author || '',
    publishedAt: manifest.publishedAt || new Date().toISOString(),
    iconPosition: manifest.iconPosition || 'sidebar',
    contentPosition: manifest.contentPosition || 'leftPanel',
    order: manifest.order ?? 100,
    enabled: manifest.enabled ?? true,
    icon: manifest.icon,
    panel: manifest.panel,
    settings: manifest.settings,
    pluginPath,
    hasBackend: false,
    permissions: manifest.permissions ?? [],
    hooks: {
      onLoad: manifest.onLoad,
      onUnload: manifest.onUnload,
      onEnable: manifest.onEnable,
      onDisable: manifest.onDisable,
      onMount: manifest.onMount,
      onUnmount: manifest.onUnmount,
      onActivate: manifest.onActivate,
      onDeactivate: manifest.onDeactivate,
    },
  } satisfies PluginDefinition
}

/**
 * Extract plugin ID from file path
 */
function extractPluginIdFromPath(path: string): string {
  // Try to extract ID from path (e.g., /path/to/plugins/com.example.myplugin → com.example.myplugin)
  const parts = path.split('/')
  const lastPart = parts[parts.length - 1] || parts[parts.length - 2] || 'unknown-plugin'
  return lastPart.replace(/[^a-zA-Z0-9.-]/g, '-')
}

/**
 * Load all plugins: scan metadata from Rust, then load JS modules.
 * Returns PluginDefinition[] ready for the plugin store.
 */
export async function loadAllPlugins(
  rustMetas: PluginMetadataRust[]
): Promise<PluginDefinition[]> {
  // Load all plugin modules in parallel; each dynamic import is async and
  // independent so there's no benefit to serializing them. The fallback
  // "placeholder" plugin is still emitted when loadPluginModule returns
  // null, so the UI always shows an entry for every discovered plugin.
  const results = await Promise.all(
    rustMetas.map(async (meta) => {
      const manifest = await loadPluginModule(meta.plugin_path)

      if (manifest) {
        return {
          id: meta.id,
          name: manifest.name || meta.name,
          description: manifest.description || meta.description,
          version: manifest.version || meta.version,
          author: manifest.author || meta.author,
          publishedAt: manifest.publishedAt || meta.published_at,
          iconPosition: manifest.iconPosition || (meta.icon_position as PluginDefinition['iconPosition']),
          contentPosition: manifest.contentPosition || (meta.content_position as PluginDefinition['contentPosition']),
          order: manifest.order ?? meta.order,
          // Persisted enabled state (.disabled marker) takes precedence
          // over the manifest's declared enabled value.
          enabled: meta.enabled,
          icon: manifest.icon,
          panel: manifest.panel,
          // Settings dialog component. Carried over from the manifest
          // verbatim; if the plugin doesn't declare one, the field is
          // `undefined` and the plugin manager hides the Settings
          // button for that plugin.
          settings: manifest.settings,
          pluginPath: meta.plugin_path,
          hasBackend: meta.has_backend,
          permissions: manifest.permissions ?? [],
          // Carry lifecycle hooks from the manifest onto the runtime
          // definition. The store invokes these at register /
          // unregister / enable / disable time. If a plugin author
          // didn't define any hooks this stays undefined, which is
          // fine – runLifecycleHook treats undefined as a no-op.
          hooks: {
            onLoad: manifest.onLoad,
            onUnload: manifest.onUnload,
            onEnable: manifest.onEnable,
            onDisable: manifest.onDisable,
            onMount: manifest.onMount,
            onUnmount: manifest.onUnmount,
            onActivate: manifest.onActivate,
            onDeactivate: manifest.onDeactivate,
          },
        } satisfies PluginDefinition
      }
      // Plugin without a valid manifest - create a placeholder
      return {
        id: meta.id,
        name: meta.name,
        description: meta.description,
        version: meta.version,
        author: meta.author,
        publishedAt: meta.published_at,
        iconPosition: meta.icon_position as PluginDefinition['iconPosition'],
        contentPosition: meta.content_position as PluginDefinition['contentPosition'],
        order: meta.order,
        enabled: meta.enabled,
        icon: () => null,
        panel: () => null,
        pluginPath: meta.plugin_path,
        hasBackend: meta.has_backend,
        permissions: [],
      } satisfies PluginDefinition
    })
  )

  return results
}
