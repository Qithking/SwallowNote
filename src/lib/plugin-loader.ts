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
    const module = await import(/* @vite-ignore */ indexJsUrl)
    return module.default || module.manifest || null
  } catch (err) {
    console.error(`[PluginLoader] Failed to load plugin from ${pluginPath}:`, err)
    return null
  }
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
      } satisfies PluginDefinition
    })
  )

  return results
}
