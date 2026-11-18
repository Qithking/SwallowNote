/** 密盘插件入口：manifest.json 单一来源 + 运行时字段注入 */
/* eslint-disable react-refresh/only-export-components */
import { definePlugin } from '@swallow-note/plugin-sdk'
export { setHost } from '@swallow-note/plugin-sdk'
import manifestJson from '../manifest.json'
import { SecretDiskIcon } from './icons'
import { SecretDiskPanel } from './SecretDiskPanel'

// onLoad hook（flat 结构）：即使为空也触发 runPluginLifecycleHook 执行 setHost，
// 使 SDK 的 openEditorTab 等 API 能转发到宿主实现（P2 B2 将消除该怪癖）
export default definePlugin(manifestJson, {
  icon: SecretDiskIcon,
  panel: SecretDiskPanel,
  onLoad: () => { /* no-op, 仅用于触发 setHost 安装 host overrides */ },
})
