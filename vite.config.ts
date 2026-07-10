import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

const host = process.env.TAURI_DEV_HOST

export default defineConfig({
  plugins: [react()],
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
    // 降低 CI 构建内存压力
    chunkSizeWarningLimit: 1000,
    // 让 GC 更积极，避免 OOM
    reportCompressedSize: false,
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
