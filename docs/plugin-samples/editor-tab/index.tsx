/**
 * Editor Tab — 在主编辑区打开与管理自定义 tab
 *
 * 展示：
 *  - openEditorTab(pluginId, props) —— 在主编辑区打开一个 tab
 *  - closeEditorTab(pluginId, tabId) —— 关闭指定 tab
 *  - closePluginTabs(pluginId) —— 关闭本插件打开的所有 tab
 *  - EditorToolbarConfig —— 控制 tab 工具栏按钮的显隐
 *
 * 场景：插件把内部数据（如加密笔记、数据库摘要）以 Markdown 形式
 * 渲染到主编辑区，复用宿主的 MarkdownEditor；用户编辑后通过
 * onChange 回调把新内容传回插件，插件负责持久化。
 */
import { useState } from 'react'
import type {
  EditorToolbarConfig,
  OpenEditorTabProps,
  PluginManifest,
  PluginPanelProps,
} from '@swallow-note/plugin-sdk'
import {
  closeEditorTab,
  closePluginTabs,
  openEditorTab,
} from '@swallow-note/plugin-sdk'
// 重新导出 setHost，让宿主在触发生命周期钩子前注入真实实现
export { setHost } from '@swallow-note/plugin-sdk'

const PLUGIN_ID = 'com.example.editor-tab'

// 默认 tab 内容（Markdown 演示文本）
const DEFAULT_CONTENT = '# Plugin Tab Demo\n\n这是由插件打开的 tab 内容。\n\n编辑后内容会通过 onChange 回传给插件。\n'

// 工具栏配置：隐藏「在文件夹中显示」和「历史记录」按钮，
// 因为插件 tab 不对应真实文件路径，这两个按钮无意义。
const toolbarConfig: EditorToolbarConfig = {
  openLocation: false,
  openHistory: false,
}

// ─── 侧边栏图标 ───────────────────────────────────────────────────────────────

function TabIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 3h18v18H3z" />
      <path d="M3 9h18" />
      <path d="M9 21V9" />
    </svg>
  )
}

// ─── 面板 ──────────────────────────────────────────────────────────────────────

function EditorTabPanel(panel: PluginPanelProps) {
  // tab 名称与内容用本地 state 管理（演示用，未持久化）
  const [tabName, setTabName] = useState('Plugin Note')
  const [content, setContent] = useState(DEFAULT_CONTENT)
  // 记录已打开的 tab id 列表，便于逐个关闭
  const [tabIds, setTabIds] = useState<string[]>([])

  // 打开 tab：相同 id 复用已有 tab，宿主不会重复创建
  const handleOpen = () => {
    const id = `plugin-note-${Date.now()}`
    const props: OpenEditorTabProps = {
      id,
      name: tabName || 'Plugin Note',
      content,
      // 用户在主编辑区编辑后，宿主回调此函数传回新内容
      onChange: (next: string) => {
        setContent(next)
      },
      toolbarConfig,
    }
    openEditorTab(panel.pluginId, props)
    setTabIds((prev) => (prev.includes(id) ? prev : [...prev, id]))
  }

  // 关闭最后一个打开的 tab（演示 closeEditorTab）
  const handleCloseLast = () => {
    if (tabIds.length === 0) return
    const last = tabIds[tabIds.length - 1]
    closeEditorTab(panel.pluginId, last)
    setTabIds((prev) => prev.filter((tid) => tid !== last))
  }

  // 关闭本插件打开的所有 tab（演示 closePluginTabs）
  const handleCloseAll = () => {
    closePluginTabs(panel.pluginId)
    setTabIds([])
  }

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <header>
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>Editor Tab Demo</h2>
        <p style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
          Plugin ID: <code>{panel.pluginId}</code>
        </p>
      </header>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label style={labelStyle}>
          Tab 名称
          <input
            type="text"
            value={tabName}
            onChange={(e) => setTabName(e.target.value)}
            style={inputStyle}
          />
        </label>
        <label style={labelStyle}>
          Tab 内容（Markdown）
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={6}
            spellCheck={false}
            style={{ ...inputStyle, fontFamily: 'monospace', resize: 'vertical' }}
          />
        </label>
      </section>

      <section style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={handleOpen} style={primaryButtonStyle}>
          打开 Tab
        </button>
        <button
          type="button"
          onClick={handleCloseLast}
          style={buttonStyle}
          disabled={tabIds.length === 0}
        >
          关闭 Tab（最后一个）
        </button>
        <button
          type="button"
          onClick={handleCloseAll}
          style={buttonStyle}
          disabled={tabIds.length === 0}
        >
          关闭所有
        </button>
      </section>

      <section style={{ fontSize: 12, lineHeight: 1.6 }}>
        <div>
          <strong>已打开 tab 数：</strong>
          <code>{tabIds.length}</code>
        </div>
        <div>
          <strong>toolbarConfig：</strong>
          <code>openLocation=false, openHistory=false</code>
        </div>
        {tabIds.length > 0 && (
          <div>
            <strong>tab id 列表：</strong>
            <code style={{ wordBreak: 'break-all' }}>{tabIds.join(', ')}</code>
          </div>
        )}
      </section>

      <p style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
        点击「打开 Tab」在主编辑区创建一个 tab，宿主用内置 MarkdownEditor 渲染 content。
        用户编辑后通过 <code>onChange</code> 回调把新内容传回本插件，更新上方文本框。
      </p>
    </div>
  )
}

// ─── 样式 ─────────────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 12,
}

const inputStyle: React.CSSProperties = {
  padding: '4px 8px',
  border: '1px solid var(--border-color)',
  borderRadius: 4,
  background: 'var(--bg-secondary)',
  fontSize: 12,
  color: 'inherit',
}

const buttonStyle: React.CSSProperties = {
  padding: '4px 12px',
  borderRadius: 4,
  border: '1px solid var(--border-color)',
  background: 'var(--bg-secondary)',
  cursor: 'pointer',
  fontSize: 12,
}

const primaryButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  background: 'var(--accent-color, #4f46e5)',
  color: '#fff',
  border: '1px solid var(--accent-color, #4f46e5)',
}

// ─── Manifest ─────────────────────────────────────────────────────────────────
// permissions 为空：openEditorTab/closeEditorTab/closePluginTabs
// 不属于受保护能力，无需声明权限。

const manifest: PluginManifest = {
  id: PLUGIN_ID,
  name: 'Editor Tab Demo',
  description: 'Demonstrates opening and managing custom editor tabs',
  version: '0.1.0',
  author: 'SwallowNote',
  publishedAt: '2026-07-10',

  iconPosition: 'sidebar',
  contentPosition: 'fullPanel',
  order: 100,
  enabled: true,

  icon: TabIcon,
  panel: EditorTabPanel,

  permissions: [],
}

export default manifest
