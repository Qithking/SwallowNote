/** AI 助手插件入口：manifest 静态字段 + 运行时字段组装 */
/* eslint-disable react-refresh/only-export-components */
import type { PluginManifest, PluginPanelProps } from '@swallow-note/plugin-sdk'
export { setHost } from '@swallow-note/plugin-sdk'
import { useMemo } from 'react'
import { Sparkles } from 'lucide-react'
import { ChatPanel } from './chat/ChatPanel'
import type { AiServices } from './chat/hooks'
import { registerRoleActions, registerFileTreeAction } from './actions/registerActions'
import manifestJson from '../manifest.json'

/** 标题栏入口图标 */
function AiIcon({ size = 16 }: { size?: number }) {
  return <Sparkles size={size} />
}

/** 右侧对话面板：面板 props 注入服务（invokeBackend / invokeBackendStream / secureStorage） */
function AiPanel(props: PluginPanelProps) {
  // memo：宿主每次渲染会重建 props 函数，必须保持 services 引用稳定，
  // 否则 ChatPanel 内依赖 services 的初始化 effect 会无限重跑
  const services = useMemo<AiServices>(
    () => ({
      // SDK 的 invokeBackend 非泛型，这里转发为 hooks 需要的泛型签名
      invokeBackend: <T,>(command: string, args?: Record<string, unknown>) =>
        props.invokeBackend(command, args) as Promise<T>,
      invokeBackendStream: props.invokeBackendStream,
      secureStorage: props.secureStorage,
    }),
    [props.invokeBackend, props.invokeBackendStream, props.secureStorage],
  )
  return <ChatPanel services={services} pendingRequest={props.pendingRequest} />
}

const manifest = {
  ...manifestJson,
  icon: AiIcon,
  panel: AiPanel,
  // onLoad hook（flat 结构，不是嵌套在 hooks 里）：
  // 即使为空也触发 runPluginLifecycleHook 执行 setHost，
  // 使 SDK 的 openEditorTab 等 API 能转发到宿主实现
  onLoad: () => {
    // 注册编辑器右键 9 角色动作 + 文件树「添加到 AI 对话」（context-menu/files 权限；插件禁用/卸载时宿主自动清理）
    registerRoleActions()
    registerFileTreeAction()
  },
} as PluginManifest

export default manifest
