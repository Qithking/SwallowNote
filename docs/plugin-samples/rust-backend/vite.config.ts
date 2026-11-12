import { definePluginViteConfig } from '@swallow-note/plugin-kit'

// 工厂已内置宿主全家桶（react/blocknote/codemirror）为 external；
// 本插件额外共享宿主实例的 sonner / react-i18next / i18next，作为增量传入。
export default definePluginViteConfig({
  externals: ['sonner', 'react-i18next', 'i18next'],
  port: 5173,
})
