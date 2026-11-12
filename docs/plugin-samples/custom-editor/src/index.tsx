/**
 * Custom Editor — 为 .smm 文件注册自定义编辑器
 *
 * 声明式机制：manifest.json 声明 `editorFileExtensions: ['.smm']`，入口经
 * definePlugin 注入 `editorComponent`，宿主在启用插件时自动注册编辑器并广播
 * `editor:registered` 事件，卸载/禁用时自动清理——无需手动配对
 * registerEditor/unregisterEditor。
 *
 * 本示例把 .smm 格式当作 JSON 展示与编辑：左侧原始文本，右侧格式化预览。
 */
import { useEffect, useMemo, useState } from 'react'
import manifestJson from '../manifest.json'
import type { PluginPanelProps } from '@swallow-note/plugin-sdk'
import { definePlugin, getActivePluginExtensions } from '@swallow-note/plugin-sdk'
// 保留！宿主需要从 bundle 上调用 setHost 完成接管，SDK 要求 entry 必须 re-export
export { setHost } from '@swallow-note/plugin-sdk'

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
  // 读取当前运行时注册表快照（宿主依据 manifest 自动注册），展示 .smm 是否已注册
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

// ─── 入口 ─────────────────────────────────────────────────────────────────────
// 静态字段（id/version/permissions/editorFileExtensions 等）唯一来源是 manifest.json；
// 入口只经 definePlugin 注入运行时组件，宿主加载启用后自动注册 .smm 编辑器。
export default definePlugin(manifestJson, {
  icon: EditorIcon,
  panel: EditorPanel,
  editorComponent: SmmEditor,
})
