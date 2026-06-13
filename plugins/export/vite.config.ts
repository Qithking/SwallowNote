import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { copyFileSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'

/**
 * Export plugin build configuration.
 *
 * Two modes:
 *  - `vite` (dev): runs the standalone preview at http://localhost:5173
 *  - `vite build`: emits `dist/index.js` (ES module) + `dist/manifest.json`
 *    that can be zipped and installed into SwallowNote.
 *
 * Uses ES module format so that the host's `import()` can resolve
 * `module.default` as the plugin manifest object.
 * The host's scan_plugins reads a special comment from index.js to
 * extract plugin metadata (iconPosition, contentPosition, etc.).
 * We inject this comment at the top of the bundle after build.
 */
export default defineConfig(({ mode }) => {
  if (mode === 'production') {
    return {
      plugins: [
        react(),
        // Copy manifest.json → dist/ and inject @swallow-manifest comment
        {
          name: 'inject-manifest-comment',
          closeBundle() {
            if (!existsSync('dist')) mkdirSync('dist', { recursive: true })

            // Copy manifest.json
            copyFileSync(
              resolve(__dirname, 'manifest.json'),
              resolve(__dirname, 'dist/manifest.json')
            )

            // Read manifest.json and inject @swallow-manifest comment
            const indexPath = resolve(__dirname, 'dist/index.js')
            const manifestPath = resolve(__dirname, 'manifest.json')

            if (existsSync(indexPath) && existsSync(manifestPath)) {
              const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
              // Build the metadata object that scan_plugins expects
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
              }
              const comment = `// @swallow-manifest ${JSON.stringify(meta)}\n`
              const content = readFileSync(indexPath, 'utf-8')
              writeFileSync(indexPath, comment + content)
            }
          },
        },
      ],
      define: {
        'process.env.NODE_ENV': JSON.stringify('production'),
      },
      build: {
        outDir: 'dist',
        emptyOutDir: true,
        lib: {
          entry: resolve(__dirname, 'src/index.tsx'),
          formats: ['es'],
          fileName: () => 'index.js',
        },
        rollupOptions: {
          // React and ReactDOM must be external so the plugin uses the
          // host's React instance (exposed as window.React / window.ReactDOM).
          // Bundling a second copy causes "multiple React instances" crashes
          // because hooks rely on a shared internal dispatcher.
          external: [
            'react', 'react-dom', 'react-dom/client',
            'react/jsx-runtime', 'react/jsx-dev-runtime',
            'sonner', 'react-i18next', 'i18next',
          ],
          // Disable code splitting — the plugin loader uses blob URLs
          // which cannot resolve relative chunk imports. Everything must
          // be in a single index.js file.
          output: {
            inlineDynamicImports: true,
          },
        },
      },
    }
  }
  return {
    plugins: [react()],
    server: { port: 5174, open: true },
  }
})
