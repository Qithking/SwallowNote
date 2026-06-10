import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { copyFileSync, mkdirSync, existsSync } from 'node:fs'

export default defineConfig(({ mode }) => {
  if (mode === 'production') {
    return {
      plugins: [
        react(),
        {
          name: 'copy-manifest',
          closeBundle() {
            if (!existsSync('dist')) mkdirSync('dist', { recursive: true })
            copyFileSync(
              resolve(__dirname, 'manifest.json'),
              resolve(__dirname, 'dist/manifest.json')
            )
          },
        },
      ],
      build: {
        outDir: 'dist',
        emptyOutDir: true,
        lib: {
          entry: resolve(__dirname, 'index.tsx'),
          name: 'SwallowNotePlugin',
          formats: ['iife'],
          fileName: () => 'plugin.js',
        },
        rollupOptions: {
          external: [],
          output: { inlineDynamicImports: true },
        },
      },
    }
  }
  return {
    plugins: [react()],
    server: { port: 5173, open: true },
  }
})
