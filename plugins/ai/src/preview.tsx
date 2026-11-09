/**
 * Standalone 预览框（开发用）。
 *
 * 在 mock 宿主壳内渲染 manifest.panel，并补齐 PluginPanelProps
 * 全部必需字段。打包产物不会引入本文件（库入口为 src/index.tsx）。
 */
import { useEffect, useMemo, useState } from 'react'
import type { ComponentType, CSSProperties } from 'react'
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

// ───────────────────────────── 样式 ────────────────────────────────────────

const shellStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100vh',
  background: '#f5f5f7',
}
const headerStyle: CSSProperties = {
  padding: '10px 16px',
  borderBottom: '1px solid #d2d2d7',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  fontSize: 13,
  background: '#fff',
}
const panelWrapStyle: CSSProperties = { flex: 1, overflow: 'auto' }

// ───────────────────────── Preview 组件 ─────────────────────────────────────

export function Preview() {
  const [active, setActive] = useState(true)

  // 生命周期：加载 / 挂载 / 卸载（与宿主行为对齐）
  const ctx = useMemo(() => buildPluginContext({ id: manifest.id, pluginPath: '' }), [])
  useEffect(() => {
    void runLifecycleHook(manifest.onLoad, ctx)
    void runLifecycleHook(manifest.onMount, ctx)
    return () => {
      void runLifecycleHook(manifest.onUnmount, ctx)
      void runLifecycleHook(manifest.onUnload, ctx)
    }
  }, [ctx])

  // App ready 一次性信号
  useEffect(() => {
    emitAppReady()
  }, [])

  // 组装 panelProps——补齐 PluginPanelProps 全部必需字段；
  // standalone 下写 API 走 SDK 内置 stub（warn 后丢弃）
  const panelProps = useMemo<PluginPanelProps>(() => ({
    pluginId: manifest.id,
    isActive: active,
    close: () => setActive(false),
    // standalone 无 openPluginPanel 请求
    pendingRequest: null,
    invokeBackend: async (cmd, args) => {
      console.warn('[preview] invokeBackend 后端未接入，调用被丢弃', cmd, args)
      return null
    },
    invokeBackendStream: async <T, R>(_cmd: string, _args?: Record<string, unknown>, _onChunk?: (chunk: T) => void) => {
      console.warn('[preview] invokeBackendStream 后端未接入，调用被丢弃')
      // 永不 resolve 的占位：standalone 无流式后端
      return new Promise<R>(() => {})
    },
    store: getPluginStorage(manifest.id),
    events: pluginEventBus,
    activeNoteContent: '',
    activeNotePath: '',
    // 模块级 settings API 已隐式绑定当前插件（standalone 用 stub 缓存兜底）
    getSetting: (key: string) => getSetting(key),
    setSetting: (key: string, value: unknown) => setSetting(key, value),
    getAllSettings: () => getAllSettings(),
    onSettingsChange: (handler) => onSettingsChange(handler),
    getActiveNoteFrontmatter: () => null,
    setActiveNoteFrontmatter: () => {
      /* standalone 无活动笔记 */
    },
    onNoteFrontmatterChanged: () => () => {},
    // SDK 直接导出的编辑器 / 文件 API stub
    editor: editorApi,
    files: filesApi,
    // 由 SDK 散函数组装的安全存储对象
    secureStorage: {
      get: getSecure,
      set: setSecure,
      delete: deleteSecure,
      keys: listSecureKeys,
    },
  }), [active])

  const Panel = manifest.panel as ComponentType<PluginPanelProps>

  return (
    <div style={shellStyle}>
      <div style={headerStyle}>
        <strong>{manifest.name}</strong>
        <span style={{ color: '#6e6e73', fontSize: 11 }}>{manifest.id}</span>
        <span style={{ flex: 1 }} />
        <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          isActive
        </label>
        <button style={btn} onClick={() => setActive(false)}>close</button>
      </div>
      <div style={panelWrapStyle}>
        <Panel {...panelProps} />
      </div>
    </div>
  )
}

const btn: CSSProperties = {
  fontSize: 12,
  padding: '4px 10px',
  border: '1px solid #d2d2d7',
  borderRadius: 6,
  background: '#fff',
  cursor: 'pointer',
}
