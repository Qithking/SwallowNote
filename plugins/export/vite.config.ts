import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { copyFileSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'

/** export 插件构建配置：dev 预览 + 生产构建（ES 模块） */
export default defineConfig(({ mode }) => {
  if (mode === 'production') {
    return {
      plugins: [
        react(),
        // 复制 manifest.json 并注入 @swallow-manifest 注释
        {
          name: 'inject-manifest-comment',
          closeBundle() {
            if (!existsSync('dist')) mkdirSync('dist', { recursive: true })

            // 复制 manifest.json
            copyFileSync(
              resolve(__dirname, 'manifest.json'),
              resolve(__dirname, 'dist/manifest.json')
            )

            // 读取 manifest 并注入 @swallow-manifest 注释
            const indexPath = resolve(__dirname, 'dist/index.js')
            const manifestPath = resolve(__dirname, 'manifest.json')

            if (existsSync(indexPath) && existsSync(manifestPath)) {
              const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
              // 构建 scan_plugins 需要的元数据对象
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
          // React 等需 external，使用宿主实例避免多实例冲突
          external: [
            'react', 'react-dom', 'react-dom/client',
            'react/jsx-runtime', 'react/jsx-dev-runtime',
            'sonner', 'react-i18next', 'i18next',
          ],
          // 禁用代码分割，插件加载器用 blob URL 无法解析分块
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
