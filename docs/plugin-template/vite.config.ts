import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { copyFileSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'

/** 插件模板构建配置：dev 预览 + 生产 ES 模块，React external */
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
              resolve(__dirname, 'src/plugin/manifest.json'),
              resolve(__dirname, 'dist/manifest.json')
            )
            // 注入 // @swallow-manifest 注释到 index.js 头部，供 Rust 端解析插件元数据
            const indexPath = resolve(__dirname, 'dist/index.js')
            const manifestPath = resolve(__dirname, 'src/plugin/manifest.json')
            if (existsSync(indexPath) && existsSync(manifestPath)) {
              const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
              // snake_case 字段名匹配 Rust 端 PluginMetadataRust
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
          entry: resolve(__dirname, 'src/plugin/index.tsx'),
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
          output: {
            // 禁用代码分割，blob URL 无法解析分块
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

