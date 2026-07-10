/**
 * Custom Editor — 为 .smm 文件注册自定义编辑器
 *
 * 展示三层机制：
 *  1. manifest 声明 `editorFileExtensions: ['.smm']` —— 静态声明能渲染的扩展名
 *  2. manifest 声明 `editorComponent: SmmEditor` —— 匹配扩展名时挂载的组件
 *  3. onLoad 中 `registerEditor(pluginId, '.smm', SmmEditor)` —— 运行时注册到宿主注册表
 *
 * 三层关系：
 *  - manifest 的静态字段供宿主在加载前做权限/冲突预检；
 *  - registerEditor 把组件写入运行时注册表，宿主打开文件时按扩展名查表；
 *  - editorComponent 是实际渲染组件，接收 { content, onChange }。
 *
 * 本示例把 .smm 格式当作 JSON 展示与编辑：左侧原始文本，右侧格式化预览。
 */
import { useEffect, useMemo, useState } from 'react'
import type {
  PluginContext,
  PluginManifest,
  PluginPanelProps,
} from '@swallow-note/plugin-sdk'
import {
  getActivePluginExtensions,
  registerEditor,
  unregisterEditor,
} from '@swallow-note/plugin-sdk'
// 重新导出 setHost，让宿主在触发生命周期钩子前注入真实实现
export { setHost } from '@swallow-note/plugin-sdk'

const PLUGIN_ID = 'com.example.custom-editor'
const TARGET_EXT = '.smm'

// ─── 自定义编辑器组件 ──────────────────────────────────────────────────────────
// 宿主打开 .smm 文件时挂载此组件。props 为 { content, onChange }：
//  - content：文件原始内容（字符串）
//  - onChange：用户编辑后宿主回调，传回新内容字符串

function SmmEditor({ content, onChange }: { content: string; onChange: (content: string) => void }) {
  // 本地态保存正在编辑的文本，受控于 content（外部切换文件时同步）
  const [draft, setDraft] = useState(content)

  // 同步外部 content 变化（如切换文件、撤销重做）到本地草稿
  useEffect(() => {
    setDraft(content)
  }, [content])

  // 尝试把当前草稿解析为 JSON，用于右侧预览
  const parsed = useMemo<{ ok: true; value: unknown } | { ok: false; error: string }>(() => {
    try {
      return { ok: true, value: JSON.parse(draft) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }, [draft])

  const handleChange = (next: string) => {
    setDraft(next)
    // 通知宿主内容已变更，宿主会标记文件为未保存
    onChange(next)
  }

  return (
    <div style={{ display: 'flex', height: '100%', gap: 8, padding: 8 }}>
      {/* 左侧：原始 JSON 文本编辑 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <label style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>
          .smm 源码（JSON）
        </label>
        <textarea
          value={draft}
          onChange={(e) => handleChange(e.target.value)}
          spellCheck={false}
          style={{
            flex: 1,
            resize: 'none',
            fontFamily: 'monospace',
            fontSize: 12,
            padding: 8,
            border: '1px solid var(--border-color)',
            borderRadius: 4,
            background: 'var(--bg-secondary)',
            color: 'inherit',
          }}
        />
      </div>
      {/* 右侧：解析后的格式化预览 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <label style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>
          解析预览
        </label>
        <pre
          style={{
            flex: 1,
            margin: 0,
            overflow: 'auto',
            padding: 8,
            border: '1px solid var(--border-color)',
            borderRadius: 4,
            background: 'var(--bg-secondary)',
            fontSize: 12,
            fontFamily: 'monospace',
            color: parsed.ok ? 'inherit' : 'var(--danger-color, #f44336)',
          }}
        >
          {parsed.ok ? JSON.stringify(parsed.value, null, 2) : `解析失败：${parsed.error}`}
        </pre>
      </div>
    </div>
  )
}

// ─── 侧边栏图标 ───────────────────────────────────────────────────────────────

function EditorIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="9" y1="13" x2="15" y2="13" />
      <line x1="9" y1="17" x2="15" y2="17" />
    </svg>
  )
}

// ─── 面板：展示编辑器注册状态 ──────────────────────────────────────────────────

function EditorPanel(panel: PluginPanelProps) {
  // 读取当前运行时注册表快照，展示 .smm 是否已注册
  const extensions = Array.from(getActivePluginExtensions())
  const registered = extensions.includes(TARGET_EXT)

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <header>
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>Custom Editor Demo</h2>
        <p style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
          为 <code>{TARGET_EXT}</code> 文件注册自定义编辑器
        </p>
      </header>

      <section style={{ fontSize: 12, lineHeight: 1.6 }}>
        <div>
          <strong>插件 ID：</strong>
          <code>{panel.pluginId}</code>
        </div>
        <div>
          <strong>目标扩展名：</strong>
          <code>{TARGET_EXT}</code>
        </div>
        <div>
          <strong>注册状态：</strong>
          <code style={{ color: registered ? 'var(--success-color, #22c55e)' : 'var(--danger-color, #f44336)' }}>
            {registered ? '已注册' : '未注册'}
          </code>
        </div>
        <div>
          <strong>当前注册表：</strong>
          <code>{extensions.length === 0 ? '(空)' : extensions.join(', ')}</code>
        </div>
      </section>

      <p style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
        打开任意 <code>.smm</code> 文件即可触发 <code>SmmEditor</code> 组件渲染。
        组件接收 <code>{'{ content, onChange }'}</code>，左侧编辑 JSON 源码，右侧实时预览解析结果。
      </p>
    </div>
  )
}

// ─── 生命周期钩子 ──────────────────────────────────────────────────────────────

function onLoad(ctx: PluginContext): void {
  // 运行时把 SmmEditor 注册到宿主编辑器注册表。
  // 宿主会校验 'editor' 权限，并检测扩展名冲突（同一扩展名不能被两个插件注册）。
  registerEditor(ctx.pluginId, TARGET_EXT, SmmEditor)
}

function onUnload(ctx: PluginContext): void {
  // 卸载时清理本插件注册的所有编辑器，避免遗留无效组件
  unregisterEditor(ctx.pluginId)
}

// ─── Manifest ─────────────────────────────────────────────────────────────────

const manifest: PluginManifest = {
  id: PLUGIN_ID,
  name: 'Custom Editor Demo',
  description: 'Demonstrates registering a custom file editor for .smm files',
  version: '0.1.0',
  author: 'SwallowNote',
  publishedAt: '2026-07-10',

  iconPosition: 'sidebar',
  contentPosition: 'fullPanel',
  order: 100,
  enabled: true,

  icon: EditorIcon,
  panel: EditorPanel,

  // 静态声明：本插件能渲染 .smm 文件
  editorFileExtensions: [TARGET_EXT],
  // 匹配扩展名时挂载的组件
  editorComponent: SmmEditor,

  // editor 权限：注册文件编辑器必须声明
  permissions: ['editor'],

  onLoad,
  onUnload,
}

export default manifest
