/**
 * PluginPermissionPromptHost — 全局插件授权对话框宿主。
 *
 * 消费 pluginPermissionPrompt store 的队列：展示队首插件的授权对话框，
 * 关闭后自动展示下一条。挂载于 App 根部（Radix Dialog 走 portal，
 * 在组件树中的位置不影响布局）。
 *
 * 入队来源：
 *  1. App 启动扫描（collectStartupPermissionPrompts）
 *  2. PluginPermissionGateCard 的"去授权"按钮
 * 复用 PluginManagerView / PluginMarketView 同款的 PluginPermissionDialog。
 */
import { useEffect, useState } from 'react'
import type { PluginPermissionStatus } from '@/types/plugin'
import { getPluginPermissions } from '@/lib/plugin-permissions'
import { usePluginPermissionPromptStore } from '@/stores/pluginPermissionPrompt'
import { PluginPermissionDialog } from './PluginPermissionDialog'

export function PluginPermissionPromptHost(): React.ReactNode {
  const head = usePluginPermissionPromptStore((s) => s.queue[0])
  const dismissPrompt = usePluginPermissionPromptStore((s) => s.dismissPrompt)
  const [permissionStatus, setPermissionStatus] = useState<PluginPermissionStatus[]>([])

  // 队首变化时加载其当前授权状态（与 PluginMarketView 的
  // pendingPermissionGrant 相同的异步加载模式）
  useEffect(() => {
    let cancelled = false
    if (!head) {
      setPermissionStatus([])
      return
    }
    void getPluginPermissions(head.pluginId).then((status) => {
      if (!cancelled) setPermissionStatus(status)
    })
    return () => {
      cancelled = true
    }
  }, [head])

  if (!head) return null

  return (
    <PluginPermissionDialog
      pluginId={head.pluginId}
      pluginName={head.pluginName}
      permissions={head.requested}
      currentStatus={permissionStatus}
      onClose={() => dismissPrompt(head.pluginId)}
    />
  )
}
