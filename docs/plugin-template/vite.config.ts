import { definePluginViteConfig } from '@swallow-note/plugin-kit'

/**
 * 统一插件构建配置（kit 工厂）：
 * - 生产：library mode 单文件 dist/index.js + dist/manifest.json + @swallow-manifest 注入
 * - dev：独立预览（端口 5173）
 * sonner / react-i18next / i18next 使用宿主实例，保持 external。
 */
export default definePluginViteConfig({
  externals: ['sonner', 'react-i18next', 'i18next'],
  port: 5173,
})
