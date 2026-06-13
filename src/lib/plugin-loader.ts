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
    const indexJsPath = `${pluginPath}/index.js`

    // Tauri's asset protocol (convertFileSrc) may reject requests to
    // hidden directories like `.versions/` with 403. Instead, read
    // the file content via a Rust command (which has unrestricted FS
    // access) and create a blob URL for `import()`.
    const { readFile } = await import('@/lib/tauri')
    let code = await readFile(indexJsPath)

    console.log(`[PluginLoader] Read ${indexJsPath}: ${code.length} chars, hasReactImport: ${code.includes('from "react"')}, hasBundledReact: ${code.includes('__SECRET_INTERNALS')}`)

    // If the plugin bundles its own React copy (not just references
    // window.React's internals), it will crash at runtime with
    // "multiple React instances" errors. We detect this by checking
    // for the React source code pattern. A bundled React always
    // contains the version check preamble.
    //
    // react/jsx-runtime is a thin wrapper that delegates to the
    // external React, so having `from "react/jsx-runtime"` is fine
    // (it's an external import, not a bundled copy). But if the
    // bundle contains `__SECRET_INTERNALS` WITHOUT any React import
    // (meaning the React source was inlined), that's a problem.
    // We also check for `from "react/jsx-runtime"` and
    // `from "react/jsx-dev-runtime"` — if `__SECRET_INTERNALS`
    // appears alongside those imports, the jsx-runtime was bundled
    // (not externalized) and its internal React reference will
    // conflict with the host's React.
    const hasReactExternalImport =
      code.includes('from "react"') || code.includes("from 'react'") ||
      code.includes('from "react/jsx-runtime"') || code.includes("from 'react/jsx-runtime'") ||
      code.includes('from "react/jsx-dev-runtime"') || code.includes("from 'react/jsx-dev-runtime'")
    const hasBundledReact = code.includes('react.production.min.js') ||
      code.includes('react.development.js') ||
      (code.includes('__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED') &&
       !hasReactExternalImport)
    if (hasBundledReact) {
      console.error(`[PluginLoader] Plugin at ${pluginPath} bundles its own React, which causes hook crashes. The plugin must be rebuilt with react/react-dom as external dependencies.`)
      return { manifest: null, module: null }
    }

    // Plugins built with Vite may reference `process.env.NODE_ENV` which
    // doesn't exist in the browser/webview. If the build didn't replace
    // these references (e.g. missing `define` in vite.config), inject a
    // minimal polyfill at the top of the code so the module can execute.
    if (code.includes('process.env')) {
      code = 'var process=process||{env:{NODE_ENV:"production"}};\n' + code
    }

    // External plugins mark react/react-dom as external in their Vite
    // config, so the bundle contains bare `import` statements like:
    //   import React, { useState, useEffect } from "react";
    //   import ReactDOM from "react-dom/client";
    //   import { jsx, jsxs } from "react/jsx-runtime";
    // These can't be resolved at runtime because the blob URL has no
    // package resolver. Replace them with reads from the host's globals
    // (window.React / window.ReactDOM / window.ReactJSXRuntime) which
    // are set in main.tsx.
    code = code
      .replace(
        // Match: import X, { ... } from "react";
        /import\s+(\w+)\s*,\s*\{([^}]*)\}\s*from\s*["']react["'];?/g,
        (_match, defaultName, named: string) => {
          const names = named.split(',').map((s: string) => s.trim().split(/\s+as\s+/).map((x: string) => x.trim()))
          const lines = [`const ${defaultName} = window.React;`]
          for (const [orig, alias] of names) {
            lines.push(alias ? `const ${alias} = window.React.${orig};` : `const ${orig} = window.React.${orig};`)
          }
          return lines.join('\n')
        }
      )
      .replace(
        // Match: import { ... } from "react";
        /import\s*\{([^}]*)\}\s*from\s*["']react["'];?/g,
        (_match, named: string) => {
          const names = named.split(',').map((s: string) => s.trim().split(/\s+as\s+/).map((x: string) => x.trim()))
          return names.map(([orig, alias]) =>
            alias ? `const ${alias} = window.React.${orig};` : `const ${orig} = window.React.${orig};`
          ).join('\n')
        }
      )
      .replace(
        // Match: import X from "react";
        /import\s+(\w+)\s+from\s+["']react["'];?/g,
        'const $1 = window.React;'
      )
      .replace(
        // Match: import * as X from "react";
        /import\s*\*\s*as\s+(\w+)\s+from\s+["']react["'];?/g,
        'const $1 = window.React;'
      )
      .replace(
        /import\s+(\w+)\s+from\s+["']react-dom\/client["'];?/g,
        'const $1 = window.ReactDOM;'
      )
      .replace(
        /import\s+(\w+)\s+from\s+["']react-dom["'];?/g,
        'const $1 = window.ReactDOM;'
      )
      .replace(
        // Match: import * as X from "react-dom/client";
        /import\s*\*\s*as\s+(\w+)\s+from\s+["']react-dom\/client["'];?/g,
        'const $1 = window.ReactDOM;'
      )
      .replace(
        // Match: import * as X from "react-dom";
        /import\s*\*\s*as\s+(\w+)\s+from\s+["']react-dom["'];?/g,
        'const $1 = window.ReactDOM;'
      )
      .replace(
        // Match: import { jsx, jsxs, Fragment } from "react/jsx-runtime";
        /import\s*\{([^}]*)\}\s*from\s*["']react\/jsx-runtime["'];?/g,
        (_match, named: string) => {
          const names = named.split(',').map((s: string) => s.trim().split(/\s+as\s+/).map((x: string) => x.trim()))
          return names.map(([orig, alias]) =>
            alias ? `const ${alias} = window.ReactJSXRuntime.${orig};` : `const ${orig} = window.ReactJSXRuntime.${orig};`
          ).join('\n')
        }
      )
      .replace(
        // Match: import X from "react/jsx-runtime";
        /import\s+(\w+)\s+from\s+["']react\/jsx-runtime["'];?/g,
        'const $1 = window.ReactJSXRuntime;'
      )
      .replace(
        // Match: import * as X from "react/jsx-runtime";
        /import\s*\*\s*as\s+(\w+)\s+from\s+["']react\/jsx-runtime["'];?/g,
        'const $1 = window.ReactJSXRuntime;'
      )
      .replace(
        // Match: import { ... } from "react/jsx-dev-runtime";
        /import\s*\{([^}]*)\}\s*from\s*["']react\/jsx-dev-runtime["'];?/g,
        (_match, named: string) => {
          const names = named.split(',').map((s: string) => s.trim().split(/\s+as\s+/).map((x: string) => x.trim()))
          return names.map(([orig, alias]) =>
            alias ? `const ${alias} = window.ReactJSXRuntime.${orig};` : `const ${orig} = window.ReactJSXRuntime.${orig};`
          ).join('\n')
        }
      )
      .replace(
        // Match: import X from "react/jsx-dev-runtime";
        /import\s+(\w+)\s+from\s+["']react\/jsx-dev-runtime["'];?/g,
        'const $1 = window.ReactJSXRuntime;'
      )
      .replace(
        // Match: import { toast } from "sonner";
        /import\s*\{([^}]*)\}\s*from\s*["']sonner["'];?/g,
        (_match, named: string) => {
          const names = named.split(',').map((s: string) => s.trim().split(/\s+as\s+/).map((x: string) => x.trim()))
          return names.map(([orig, alias]) => {
            const val = orig === 'toast' ? 'window.SonnerToast' : `window.SonnerToast.${orig}`
            return alias ? `const ${alias} = ${val};` : `const ${orig} = ${val};`
          }).join('\n')
        }
      )
      .replace(
        // Match: import { useTranslation, ... } from "react-i18next";
        /import\s*\{([^}]*)\}\s*from\s*["']react-i18next["'];?/g,
        (_match, named: string) => {
          const names = named.split(',').map((s: string) => s.trim().split(/\s+as\s+/).map((x: string) => x.trim()))
          return names.map(([orig, alias]) =>
            alias ? `const ${alias} = window.ReactI18Next.${orig};` : `const ${orig} = window.ReactI18Next.${orig};`
          ).join('\n')
        }
      )
      .replace(
        // Match: import X from "react-i18next";
        /import\s+(\w+)\s+from\s+["']react-i18next["'];?/g,
        'const $1 = window.ReactI18Next;'
      )
      .replace(
        // Match: import X from "i18next";
        /import\s+(\w+)\s+from\s*["']i18next["'];?/g,
        'const $1 = window.ReactI18Next;'
      )

    console.log(`[PluginLoader] After transform: ${code.length} chars, still hasReactImport: ${code.includes('from "react"')}, first 300 chars:`, code.substring(0, 300))

    const blob = new Blob([code], { type: 'application/javascript' })
    const blobUrl = URL.createObjectURL(blob)

    let module: Record<string, unknown>
    try {
      module = (await import(/* @vite-ignore */ blobUrl)) as Record<string, unknown>
    } finally {
      URL.revokeObjectURL(blobUrl)
    }

    console.log(`[PluginLoader] Loaded module from ${pluginPath}`, {
      keys: Object.keys(module),
      hasDefault: 'default' in module,
      defaultType: typeof module.default,
    })
    const manifest = (module.default || module.manifest || null) as PluginManifest | null
    if (manifest) {
      console.log(`[PluginLoader] Manifest for ${manifest.id}:`, {
        iconPosition: manifest.iconPosition,
        contentPosition: manifest.contentPosition,
        hasToolbarButton: !!manifest.toolbarButton,
        hasIcon: !!manifest.icon,
        hasPanel: !!manifest.panel,
      })
    } else {
      console.warn(`[PluginLoader] No manifest found in module from ${pluginPath}`)
    }
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
  console.log(`[PluginLoader] loadAllPlugins called with ${rustMetas.length} plugins:`, rustMetas.map(m => ({ id: m.id, path: m.plugin_path, iconPos: m.icon_position, enabled: m.enabled })))
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
          // Custom toolbar button component. When provided, the host
          // renders this component instead of the default icon + button
          // pattern. Allows plugins to implement dropdown menus, direct
          // actions, etc.
          toolbarButton: manifest.toolbarButton,
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
