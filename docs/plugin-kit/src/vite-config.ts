import { defineConfig, type UserConfigExport } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

// 通过 window.* 共享宿主依赖，避免重复打包（宿主内置的全家桶对插件永远 external）
export const DEFAULT_EXTERNALS = [
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  // BlockNote 全家桶
  '@blocknote/core',
  '@blocknote/react',
  '@blocknote/mantine',
  '@blocknote/code-block',
  // CodeMirror 全家桶
  'codemirror',
  '@codemirror/state',
  '@codemirror/view',
  '@codemirror/commands',
  '@codemirror/language',
  '@codemirror/autocomplete',
  '@codemirror/search',
]

export interface PluginViteConfigOptions {
  /** 在默认 external 列表之外追加的自定义 external（合并去重） */
  externals?: string[]
  /** 从默认 external 列表中移除的包（外部包将打进 bundle；适用于插件引用的
   * 主项目源码依赖了宿主 loader 未共享的模块，如 codemirror 系） */
  excludeExternals?: string[]
  /** 路径别名（resolve.alias），如 { '@': '../../src' } 需传绝对路径 */
  alias?: Record<string, string>
  /** dev server 端口（默认 5177） */
  port?: number
}

/**
 * 插件工程统一 Vite 配置。
 *
 * 约定：必须在插件工程根目录下运行（vite build / vite dev），
 * manifest.json 位于工程根、入口为 src/index.tsx、产物为 dist/index.js（ESM 单文件）。
 */
export function definePluginViteConfig(options: PluginViteConfigOptions = {}): UserConfigExport {
  // 插件工程根目录 = 运行 vite 的 cwd（原各插件内联配置用 __dirname，kit 化后统一为 cwd）
  const root = process.cwd()
  // 默认 external + 自定义 external 合并去重、再按需剔除，保持首见顺序
  const externals = [...new Set([...DEFAULT_EXTERNALS, ...(options.externals ?? [])])].filter(
    (name) => !(options.excludeExternals ?? []).includes(name)
  )
  // 别名仅在有配置时注入（保持配置对象精简）
  const resolveConfig = options.alias ? { alias: options.alias } : undefined

  return defineConfig(({ mode }) => {
    if (mode === 'production') {
      return {
        plugins: [
          react(),
          {
            // 在产物顶部注入 manifest 注释，供 Rust 端解析
            name: 'inject-manifest-comment',
            closeBundle() {
              if (!existsSync(resolve(root, 'dist'))) mkdirSync(resolve(root, 'dist'), { recursive: true })
              copyFileSync(
                resolve(root, 'manifest.json'),
                resolve(root, 'dist/manifest.json')
              )
              const indexPath = resolve(root, 'dist/index.js')
              const manifestPath = resolve(root, 'manifest.json')
              if (existsSync(indexPath) && existsSync(manifestPath)) {
                const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
                const meta = {
                  id: manifest.id,
                  name: manifest.name,
                  description: manifest.description || '',
                  version: manifest.version || '',
                  author: manifest.author || '',
                  published_at: manifest.publishedAt || '',
                  icon_position: manifest.iconPosition,
                  content_position: manifest.contentPosition,
                  order: manifest.order ?? 100,
                  enabled: manifest.enabled ?? true,
                  has_backend: manifest.hasBackend ?? false,
                  // 未声明时序列化为 undefined 并被 JSON.stringify 省略，
                  // 宿主侧 serde default 为 None（恒兼容）
                  min_host_version: manifest.minHostVersion || undefined,
                }
                const comment = `// @swallow-manifest ${JSON.stringify(meta)}\n`
                const content = readFileSync(indexPath, 'utf-8')
                writeFileSync(indexPath, comment + content)
              }
            },
          },
        ],
        resolve: resolveConfig,
        define: {
          'process.env.NODE_ENV': JSON.stringify('production'),
        },
        build: {
          outDir: 'dist',
          emptyOutDir: true,
          lib: {
            entry: resolve(root, 'src/index.tsx'),
            formats: ['es'],
            fileName: () => 'index.js',
          },
          rollupOptions: {
            external: externals,
            output: {
              inlineDynamicImports: true,
            },
          },
        },
      }
    }
    return {
      plugins: [react()],
      resolve: resolveConfig,
      server: { port: options.port ?? 5177, open: true },
    }
  })
}
