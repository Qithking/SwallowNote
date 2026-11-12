import { definePluginViteConfig } from '@swallow-note/plugin-kit'

// 宿主不内置的 toast 依赖按插件增量声明 external，经 window.* 共享宿主
// 提供的 sonner 模块，避免重复打包
export default definePluginViteConfig({
  externals: ['sonner'],
})
