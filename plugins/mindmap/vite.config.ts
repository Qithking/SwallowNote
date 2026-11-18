import { definePluginViteConfig } from '@swallow-note/plugin-kit'

// 公共样板收敛在 plugin-kit；react 全家桶 external 与端口即 kit 默认值，
// 无需传参（simple-mind-map 是插件自带依赖，打进 bundle）
export default definePluginViteConfig()
