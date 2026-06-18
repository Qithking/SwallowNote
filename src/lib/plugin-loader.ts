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
import type {
  PluginDefinition,
  PluginLoadFailure,
  PluginLoadResult,
  PluginManifest,
  PluginMetadata,
} from '@/types/plugin'
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
    iconPosition: (meta.icon_position ?? undefined) as PluginMetadata['iconPosition'],
    contentPosition: (meta.content_position ?? undefined) as PluginMetadata['contentPosition'],
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
  let code = ''
  try {
    const indexJsPath = `${pluginPath}/index.js`

    // Tauri's asset protocol (convertFileSrc) may reject requests to
    // hidden directories like `.versions/` with 403. Instead, read
    // the file content via a Rust command (which has unrestricted FS
    // access) and create a blob URL for `import()`.
    const { readFile } = await import('@/lib/tauri')
    code = await readFile(indexJsPath)

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
        // Match: import { ... } from "react";
        // (Covers the { X as Y } form that the preceding X, { ... } /
        // { ... } / X / * as rules above don't cover. Vite can emit
        // `import { useState as useX }` in some tree-shaking paths.)
        /import\s*\{([^}]*)\}\s*from\s+["']react["'];?/g,
        (_match, named: string) => {
          const names = named.split(',').map((s: string) => s.trim().split(/\s+as\s+/).map((x: string) => x.trim()))
          return names.map(([orig, alias]) =>
            alias ? `const ${alias} = window.React.${orig};` : `const ${orig} = window.React.${orig};`
          ).join('\n')
        }
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
        // Match: import { X, X as Y, ... } from "react-dom";
        // (Covers `import { createPortal as FS } from "react-dom"`,
        // which the preceding X / * rules don't match. Triggered by
        // any plugin that uses react-dom named exports such as
        // `createPortal` — e.g. com.swallownote.mindmap.)
        /import\s*\{([^}]*)\}\s*from\s+["']react-dom["'];?/g,
        (_match, named: string) => {
          const names = named.split(',').map((s: string) => s.trim().split(/\s+as\s+/).map((x: string) => x.trim()))
          return names.map(([orig, alias]) =>
            alias ? `const ${alias} = window.ReactDOM.${orig};` : `const ${orig} = window.ReactDOM.${orig};`
          ).join('\n')
        }
      )
      .replace(
        // Match: import { X as Y } from "react-dom/client";
        /import\s*\{([^}]*)\}\s*from\s+["']react-dom\/client["'];?/g,
        (_match, named: string) => {
          const names = named.split(',').map((s: string) => s.trim().split(/\s+as\s+/).map((x: string) => x.trim()))
          return names.map(([orig, alias]) =>
            alias ? `const ${alias} = window.ReactDOM.${orig};` : `const ${orig} = window.ReactDOM.${orig};`
          ).join('\n')
        }
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
    // Surface a more useful diagnostic when the failure was caused
    // by an unrewritten `import` statement surviving the
    // import-to-const transforms above. Otherwise the user just
    // sees the generic "manifest missing" placeholder, which is
    // hard to debug.
    const remainingImports = code.match(/^import\s.*$/gm)
    if (remainingImports && remainingImports.length > 0) {
      console.error(
        `[PluginLoader] Failed to load plugin from ${pluginPath}.`,
        `Residual import statement(s) after rewrite (loader transform is incomplete):`,
        remainingImports,
        'Underlying error:',
        err,
      )
    } else {
      console.error(`[PluginLoader] Failed to load plugin from ${pluginPath}:`, err)
    }
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
 *
/**
 * Plugins are loaded with bounded concurrency to avoid overwhelming
 * the browser's module loader with too many simultaneous `import()`
 * calls from blob URLs. Each import triggers parse → link →
 * evaluate, which is CPU-bound and benefits from not running
 * dozens in parallel.
 *
 * The base concurrency (`LOAD_CONCURRENCY_BASE = 4`) is tuned for
 * a typical mix of small and medium plugins. We scale up slightly
 * for larger install sets because the same wall-clock time can
 * absorb more work in parallel; we cap at 8 because going past
 * that point starts to thrash the V8 module cache and balloon
 * memory. The lower bound is `min(2, items.length)` so we never
 * spin up more workers than there are plugins to load.
 */
const LOAD_CONCURRENCY_BASE = 4
const LOAD_CONCURRENCY_MAX = 8
const LOAD_CONCURRENCY_LARGE_SET = 50

function loadConcurrencyFor(count: number): number {
  if (count <= 1) return count
  if (count >= LOAD_CONCURRENCY_LARGE_SET) return LOAD_CONCURRENCY_MAX
  return LOAD_CONCURRENCY_BASE
}

async function loadWithConcurrency(
  items: PluginMetadataRust[],
  fn: (item: PluginMetadataRust) => Promise<PluginLoadOutcome>,
): Promise<PluginLoadResult> {
  const plugins: PluginDefinition[] = new Array(items.length)
  let nextIdx = 0
  const failureSlots: (PluginLoadFailure | null)[] = new Array(items.length).fill(null)

  // Per-worker loop. Each worker pulls the next index off the
  // shared counter and processes it with the loader function.
  // We use an "allSettled" pattern (per-item try/catch + index
  // slot) so a single broken manifest cannot abort the rest of
  // the batch. The previous implementation was a `Promise.all`
  // over a single `fn` per item; any thrown error would reject
  // the whole batch and the user would see "no plugins" instead
  // of "1 plugin failed, 49 loaded".
  async function worker() {
    while (nextIdx < items.length) {
      const idx = nextIdx++
      try {
        const outcome = await fn(items[idx])
        if (outcome.definition) {
          plugins[idx] = outcome.definition
        }
        if (outcome.failure) {
          failureSlots[idx] = outcome.failure
        }
      } catch (err) {
        // Defensive net: a synchronous throw inside the loader
        // body (e.g. building the placeholder def with a bad
        // iconPosition cast) is treated as a load failure for
        // that plugin only, not for the whole batch.
        const meta = items[idx]
        const reason = err instanceof Error ? `${err.message}` : String(err)
        console.error(`[PluginLoader] Unexpected throw loading plugin ${meta.id}:`, err)
        failureSlots[idx] = {
          id: meta.id,
          name: meta.name,
          reason,
          ts: Date.now(),
          pluginPath: meta.plugin_path,
        }
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(loadConcurrencyFor(items.length), items.length) },
    () => worker(),
  )
  await Promise.all(workers)

  // Compact the per-index slots into dense arrays. We use the
  // dedicated counters (instead of `filter(Boolean)`) so the
  // result preserves the original load order — useful for log
  // readability and stable failure keys across re-scans.
  const densePlugins: PluginDefinition[] = []
  for (let i = 0; i < items.length; i++) {
    const def = plugins[i]
    if (def) densePlugins.push(def)
  }
  const denseFailures: PluginLoadFailure[] = []
  for (let i = 0; i < items.length; i++) {
    const fail = failureSlots[i]
    if (fail) denseFailures.push(fail)
  }
  return { plugins: densePlugins, failures: denseFailures }
}

/**
 * The result of attempting to load a single plugin. Either
 * `definition` is set (with or without `failure`), or the loader
 * decided to omit the def (rare; reserved for future "skip"
 * optimizations). We keep both fields on the same struct so the
 * caller doesn't have to merge two parallel arrays.
 */
interface PluginLoadOutcome {
  definition: PluginDefinition | null
  failure: PluginLoadFailure | null
}

/**
 * Load all plugins: scan metadata from Rust, then load JS modules.
 *
 * Returns a `PluginLoadResult` with both the successfully hydrated
 * `PluginDefinition[]` (including a placeholder "broken plugin"
 * entry for any plugin that failed to load, so the user can still
 * see and uninstall it from the main grid) and a parallel
 * `PluginLoadFailure[]` keyed by plugin id.
 *
 * The implementation uses an "allSettled" pattern internally: a
 * single broken manifest no longer aborts the rest of the batch.
 * The other 49 plugins load normally and the failure surfaces in
 * the top-of-manager warning banner. This is the G2 fix from
 * `.trae/specs/plugin-management-gap-analysis/spec.md`.
 */
export async function loadAllPlugins(
  rustMetas: PluginMetadataRust[]
): Promise<PluginLoadResult> {
  console.log(`[PluginLoader] loadAllPlugins called with ${rustMetas.length} plugins:`, rustMetas.map(m => ({ id: m.id, path: m.plugin_path, iconPos: m.icon_position, enabled: m.enabled })))
  return loadWithConcurrency(rustMetas, async (meta) => {
      // loadPluginModuleWithRef already catches synchronous and
      // async errors and returns `{ manifest: null, module: null }`
      // — we still treat that as a "load failure" so the banner
      // and a placeholder entry are produced.
      const { manifest, module } = await loadPluginModuleWithRef(meta.plugin_path)

      if (manifest) {
        const def = {
          id: meta.id,
          name: manifest.name || meta.name,
          description: manifest.description || meta.description,
          version: manifest.version || meta.version,
          author: manifest.author || meta.author,
          publishedAt: manifest.publishedAt || meta.published_at,
          iconPosition: (manifest.iconPosition ?? meta.icon_position ?? undefined) as PluginDefinition['iconPosition'],
          contentPosition: (manifest.contentPosition ?? meta.content_position ?? undefined) as PluginDefinition['contentPosition'],
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
          // True when the installed plugin ships a `settings.json`
          // schema. The card renders a second Settings button (→
          // PluginSettingsDialog) only when this is set, so the user
          // can edit schema-driven settings even if the plugin
          // author didn't ship a React `settings` component.
          hasSettingsSchema: meta.has_settings_schema,
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
          // Task 13 / G13: command-palette ids contribute to
          // the conflict detector (see `plugin-conflicts.ts`).
          // Pass-through verbatim from the manifest; omitted
          // when the plugin author didn't declare any entries.
          commandPalette: manifest.commandPalette,
        } satisfies PluginDefinition
        attachPluginModule(def, module)
        return { definition: def, failure: null }
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
      const def = {
        id: meta.id,
        name: meta.name,
        description: meta.description,
        version: meta.version,
        author: meta.author,
        publishedAt: meta.published_at,
        iconPosition: (meta.icon_position ?? undefined) as PluginDefinition['iconPosition'],
        contentPosition: (meta.content_position ?? undefined) as PluginDefinition['contentPosition'],
        order: meta.order,
        enabled: meta.enabled,
        icon: () => fallbackIcon,
        panel: () => fallbackPanel,
        pluginPath: meta.plugin_path,
        hasBackend: meta.has_backend,
        permissions: [],
      } satisfies PluginDefinition
      // The placeholder def is returned so the user can see and
      // uninstall the broken package from the main grid. The
      // failure record is what the banner surfaces.
      return {
        definition: def,
        failure: {
          id: meta.id,
          name: meta.name,
          reason:
            'manifest missing or invalid: index.js did not export a valid `manifest` object. ' +
            'The plugin package may be incomplete or corrupted.',
          ts: Date.now(),
          pluginPath: meta.plugin_path,
        },
      }
    })
}
