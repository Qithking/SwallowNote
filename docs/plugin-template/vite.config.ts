import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { copyFileSync, mkdirSync, existsSync } from 'node:fs'

/** 插件模板构建配置：dev 预览 + 生产 ES 模块，React external */
export default defineConfig(({ mode }) => {
  if (mode === 'production') {
    return {
      plugins: [
        react(),
        // 复制 manifest.json 到 dist/
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

