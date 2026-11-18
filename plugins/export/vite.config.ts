import { definePluginViteConfig } from '@swallow-note/plugin-kit'

// 宿主不内置的依赖（toast / i18n）按插件增量声明 external，经 window.*
// 共享宿主提供同名模块，避免重复打包
export default definePluginViteConfig({
  externals: ['sonner', 'react-i18next', 'i18next'],
})
