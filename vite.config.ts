import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

const host = process.env.TAURI_DEV_HOST

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
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
    rollupOptions: {
      output: {
        // Split large dependencies into separate chunks to reduce per-chunk memory usage
        // and improve caching — unchanged vendor chunks don't need re-downloading
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('mermaid')) return 'vendor-mermaid'
            if (id.includes('shiki')) return 'vendor-shiki'
            if (id.includes('katex')) return 'vendor-katex'
            if (id.includes('markmap') || id.includes('d3-zoom')) return 'vendor-markmap'
            if (id.includes('simple-mind-map')) return 'vendor-mindmap'
            if (id.includes('codemirror') || id.includes('@codemirror')) return 'vendor-codemirror'
            if (id.includes('blocknote')) return 'vendor-blocknote'
            if (id.includes('@radix-ui')) return 'vendor-radix'
            if (id.includes('react-dom')) return 'vendor-react'
            if (id.includes('lucide-react')) return 'vendor-lucide'
            if (id.includes('@mantine')) return 'vendor-mantine'
            if (id.includes('ai-sdk') || id.includes('@ai-sdk')) return 'vendor-ai'
          }
        },
      },
    },
  },
})
