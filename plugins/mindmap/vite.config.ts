import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { copyFileSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'

export default defineConfig(({ mode }) => {
  if (mode === 'production') {
    return {
      plugins: [
        react(),
        {
          name: 'inject-manifest-comment',
          closeBundle() {
            if (!existsSync('dist')) mkdirSync('dist', { recursive: true })
            copyFileSync(
              resolve(__dirname, 'manifest.json'),
              resolve(__dirname, 'dist/manifest.json')
            )
            const indexPath = resolve(__dirname, 'dist/index.js')
            const manifestPath = resolve(__dirname, 'manifest.json')
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
          external: [
            'react', 'react-dom', 'react-dom/client',
            'react/jsx-runtime', 'react/jsx-dev-runtime',
          ],
          output: {
            inlineDynamicImports: true,
          },
        },
      },
    }
  }
  return {
    plugins: [react()],
    server: { port: 5176, open: true },
  }
})
