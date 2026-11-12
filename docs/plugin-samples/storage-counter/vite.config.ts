import { definePluginViteConfig } from '@swallow-note/plugin-kit'

// 样板（react 插件、manifest 注释注入、externals、inlineDynamicImports、
// NODE_ENV define）收敛进 plugin-kit；sonner / react-i18next / i18next
// 为 kit 默认 externals 之外的增量
export default definePluginViteConfig({ externals: ['sonner', 'react-i18next', 'i18next'] })
