/**
 * Standalone 预览框（开发用）。
 * 在 mock 宿主壳内渲染 manifest.panel，并补齐 PluginPanelProps 全部必需字段。
 * 打包产物不会引入本文件（库入口为 src/index.tsx）。
 */
import { useEffect, useMemo, useState } from 'react'
import type { ComponentType } from 'react'
import manifest from './index'
import {
  type PluginPanelProps,
  buildPluginContext,
  deleteSecure,
  editor as editorApi,
  emitAppReady,
  files as filesApi,
  getAllSettings,
  getPluginStorage,
  getSecure,
  getSetting,
  listSecureKeys,
  onSettingsChange,
  pluginEventBus,
  runLifecycleHook,
  setSecure,
  setSetting,
} from '@swallow-note/plugin-sdk'

export function Preview() {
  const [active, setActive] = useState(true)
  // mock 宿主上下文：onLoad/onUnmount 等生命周期钩子在预览壳内跑一遍
  const ctx = useMemo(() => buildPluginContext({ id: manifest.id, pluginPath: '' }), [])
  useEffect(() => {
    void runLifecycleHook(manifest.onLoad, ctx)
    void runLifecycleHook(manifest.onMount, ctx)
    return () => {
      void runLifecycleHook(manifest.onUnmount, ctx)
      void runLifecycleHook(manifest.onUnload, ctx)
    }
  }, [ctx])
  // 通知 mock 壳：宿主 API 已就绪
  useEffect(() => { emitAppReady() }, [])

  const panelProps: PluginPanelProps = {
    pluginId: manifest.id,
    isActive: active,
    close: () => setActive(false),
    pendingRequest: null,
    invokeBackend: async (cmd, args) => {
      console.warn('[preview] invokeBackend 内存 mock', cmd, args)
      if (cmd === 'echo') return { message: (args as { message?: unknown })?.message ?? null }
      return null
    },
    invokeBackendStream: async () => new Promise(() => {}),
    store: getPluginStorage(manifest.id),
    events: pluginEventBus,
    activeNoteContent: '',
    activeNotePath: '',
    getSetting,
    setSetting,
    getAllSettings,
    onSettingsChange,
    // frontmatter API 为同步（无活动笔记时返回 null / 空操作）
    getActiveNoteFrontmatter: () => null,
    setActiveNoteFrontmatter: () => {},
    onNoteFrontmatterChanged: () => () => {},
    // SDK 直接导出的编辑器 / 文件 API stub
    editor: editorApi,
    files: filesApi,
    // 由 SDK 散函数组装的安全存储对象（PluginSecureStorage 形状：get/set/delete/keys）
    secureStorage: {
      get: getSecure,
      set: setSecure,
      delete: deleteSecure,
      keys: listSecureKeys,
    },
  }

  const Panel = manifest.panel as ComponentType<PluginPanelProps>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <div style={{ padding: '8px 16px', borderBottom: '1px solid #eee', fontSize: 12, color: '#888' }}>
        Standalone 预览：{manifest.name}（此壳仅本地开发，不在插件包内）
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {active ? <Panel {...panelProps} /> : <p style={{ padding: 16 }}>面板已关闭，刷新页面恢复。</p>}
      </div>
    </div>
  )
}
