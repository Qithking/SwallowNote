/** AI 助手插件入口：manifest 静态字段 + 运行时字段组装 */
/* eslint-disable react-refresh/only-export-components */
import type { PluginManifest, PluginPanelProps } from '@swallow-note/plugin-sdk'
export { setHost } from '@swallow-note/plugin-sdk'
import { Sparkles } from 'lucide-react'
import manifestJson from '../manifest.json'

/** 标题栏入口图标 */
function AiIcon({ size = 16 }: { size?: number }) {
  return <Sparkles size={size} />
}

/** 右侧对话面板（P2.1 骨架阶段为空面板，P2.3 起填充对话层） */
function AiPanel(_props: PluginPanelProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        height: '100%',
        padding: 24,
        color: 'var(--text-secondary, #6e6e73)',
        fontSize: 13,
        textAlign: 'center',
      }}
    >
      <Sparkles size={28} />
      <strong style={{ fontSize: 15, color: 'var(--text-primary, #1d1d1f)' }}>AI 助手</strong>
      <p style={{ margin: 0 }}>骨架已就绪，对话功能将在后续阶段实现。</p>
    </div>
  )
}

const manifest = {
  ...manifestJson,
  icon: AiIcon,
  panel: AiPanel,
  // onLoad hook（flat 结构，不是嵌套在 hooks 里）：
  // 即使为空也触发 runPluginLifecycleHook 执行 setHost，
  // 使 SDK 的 openEditorTab 等 API 能转发到宿主实现
  onLoad: () => { /* no-op, 仅用于触发 setHost 安装 host overrides */ },
} as PluginManifest

export default manifest
