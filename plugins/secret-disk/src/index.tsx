/** 密盘插件入口：manifest 静态字段 + 运行时字段组装 */
/* eslint-disable react-refresh/only-export-components */
import type { PluginManifest } from '@swallow-note/plugin-sdk'
export { setHost } from '@swallow-note/plugin-sdk'
import manifestJson from '../manifest.json'
import { SecretDiskIcon } from './icons'
import { SecretDiskPanel } from './SecretDiskPanel'

const manifest = {
  ...manifestJson,
  icon: SecretDiskIcon,
  panel: SecretDiskPanel,
  // onLoad hook（flat 结构，不是嵌套在 hooks 里）：
  // 即使为空也触发 runPluginLifecycleHook 执行 setHost，
  // 使 SDK 的 openEditorTab 等 API 能转发到宿主实现
  onLoad: () => { /* no-op, 仅用于触发 setHost 安装 host overrides */ },
} as PluginManifest

export default manifest
