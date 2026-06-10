import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { copyFileSync, mkdirSync, existsSync } from 'node:fs'

/**
 * Two modes:
 *  - `vite` (dev): runs the standalone preview at http://localhost:5173
 *  - `vite build`: emits a library bundle `dist/plugin.js` (IIFE) +
 *    `dist/manifest.json` that you can upload to SwallowNote.
 */
export default defineConfig(({ mode }) => {
  if (mode === 'production') {
    return {
      plugins: [
        react(),
        // Copy manifest.json from src/plugin/ → dist/ after build
        {
          name: 'copy-manifest',
          closeBundle() {
            if (!existsSync('dist')) mkdirSync('dist', { recursive: true })
            copyFileSync(
              resolve(__dirname, 'src/plugin/manifest.json'),
              resolve(__dirname, 'dist/manifest.json')
            )
          },
        },
      ],
      build: {
        outDir: 'dist',
        emptyOutDir: true,
        lib: {
          entry: resolve(__dirname, 'src/plugin/index.tsx'),
          name: 'SwallowNotePlugin',
          formats: ['iife'],
          fileName: () => 'plugin.js',
        },
        rollupOptions: {
          // Treat the SDK as a single bundle for predictable output
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

