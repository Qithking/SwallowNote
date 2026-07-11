/** 插件宿主 API 的 React hook 兼容层（薄封装 SDK） */
import type { PluginCommand, PluginEvent, PluginEventPayloadMap } from '@/types/plugin'
import {
  usePluginStorage as sdkUsePluginStorage,
  usePluginEvent as sdkUsePluginEvent,
  usePluginEvents as sdkUsePluginEvents,
  usePluginServices as sdkUsePluginServices,
  type PluginPanelProps,
  type PluginEventBus,
} from '@swallow-note/plugin-sdk'
import { useEffect, useState } from 'react'
import {
  listPluginCommands,
  subscribePluginCommands,
} from './plugin-commands'

export const usePluginStorage = sdkUsePluginStorage
export const usePluginEvent = sdkUsePluginEvent
export const usePluginServices = sdkUsePluginServices

/** 包装以保留宿主严格的 (event, payload) 签名 */
export function usePluginEvents<E extends PluginEvent>(
  panel: PluginPanelProps,
  events: readonly E[],
  handler: (event: E, payload: PluginEventPayloadMap[E]) => void
): void {
  // SDK 用 unknown payload，宿主签名是泛型收窄包装
  sdkUsePluginEvents(
    panel,
    events,
    handler as unknown as (event: E, payload: unknown) => void
  )
}

// 命令面板 hook（仅宿主）

/** 已注册插件命令的实时快照（订阅注册表变更） */
export function usePluginCommands(): PluginCommand[] {
  const [commands, setCommands] = useState<PluginCommand[]>(() =>
    listPluginCommands()
  )

  useEffect(() => {
    const refresh = () => {
      const next = listPluginCommands().filter((cmd) => {
        if (cmd.when) {
          try {
            return cmd.when()
          } catch {
            return true
          }
        }
        return true
      })
      setCommands(next)
    }
    refresh()
    return subscribePluginCommands(refresh)
  }, [])

  return commands
}

// 类型再导出，保持现有导入可用
export type { PluginPanelProps, PluginEventBus }
