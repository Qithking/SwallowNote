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
import { createElement, type ReactNode } from 'react'
import { PlugZap } from 'lucide-react'

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
  const { manifest } = await loadPluginModuleWithRef(pluginPath)
  return manifest
}

/**
 * Internal: load a plugin module and return both the manifest and
 * the raw dynamic-import result. The raw module is needed by
 * `loadAllPlugins` so it can attach `__pluginModule` to the
 * definition (used by the host takeover layer to call `setHost`).
 */
async function loadPluginModuleWithRef(
  pluginPath: string
): Promise<{ manifest: PluginManifest | null; module: Record<string, unknown> | null }> {
  try {
    const { convertFileSrc } = await import('@tauri-apps/api/core')
    const indexJsUrl = convertFileSrc(`${pluginPath}/index.js`)

    // Dynamic import of the plugin module
    // Use a cache-busting query param to ensure fresh load during HMR
    const cacheBuster = `?v=${Date.now()}`
    const module = (await import(/* @vite-ignore */ `${indexJsUrl}${cacheBuster}`)) as Record<string, unknown>
    const manifest = (module.default || module.manifest || null) as PluginManifest | null
    return { manifest, module }
  } catch (err) {
    console.error(`[PluginLoader] Failed to load plugin from ${pluginPath}:`, err)
    return { manifest: null, module: null }
  }
}

/**
 * Stash the dynamic-import result on a definition as a non-
 * enumerable field. The host takeover layer uses this to call
 * `setHost` on the plugin's bundled SDK at hook-fire time
 * (see `plugin-host-takeover.ts`).
 *
 * We use `Object.defineProperty` with `enumerable: false` so
 * the field doesn't show up in JSON.stringify(definition) or
 * spread-copies that consumers might take. Vite's IIFE bundle
 * exposes the plugin's SDK `setHost` as a top-level property
 * only if the entry file re-exports it; without the re-export
 * the takeover is silently skipped and the hook runs against
 * the SDK's in-process stubs.
 */
function attachPluginModule(
  def: PluginDefinition,
  module: Record<string, unknown> | null
): void {
  if (!module) return
  Object.defineProperty(def, '__pluginModule', {
    value: module,
    enumerable: false,
    writable: false,
    configurable: false,
  })
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
      const { manifest, module } = await loadPluginModuleWithRef(meta.plugin_path)

      if (manifest) {
        const def = {
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
        attachPluginModule(def, module)
        return def
      }
      // Plugin without a valid manifest - create a placeholder that
      // surfaces a clear, visible icon (PlugZap) and a short panel
      // explaining the failure. The previous `() => null` produced
      // an *invisible* sidebar entry that the user could click but
      // not see, making it impossible to debug a missing manifest.
      // We use `createElement` instead of JSX so this file stays a
      // plain `.ts` module (no tsx transform needed for the loader).
      const fallbackIcon: ReactNode = createElement(PlugZap, { size: 18 })
      const fallbackPanel: ReactNode = createElement(
        'div',
        {
          style: {
            padding: 24,
            color: 'var(--text-secondary)',
            fontSize: 13,
          },
        },
        createElement(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 8,
            },
          },
          createElement(PlugZap, { size: 16 }),
          createElement('strong', null, '插件清单缺失'),
        ),
        createElement(
          'p',
          null,
          `该插件 (${meta.id}) 的 `,
          createElement('code', null, 'index.js'),
          ' 未导出有效的 ',
          createElement('code', null, 'manifest'),
          ' 对象。请检查插件包是否完整、是否被部分删除，或联系插件作者。',
        ),
      )
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
        icon: () => fallbackIcon,
        panel: () => fallbackPanel,
        pluginPath: meta.plugin_path,
        hasBackend: meta.has_backend,
        permissions: [],
      } satisfies PluginDefinition
    })
  )

  return results
}
