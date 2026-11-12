import { definePluginViteConfig } from '@swallow-note/plugin-kit'

// 公共样板收敛在 plugin-kit；原 SHARED_EXTERNALS（react/blocknote/codemirror
// 全家桶）与端口即 kit 默认值，无需传参
export default definePluginViteConfig()
