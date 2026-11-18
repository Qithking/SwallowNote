import { resolve } from 'node:path'
import { definePluginViteConfig } from '@swallow-note/plugin-kit'

// 允许插件通过 @ 别名引用主项目源码（shadcn/ui 组件等）
const SRC_ALIAS = { '@': resolve(__dirname, '../../src') }

// @/ 引入的 CodeEditor 依赖 codemirror 系模块，宿主 loader 不共享这些模块，
// 必须从 kit 默认 external 中排除、打进 bundle（行为与旧内联配置一致）
const CODEMIRROR_PKGS = [
  'codemirror',
  '@codemirror/state',
  '@codemirror/view',
  '@codemirror/commands',
  '@codemirror/language',
  '@codemirror/autocomplete',
  '@codemirror/search',
]

export default definePluginViteConfig({
  alias: SRC_ALIAS,
  externals: ['sonner', 'react-i18next', 'i18next'],
  excludeExternals: CODEMIRROR_PKGS,
})
