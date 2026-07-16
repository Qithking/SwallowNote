import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

const host = process.env.TAURI_DEV_HOST

// 禁止把重依赖的 vendor CSS 在启动 HTML 中预加载；这些 CSS 只在对应 chunk 真正加载时注入。
function removeHeavyVendorCssFromHtml(): Plugin {
  const heavyCssPrefixes = ['vendor-blocknote', 'vendor-markmap', 'vendor-codemirror', 'vendor-katex', 'vendor-ai']
  const regex = new RegExp(
    `<link[^>]+rel=["']stylesheet["'][^>]+href=["'][^"']*(?:${heavyCssPrefixes.join('|')})[^"']*["'][^>]*>`,
    'g'
  )
  return {
    name: 'remove-heavy-vendor-css',
    enforce: 'post',
    transformIndexHtml(html) {
      return html.replace(regex, '')
    },
  }
}

export default defineConfig({
  plugins: [react(), removeHeavyVendorCssFromHtml()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // 宿主直接引用 SDK 源码，确保类型一致
      '@swallow-note/plugin-sdk': path.resolve(__dirname, './docs/plugin-sdk/src/index.ts'),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    outDir: 'build',
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    // 生成 rollup metafile 用于 bundle 依赖分析
    metafile: true,
    // 降低 CI 构建内存压力
    chunkSizeWarningLimit: 1000,
    // 让 GC 更积极，避免 OOM
    reportCompressedSize: false,
    // 禁止把大依赖的 vendor chunk 在启动时通过 modulepreload 拉取；
    // 它们只在使用对应编辑器/功能时按需加载。
    modulePreload: {
      resolveDependencies(filename, deps, context) {
        if (context.hostType !== 'html') return deps
        const heavyVendors = ['vendor-blocknote', 'vendor-markmap', 'vendor-codemirror', 'vendor-katex', 'vendor-ai']
        return deps.filter((dep) => !heavyVendors.some((prefix) => dep.includes(prefix)))
      },
    },
    rollupOptions: {
      output: {
        // 拆分大依赖为独立 chunk，降低内存并改善缓存
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // 合并 shiki/mantine 到 blocknote（循环依赖）
            if (id.includes('blocknote') || id.includes('shiki') || id.includes('@shikijs') || id.includes('@mantine')) return 'vendor-blocknote'
            // 合并 mermaid 到 markmap（共享 d3-zoom）
            if (id.includes('markmap') || id.includes('d3-zoom') || id.includes('mermaid')) return 'vendor-markmap'
            if (id.includes('katex')) return 'vendor-katex'
            if (id.includes('simple-mind-map')) return 'vendor-mindmap'
            if (id.includes('codemirror') || id.includes('@codemirror')) return 'vendor-codemirror'
            if (id.includes('@radix-ui')) return 'vendor-radix'
            if (id.includes('react-dom')) return 'vendor-react'
            if (id.includes('lucide-react')) return 'vendor-lucide'
            if (id.includes('ai-sdk') || id.includes('@ai-sdk')) return 'vendor-ai'
          }
        },
      },
    },
  },
})
