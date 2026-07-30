/** 插件加载器：从磁盘加载插件包。 */
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
import { logger } from './logger'
import i18n from '@/i18n'

/** Rust 元数据转前端元数据 */
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
    source: meta.source,
  }
}

/** Blob URL 缓存：mtime 未变则复用，避免重复加载。 */
const pluginBlobUrlCache = new Map<string, { blobUrl: string; mtime: string }>()
/** 并发加载去重：同一 pluginPath 的并发调用复用同一个 Promise，避免竞态 */
const pluginLoadInFlight = new Map<string, Promise<{ manifest: PluginManifest | null; module: Record<string, unknown> | null; error?: string }>>()

/** 释放插件 blob URL 并移除缓存 */
export function dropPluginBlobUrl(pluginPath: string): void {
  const cached = pluginBlobUrlCache.get(pluginPath)
  if (!cached) return
  // 先 revoke 释放底层 Blob 内存，再删除缓存条目
  URL.revokeObjectURL(cached.blobUrl)
  pluginBlobUrlCache.delete(pluginPath)
}

/** 通过 Tauri asset 协议动态加载插件 index.js。 */
export async function loadPluginModule(pluginPath: string): Promise<PluginManifest | null> {
  const { manifest } = await loadPluginModuleWithRef(pluginPath)
  return manifest
}

/** 返回 manifest 与模块引用，供 host takeover 调用 setHost。 */
async function loadPluginModuleWithRef(
  pluginPath: string
): Promise<{ manifest: PluginManifest | null; module: Record<string, unknown> | null; error?: string }> {
  // 并发去重：同一 pluginPath 的并发调用复用同一个 Promise
  const inFlight = pluginLoadInFlight.get(pluginPath)
  if (inFlight) return inFlight
  const promise = loadPluginModuleWithRefInner(pluginPath).finally(() => {
    pluginLoadInFlight.delete(pluginPath)
  })
  pluginLoadInFlight.set(pluginPath, promise)
  return promise
}

async function loadPluginModuleWithRefInner(
  pluginPath: string
): Promise<{ manifest: PluginManifest | null; module: Record<string, unknown> | null; error?: string }> {
  let code = ''
  try {
    const indexJsPath = `${pluginPath}/index.js`

    // hidden 目录走 Rust 命令读取后转 blob URL
    const { readFile, getFileMetadata } = await import('@/lib/tauri')

    // 获取 mtime 判断是否复用缓存，失败降级新建
    let currentMtime: string | undefined
    try {
      currentMtime = (await getFileMetadata(indexJsPath)).modified_time
    } catch {
      // mtime 不可用时跳过缓存复用
    }

    const cached = currentMtime ? pluginBlobUrlCache.get(pluginPath) : undefined
    if (cached && currentMtime && cached.mtime === currentMtime) {
      try {
        const module = (await import(/* @vite-ignore */ cached.blobUrl)) as Record<string, unknown>
        const manifest = (module.default || module.manifest || null) as PluginManifest | null
        if (import.meta.env.DEV) {
          logger.info('plugin-loader', `Reused cached blob URL for ${pluginPath} (mtime unchanged)`)
        }
        if (!manifest) {
          logger.warn('plugin-loader', `No manifest found in module from ${pluginPath}`)
        }
        return { manifest, module }
      } catch {
        URL.revokeObjectURL(cached.blobUrl)
        pluginBlobUrlCache.delete(pluginPath)
        // 落入下方完整加载流程
      }
    }

    code = await readFile(indexJsPath)

    if (import.meta.env.DEV) {
      logger.info('plugin-loader', `Read ${indexJsPath}: ${code.length} chars, hasReactImport: ${code.includes('from "react"')}, hasBundledReact: ${code.includes('__SECRET_INTERNALS')}`)
    }

    // 检测插件是否打包独立 React 实例，避免运行时冲突
    const hasReactExternalImport =
      code.includes('from "react"') || code.includes("from 'react'") ||
      code.includes('from "react/jsx-runtime"') || code.includes("from 'react/jsx-runtime'") ||
      code.includes('from "react/jsx-dev-runtime"') || code.includes("from 'react/jsx-dev-runtime'")
    const hasBundledReact = code.includes('react.production.min.js') ||
      code.includes('react.development.js') ||
      (code.includes('__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED') &&
       !hasReactExternalImport)
    if (hasBundledReact) {
      const errMsg = `Plugin bundles its own copy of React (react/react-dom must be externalized). Please rebuild the plugin with react/react-dom as external dependencies.`
      logger.error('plugin-loader', `Plugin at ${pluginPath} bundles its own React, which causes hook crashes. The plugin must be rebuilt with react/react-dom as external dependencies.`)
      return { manifest: null, module: null, error: errMsg }
    }

    // Vite 未替换 process.env.NODE_ENV 时注入 polyfill
    if (code.includes('process.env')) {
      code = 'var process=process||{env:{NODE_ENV:"production"}};\n' + code
    }

    // 将 react/react-dom/jsx-runtime 的 import 替换为 window 全局
    code = code
      .replace(
        // Match: import X, { ... } from "react";
        /import\s+([$_a-zA-Z][$_a-zA-Z0-9]*)\s*,\s*\{([^}]*)\}\s*from\s*["']react["'];?/g,
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
        /import\s+([$_a-zA-Z][$_a-zA-Z0-9]*)\s+from\s+["']react["'];?/g,
        'const $1 = window.React;'
      )
      .replace(
        // Match: import * as X from "react";
        /import\s*\*\s*as\s+([$_a-zA-Z][$_a-zA-Z0-9]*)\s+from\s+["']react["'];?/g,
        'const $1 = window.React;'
      )
      .replace(
        // 覆盖 { X as Y } 别名导入
        /import\s*\{([^}]*)\}\s*from\s+["']react["'];?/g,
        (_match, named: string) => {
          const names = named.split(',').map((s: string) => s.trim().split(/\s+as\s+/).map((x: string) => x.trim()))
          return names.map(([orig, alias]) =>
            alias ? `const ${alias} = window.React.${orig};` : `const ${orig} = window.React.${orig};`
          ).join('\n')
        }
      )
      .replace(
        /import\s+([$_a-zA-Z][$_a-zA-Z0-9]*)\s+from\s+["']react-dom\/client["'];?/g,
        'const $1 = window.ReactDOM;'
      )
      .replace(
        /import\s+([$_a-zA-Z][$_a-zA-Z0-9]*)\s+from\s+["']react-dom["'];?/g,
        'const $1 = window.ReactDOM;'
      )
      .replace(
        // Match: import * as X from "react-dom/client";
        /import\s*\*\s*as\s+([$_a-zA-Z][$_a-zA-Z0-9]*)\s+from\s+["']react-dom\/client["'];?/g,
        'const $1 = window.ReactDOM;'
      )
      .replace(
        // Match: import * as X from "react-dom";
        /import\s*\*\s*as\s+([$_a-zA-Z][$_a-zA-Z0-9]*)\s+from\s+["']react-dom["'];?/g,
        'const $1 = window.ReactDOM;'
      )
      .replace(
        // 覆盖 react-dom 命名导出（如 createPortal）
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
        /import\s+([$_a-zA-Z][$_a-zA-Z0-9]*)\s+from\s+["']react\/jsx-runtime["'];?/g,
        'const $1 = window.ReactJSXRuntime;'
      )
      .replace(
        // Match: import * as X from "react/jsx-runtime";
        /import\s*\*\s*as\s+([$_a-zA-Z][$_a-zA-Z0-9]*)\s+from\s+["']react\/jsx-runtime["'];?/g,
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
        /import\s+([$_a-zA-Z][$_a-zA-Z0-9]*)\s+from\s+["']react\/jsx-dev-runtime["'];?/g,
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
        /import\s+([$_a-zA-Z][$_a-zA-Z0-9]*)\s+from\s+["']react-i18next["'];?/g,
        'const $1 = window.ReactI18Next;'
      )
      .replace(
        // Match: import X from "i18next";
        /import\s+([$_a-zA-Z][$_a-zA-Z0-9]*)\s+from\s*["']i18next["'];?/g,
        'const $1 = window.ReactI18Next;'
      )

    if (import.meta.env.DEV) {
      logger.info('plugin-loader', `After transform: ${code.length} chars, still hasReactImport: ${code.includes('from "react"')}, first 300 chars:`, code.substring(0, 300))
    }

    const blob = new Blob([code], { type: 'application/javascript' })
    const blobUrl = URL.createObjectURL(blob)

    // 缓存新 blobUrl，revoke 旧缓存
    if (currentMtime) {
      const old = pluginBlobUrlCache.get(pluginPath)
      if (old) URL.revokeObjectURL(old.blobUrl)
      pluginBlobUrlCache.set(pluginPath, { blobUrl, mtime: currentMtime })
    }

    let module: Record<string, unknown>
    try {
      module = (await import(/* @vite-ignore */ blobUrl)) as Record<string, unknown>
    } catch (err) {
      // import 失败时清除缓存
      if (currentMtime) pluginBlobUrlCache.delete(pluginPath)
      URL.revokeObjectURL(blobUrl)
      throw err
    }
    // mtime 不可用时未缓存，import 成功后立即 revoke 释放内存
    if (!currentMtime) {
      URL.revokeObjectURL(blobUrl)
    }

    if (import.meta.env.DEV) {
      logger.info('plugin-loader', `Loaded module from ${pluginPath}`, {
        keys: Object.keys(module),
        hasDefault: 'default' in module,
        defaultType: typeof module.default,
      })
    }
    const manifest = (module.default || module.manifest || null) as PluginManifest | null
    if (manifest) {
      if (import.meta.env.DEV) {
        logger.info('plugin-loader', `Manifest for ${manifest.id}:`, {
          iconPosition: manifest.iconPosition,
          contentPosition: manifest.contentPosition,
          hasToolbarButton: !!manifest.toolbarButton,
          hasIcon: !!manifest.icon,
          hasPanel: !!manifest.panel,
        })
      }
    } else {
      logger.warn('plugin-loader', `No manifest found in module from ${pluginPath}`)
    }
    return { manifest, module }
  } catch (err) {
    // 未重写的 import 失败时给出更明确的诊断
    const remainingImports = code.match(/^import\s.*$/gm)
    const errMsg = err instanceof Error ? err.message : String(err)
    let detailMsg = errMsg
    if (remainingImports && remainingImports.length > 0) {
      logger.error(
        'plugin-loader',
        `Failed to load plugin from ${pluginPath}.`,
        `Residual import statement(s) after rewrite (loader transform is incomplete):`,
        remainingImports,
        'Underlying error:',
        err,
      )
      detailMsg = `Residual import statement(s) after rewrite: ${remainingImports.join(', ')}\nUnderlying error: ${errMsg}`
    } else {
      logger.error('plugin-loader', `Failed to load plugin from ${pluginPath}:`, err)
    }
    return { manifest: null, module: null, error: detailMsg }
  }
}

/** 以 non-enumerable 字段保存模块引用供 host takeover 调用 setHost。 */
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

/** 扫描元数据并有限并发加载所有插件。 */
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

  // allSettled 模式：单个失败不影响其他
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
        // 同步 throw 视为单插件失败
        const meta = items[idx]
        const reason = err instanceof Error ? `${err.message}` : String(err)
        logger.error('plugin-loader', `Unexpected throw loading plugin ${meta.id}:`, err)
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

  // 用计数器收集结果以保持原始顺序
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

/** 单插件加载结果 */
interface PluginLoadOutcome {
  definition: PluginDefinition | null
  failure: PluginLoadFailure | null
}

/** 加载全部插件：扫描元数据并加载 JS 模块 */
export async function loadAllPlugins(
  rustMetas: PluginMetadataRust[]
): Promise<PluginLoadResult> {
  if (import.meta.env.DEV) {
    logger.info('plugin-loader', `loadAllPlugins called with ${rustMetas.length} plugins:`, rustMetas.map(m => ({ id: m.id, path: m.plugin_path, iconPos: m.icon_position, enabled: m.enabled })))
  }
  return loadWithConcurrency(rustMetas, async (meta) => {
      // manifest 为 null 时按加载失败处理
      const { manifest, module, error } = await loadPluginModuleWithRef(meta.plugin_path)

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
          // .disabled 标记优先于 manifest
          enabled: meta.enabled,
          icon: manifest.icon,
          panel: manifest.panel,
          // 自定义工具栏按钮，覆盖默认图标
          toolbarButton: manifest.toolbarButton,
          // 设置对话框组件，未声明时为 undefined
          settings: manifest.settings,
          pluginPath: meta.plugin_path,
          hasBackend: meta.has_backend,
          // 是否随附 settings.json schema
          hasSettingsSchema: meta.has_settings_schema,
          permissions: manifest.permissions ?? [],
          // 挂载生命周期钩子，未定义时为 undefined
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
          // 命令面板 id 透传给冲突检测器
          commandPalette: manifest.commandPalette,
          source: meta.source,
        } satisfies PluginDefinition
        attachPluginModule(def, module)
        return { definition: def, failure: null }
      }
      // 无效 manifest 时返回占位组件
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
          createElement('strong', null, i18n.t('pluginLoader.manifestMissing')),
        ),
        createElement(
          'p',
          null,
          i18n.t('pluginLoader.manifestInvalidPrefix', { id: meta.id }),
          createElement('code', null, 'index.js'),
          i18n.t('pluginLoader.manifestInvalidMiddle'),
          createElement('code', null, 'manifest'),
          i18n.t('pluginLoader.manifestInvalidSuffix'),
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
        source: meta.source,
      } satisfies PluginDefinition
      // 返回占位定义，便于卸载损坏插件
      const baseReason = i18n.t('pluginLoader.manifestInvalidBase')
      const reason = error ? `${baseReason}\n\n${i18n.t('pluginLoader.underlyingError', { error })}` : baseReason
      return {
        definition: def,
        failure: {
          id: meta.id,
          name: meta.name,
          reason,
          ts: Date.now(),
          pluginPath: meta.plugin_path,
        },
      }
    })
}
