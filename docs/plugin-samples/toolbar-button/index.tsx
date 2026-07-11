/**
 * Toolbar Button — 自定义编辑器工具栏按钮
 *
 * 展示：
 *  - iconPosition: 'editorToolbar' —— 按钮挂在编辑器工具栏而非侧边栏
 *  - contentPosition: 'editorArea' —— 面板在编辑器区域展开
 *  - toolbarButton 组件替代默认图标按钮
 *  - ToolbarButtonProps 全量字段（activate / deactivate / activeNoteName 等）
 *
 * 与 hello-world 的区别：这里没有 `icon` 字段（不会出现在侧边栏），
 * 而是提供 `toolbarButton` 组件，宿主把它渲染到编辑器顶部工具栏。
 * 用户点击按钮调用 activate() 后，panel 在编辑器区域显示。
 */
import { useState } from 'react'
import type {
  PluginManifest,
  PluginPanelProps,
  ToolbarButtonProps,
} from '@swallow-note/plugin-sdk'
// 重新导出 setHost，让宿主在触发生命周期钩子前注入真实实现
export { setHost } from '@swallow-note/plugin-sdk'

// ─── 自定义工具栏按钮 ──────────────────────────────────────────────────────────
// 宿主渲染此组件替代默认图标按钮。点击时调用 activate() 展开面板，
// 再次点击调用 deactivate() 收起。按钮高亮状态由 isActive 控制。

function ToolbarButtonDemo(props: ToolbarButtonProps) {
  const {
    size,
    isActive,
    pluginId,
    activeNoteName,
    activeNoteExt,
    isActiveNoteMarkdown,
    activate,
    deactivate,
  } = props

  // 点击切换激活状态：激活时收起，未激活时展开
  const handleClick = () => {
    if (isActive) {
      deactivate()
    } else {
      activate()
    }
  }

  // 把 ToolbarButtonProps 暴露的活动笔记信息汇总为 tooltip，便于直观验证
  const noteSummary = activeNoteName
    ? `${activeNoteName}.${activeNoteExt}（${isActiveNoteMarkdown ? 'Markdown' : '非 Markdown'}）`
    : '无活动笔记'
  const tooltip = `[${pluginId}] Toolbar Button Demo · ${noteSummary}`

  return (
    <button
      type="button"
      onClick={handleClick}
      title={tooltip}
      aria-label={tooltip}
      aria-pressed={isActive}
      style={{
        // 尺寸跟随工具栏推荐大小
        width: size + 8,
        height: size + 8,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: '1px solid var(--border-color, #ddd)',
        borderRadius: 4,
        background: isActive ? 'var(--accent-color, #4f46e5)' : 'transparent',
        color: isActive ? '#fff' : 'inherit',
        cursor: 'pointer',
        padding: 0,
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M3 9h18" />
        <path d="M9 21V9" />
      </svg>
    </button>
  )
}

// ─── 面板（在编辑器区域展开） ──────────────────────────────────────────────────
// 展示当前活动笔记的元信息，让开发者直观看到 ToolbarButtonProps 暴露的字段。

function ToolbarButtonPanel(panel: PluginPanelProps) {
  // 活动笔记信息从 panel props 读取；无笔记时为空串
  const { activeNoteContent, activeNotePath, close } = panel
  // 保留一个本地态用于演示按钮交互（不持久化）
  const [copied, setCopied] = useState(false)

  // 从路径中拆出文件名与扩展名，便于展示
  const segments = activeNotePath.split('/')
  const fileName = segments[segments.length - 1] || '(无活动笔记)'
  const ext = fileName.includes('.') ? fileName.split('.').pop()! : ''

  const handleCopy = () => {
    if (!activeNoteContent) return
    // 仅作演示：实际剪贴板写入需 'clipboard' 权限
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>Toolbar Button Demo</h2>
        <button type="button" onClick={close} style={buttonStyle}>
          关闭
        </button>
      </header>

      <section style={{ fontSize: 12, lineHeight: 1.6 }}>
        <div>
          <strong>pluginId：</strong>
          <code>{panel.pluginId}</code>
        </div>
        <div>
          <strong>文件名：</strong>
          <code>{fileName}</code>
        </div>
        <div>
          <strong>扩展名：</strong>
          <code>{ext || '(无)'}</code>
        </div>
        <div>
          <strong>完整路径：</strong>
          <code style={{ wordBreak: 'break-all' }}>{activeNotePath || '(无活动笔记)'}</code>
        </div>
        <div>
          <strong>是否 Markdown：</strong>
          <code>{ext === 'md' ? '是' : '否'}</code>
        </div>
        <div>
          <strong>内容长度：</strong>
          <code>{activeNoteContent.length}</code> 字符
        </div>
      </section>

      <section>
        <button type="button" onClick={handleCopy} style={buttonStyle} disabled={!activeNoteContent}>
          {copied ? '已复制（演示）' : '复制内容长度（演示）'}
        </button>
      </section>

      <p style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
        本面板由 <code>toolbarButton</code> 组件通过 <code>activate()</code> 触发展开，
        再次点击按钮调用 <code>deactivate()</code> 收起。
      </p>
    </div>
  )
}

const buttonStyle: React.CSSProperties = {
  padding: '4px 12px',
  borderRadius: 4,
  border: '1px solid var(--border-color)',
  background: 'var(--bg-secondary)',
  cursor: 'pointer',
  fontSize: 12,
}

// ─── Manifest ─────────────────────────────────────────────────────────────────
// iconPosition 为 editorToolbar：不渲染侧边栏图标，改用 toolbarButton。
// permissions 为空：仅做 UI 展示，不调用 store / events / backend 等受保护能力。

const manifest: PluginManifest = {
  id: 'com.example.toolbar-button',
  name: 'Toolbar Button Demo',
  description:
    'Demonstrates editorToolbar iconPosition with custom toolbarButton component',
  version: '0.1.0',
  author: 'SwallowNote',
  publishedAt: '2026-07-10',

  iconPosition: 'editorToolbar',
  contentPosition: 'editorArea',
  order: 100,
  enabled: true,

  toolbarButton: ToolbarButtonDemo,
  panel: ToolbarButtonPanel,

  permissions: [],
}

export default manifest
