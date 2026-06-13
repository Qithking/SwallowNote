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
      define: {
        'process.env.NODE_ENV': JSON.stringify('production'),
      },
      build: {
        outDir: 'dist',
        emptyOutDir: true,
        lib: {
          entry: resolve(__dirname, 'index.tsx'),
          formats: ['es'],
          fileName: () => 'index.js',
        },
        rollupOptions: {
          // React and ReactDOM must be external so the plugin uses the
          // host's React instance (exposed as window.React / window.ReactDOM).
          // Bundling a second copy causes "multiple React instances" crashes
          // because hooks rely on a shared internal dispatcher.
          // sonner / react-i18next / i18next are also provided by the host
          // as window.SonnerToast / window.ReactI18Next.
          external: [
            'react', 'react-dom', 'react-dom/client',
            'react/jsx-runtime', 'react/jsx-dev-runtime',
            'sonner', 'react-i18next', 'i18next',
          ],
          output: {
            // Disable code splitting — the plugin loader uses blob URLs
            // which cannot resolve relative chunk imports.
            inlineDynamicImports: true,
          },
        },
      },
    }
  }
  return {
    plugins: [react()],
    server: { port: 5173, open: true },
  }
})
