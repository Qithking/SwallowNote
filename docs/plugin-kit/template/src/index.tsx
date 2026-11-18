/** __PLUGIN_NAME__ 插件入口：manifest 静态字段 + 运行时字段组装 */
import { useState } from 'react'
import type { PluginManifest, PluginPanelProps } from '@swallow-note/plugin-sdk'
export { setHost } from '@swallow-note/plugin-sdk'
import manifestJson from '../manifest.json'

/** 侧栏图标（宿主按 iconPosition 渲染） */
function PluginIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.5" y="1.5" width="13" height="13" rx="3.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="8" cy="8" r="2.5" fill="currentColor" />
    </svg>
  )
}

/** 最小面板示例：演示 props 注入与后端调用（前端型工程由宿主返回错误提示） */
function PluginPanel(props: PluginPanelProps) {
  const [reply, setReply] = useState('')
  const ping = async () => {
    const res = (await props.invokeBackend('echo', { message: 'ping' })) as { message?: unknown } | null
    setReply(res ? JSON.stringify(res, null, 2) : '（无响应：本工程未启用 Rust 后端）')
  }
  return (
    <div style={{ padding: 16, fontSize: 13, lineHeight: 1.6 }}>
      <h2 style={{ marginTop: 0 }}>Hello, __PLUGIN_NAME__</h2>
      <p>面板 props 提供 store / events / invokeBackend 等宿主能力。</p>
      <button onClick={ping}>调用后端 echo</button>
      {reply && <pre style={{ background: '#f5f5f7', padding: 8, borderRadius: 6 }}>{reply}</pre>}
    </div>
  )
}

const manifest = {
  ...manifestJson,
  icon: PluginIcon,
  panel: PluginPanel,
  // 空 hook 也保留：宿主会执行 runPluginLifecycleHook，触发 setHost 安装宿主桥接
  onLoad: () => {},
} as PluginManifest

export default manifest
