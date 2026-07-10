/**
 * Frontmatter Tagger — 读写活动笔记的 frontmatter
 *
 * 展示：
 *  - panel.getActiveNoteFrontmatter() —— 读取当前笔记 frontmatter
 *  - panel.setActiveNoteFrontmatter(data) —— 合并更新 frontmatter
 *  - panel.onNoteFrontmatterChanged(cb) —— 订阅变更，实时刷新
 *
 * frontmatter 是笔记顶部的 YAML 元数据块（如 tags / title / date）。
 * setActiveNoteFrontmatter 为合并写入：只更新传入字段，保留其他字段。
 */
import { useEffect, useState } from 'react'
import type { PluginManifest, PluginPanelProps } from '@swallow-note/plugin-sdk'
// 重新导出 setHost，让宿主在触发生命周期钩子前注入真实实现
export { setHost } from '@swallow-note/plugin-sdk'

// ─── 侧边栏图标 ───────────────────────────────────────────────────────────────

function TagIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </svg>
  )
}

// ─── 工具函数：从 frontmatter 提取 tags 数组 ──────────────────────────────────

function extractTags(frontmatter: Record<string, unknown> | null): string[] {
  if (!frontmatter) return []
  const raw = frontmatter.tags
  if (Array.isArray(raw)) {
    // 过滤非字符串项，保证类型安全
    return raw.filter((t): t is string => typeof t === 'string')
  }
  if (typeof raw === 'string') {
    // 兼容 YAML 逗号分隔字符串写法
    return raw.split(',').map((t) => t.trim()).filter(Boolean)
  }
  return []
}

// ─── 面板 ──────────────────────────────────────────────────────────────────────

function TaggerPanel(panel: PluginPanelProps) {
  // frontmatter 状态：null 表示无活动笔记
  const [frontmatter, setFrontmatter] = useState<Record<string, unknown> | null>(
    () => panel.getActiveNoteFrontmatter()
  )
  const [newTag, setNewTag] = useState('')

  // 订阅 frontmatter 变更：外部修改（如其他插件、源码编辑）时实时同步
  useEffect(() => {
    // 初始读取一次，确保打开面板时展示最新值
    setFrontmatter(panel.getActiveNoteFrontmatter())
    const unsubscribe = panel.onNoteFrontmatterChanged((data) => {
      setFrontmatter({ ...data })
    })
    return unsubscribe
  }, [panel])

  const tags = extractTags(frontmatter)

  // 添加标签：合并写入，只更新 tags 字段，保留其他 frontmatter 字段
  const handleAddTag = () => {
    const trimmed = newTag.trim()
    if (!trimmed) return
    if (tags.includes(trimmed)) {
      // 已存在则不重复添加
      setNewTag('')
      return
    }
    // setActiveNoteFrontmatter 是合并写入：传入 { tags } 只更新 tags
    panel.setActiveNoteFrontmatter({ tags: [...tags, trimmed] })
    setNewTag('')
  }

  // 删除标签：同理合并写入更新后的 tags
  const handleRemoveTag = (tag: string) => {
    panel.setActiveNoteFrontmatter({ tags: tags.filter((t) => t !== tag) })
  }

  // 无活动笔记时展示提示
  if (frontmatter === null) {
    return (
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <header>
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>Frontmatter Tagger</h2>
          <p style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            Plugin ID: <code>{panel.pluginId}</code>
          </p>
        </header>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          当前无活动笔记。请打开一个 Markdown 笔记后再使用本插件。
        </p>
      </div>
    )
  }

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <header>
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>Frontmatter Tagger</h2>
        <p style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
          Plugin ID: <code>{panel.pluginId}</code>
        </p>
      </header>

      {/* 标签列表 */}
      <section>
        <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
          标签（{tags.length}）
        </h3>
        {tags.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>暂无标签</p>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {tags.map((tag) => (
              <span
                key={tag}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '2px 8px',
                  borderRadius: 12,
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-color)',
                  fontSize: 12,
                }}
              >
                {tag}
                <button
                  type="button"
                  onClick={() => handleRemoveTag(tag)}
                  aria-label={`移除标签 ${tag}`}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    padding: 0,
                    lineHeight: 1,
                    fontSize: 14,
                  }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </section>

      {/* 添加标签 */}
      <section style={{ display: 'flex', gap: 8 }}>
        <input
          type="text"
          value={newTag}
          onChange={(e) => setNewTag(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAddTag()
          }}
          placeholder="输入标签名后回车"
          style={inputStyle}
        />
        <button type="button" onClick={handleAddTag} style={buttonStyle} disabled={!newTag.trim()}>
          添加标签
        </button>
      </section>

      {/* 原始 frontmatter 展示 */}
      <section>
        <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>原始 frontmatter</h3>
        <pre
          style={{
            margin: 0,
            padding: 8,
            border: '1px solid var(--border-color)',
            borderRadius: 4,
            background: 'var(--bg-secondary)',
            fontSize: 11,
            fontFamily: 'monospace',
            overflow: 'auto',
            maxHeight: 200,
          }}
        >
          {JSON.stringify(frontmatter, null, 2)}
        </pre>
      </section>

      <p style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
        <code>setActiveNoteFrontmatter</code> 为合并写入：只更新传入字段（如 tags），保留其他字段。
        订阅 <code>onNoteFrontmatterChanged</code> 可实时响应外部修改。
      </p>
    </div>
  )
}

// ─── 样式 ─────────────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  flex: 1,
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

// ─── Manifest ─────────────────────────────────────────────────────────────────
// permissions 声明 'storage'：frontmatter 读写涉及笔记元数据持久化。

const manifest: PluginManifest = {
  id: 'com.example.frontmatter-tagger',
  name: 'Frontmatter Tagger',
  description: 'Demonstrates reading and writing note frontmatter',
  version: '0.1.0',
  author: 'SwallowNote',
  publishedAt: '2026-07-10',

  iconPosition: 'sidebar',
  contentPosition: 'fullPanel',
  order: 100,
  enabled: true,

  icon: TagIcon,
  panel: TaggerPanel,

  permissions: ['storage'],
}

export default manifest
