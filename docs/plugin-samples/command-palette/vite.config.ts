import { definePluginViteConfig } from '@swallow-note/plugin-kit'

// external 增量：sonner / react-i18next / i18next 为宿主内置依赖，
// 其余（react 全家桶等）由 kit 的 DEFAULT_EXTERNALS 兜底
export default definePluginViteConfig({ externals: ['sonner', 'react-i18next', 'i18next'] })
