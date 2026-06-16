/**
 * CustomThemeDialog — manage user-authored themes.
 *
 * Layout: left column lists saved custom themes (with rename /
 * delete actions); right column is a `<textarea>` for editing the
 * selected theme's CSS. The top-right toolbar has a "new" button.
 *
 * Custom themes are persisted via the plugin storage API and
 * exposed to the parent (`WenyanDialog`) as a `{ id, name, css }`
 * list plus a callback for inserting a theme into the active
 * theme picker.
 */
import { useEffect, useState, useCallback } from 'react'
import type { ReactNode } from 'react'
import type { PluginStorage } from '@swallow-note/plugin-sdk'
import { toast } from 'sonner'

export interface CustomTheme {
  /** Stable id of the form `custom:<uuid>`. */
  id: string
  name: string
  /** Raw CSS for the theme. */
  css: string
}

const STORAGE_KEY = 'wenyan-custom-themes'

function newId(): string {
  // crypto.randomUUID exists in modern browsers / Tauri webview; the
  // fallback handles the standalone dev server.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `custom:${crypto.randomUUID()}`
  }
  return `custom:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Default CSS shown in the editor when the user creates a new custom
 * theme. Covers the major selectors used by the @wenyan-md/core
 * renderer so the user can see what's available and tweak any of
 * them. The CSS is intentionally simple — comments label each block
 * with the corresponding Markdown element.
 */
const EXAMPLE_CUSTOM_CSS = `/* 自定义主题示例 —— 选择器参考
   主题 CSS 通过 applyStylesWithTheme 注入到文章根元素 #wenyan。
   可用的选择器（按 Markdown 元素分组）： */

/* === 整篇文章 === */
/* #wenyan                —— 文章根元素
   #wenyan *              —— 任意后代 */

/* === 标题（# / ## / ### ...） === */
#wenyan h1 { color: #2c3e50; font-weight: 700; }
#wenyan h2 { color: #34495e; font-weight: 700; }
#wenyan h3 { color: #34495e; font-weight: 600; }
#wenyan h4 { color: #555;    font-weight: 600; }
#wenyan h5 { color: #666;    font-weight: 600; }
#wenyan h6 { color: #777;    font-weight: 600; }

/* === 段落（普通段落） === */
#wenyan p { color: #3f3f3f; }

/* === 引用块（> ...） === */
#wenyan blockquote {
  color: #6a737d;
  background: #f5f5f5;
  border-left: 4px solid #dfe2e5;
  padding: 0.5em 1em;
  margin: 1em 0;
}

/* === 链接（[text](url)） === */
#wenyan a { color: #1aad19; text-decoration: none; }

/* === 列表（- / 1.） === */
#wenyan ul, #wenyan ol { color: #3f3f3f; }
#wenyan li { margin: 0.3em 0; }

/* === 表格 === */
#wenyan table { border-collapse: collapse; }
#wenyan th, #wenyan td {
  border: 1px solid #ddd;
  padding: 0.5em 0.8em;
}
#wenyan th { background: #f7f7f7; font-weight: 600; }

/* === 代码块（\`\`\`） === */
#wenyan pre {
  background: #282c34;
  color: #abb2bf;
  border-radius: 5px;
  padding: 1em;
  font-size: 12px;
  overflow-x: auto;
}

/* === 行内代码（\`code\`） === */
#wenyan code {
  background: #f0f0f0;
  color: #d6336c;
  border-radius: 3px;
  padding: 0 4px;
  font-size: 0.9em;
}
/* pre 内的 code 不要套用行内样式 */
#wenyan pre code {
  background: transparent;
  color: inherit;
  padding: 0;
  font-size: inherit;
}

/* === 脚注 === */
#wenyan .footnote { color: #1aad19; font-size: 0.9em; }

/* === 图片 === */
#wenyan img { max-width: 100%; border-radius: 4px; }

/* === 分隔线（---） === */
#wenyan hr {
  border: none;
  border-top: 1px dashed #ccc;
  margin: 1.5em 0;
}
`

function loadThemes(store: PluginStorage): Promise<CustomTheme[]> {
  return store.get<CustomTheme[]>(STORAGE_KEY).then((v) => v ?? [])
}

function saveThemes(store: PluginStorage, themes: CustomTheme[]): Promise<void> {
  return store.set(STORAGE_KEY, themes)
}

interface CustomThemeDialogProps {
  store: PluginStorage
  open: boolean
  onClose: () => void
  /** When the user picks a theme from the list, propagate it so the
   *  parent's article-theme select shows it. */
  onSelect: (theme: CustomTheme) => void
  /** Currently selected custom theme id (or null). */
  selectedId: string | null
}

export function CustomThemeDialog(props: CustomThemeDialogProps): ReactNode {
  const { store, open, onClose, onSelect, selectedId } = props
  const [themes, setThemes] = useState<CustomTheme[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editCss, setEditCss] = useState('')

  // Hydrate from storage when the dialog opens.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    void loadThemes(store).then((list) => {
      if (cancelled) return
      setThemes(list)
      // Pick the previously-selected theme or fall back to the first.
      const initial = list.find((t) => t.id === selectedId) ?? list[0] ?? null
      setActiveId(initial?.id ?? null)
      setEditName(initial?.name ?? '')
      setEditCss(initial?.css ?? '')
    })
    return () => {
      cancelled = true
    }
  }, [open, store, selectedId])

  // Update the edit form when the active selection changes.
  useEffect(() => {
    if (!activeId) {
      setEditName('')
      setEditCss('')
      return
    }
    const t = themes.find((x) => x.id === activeId)
    if (t) {
      setEditName(t.name)
      setEditCss(t.css)
    }
  }, [activeId, themes])

  const handleNew = useCallback(() => {
    const id = newId()
    const theme: CustomTheme = {
      id,
      name: '新自定义主题',
      css: EXAMPLE_CUSTOM_CSS,
    }
    setThemes((prev) => {
      const next = [...prev, theme]
      void saveThemes(store, next)
      return next
    })
    setActiveId(id)
    toast.success('已新建自定义主题')
  }, [store])

  const handleDelete = useCallback(() => {
    if (!activeId) return
    const t = themes.find((x) => x.id === activeId)
    if (!t) return
    if (!confirm(`确定删除自定义主题「${t.name}」？`)) return
    setThemes((prev) => {
      const next = prev.filter((x) => x.id !== activeId)
      void saveThemes(store, next)
      return next
    })
    setActiveId(null)
    toast.success('已删除自定义主题')
  }, [activeId, themes, store])

  const handleSave = useCallback(() => {
    if (!activeId) return
    const name = editName.trim() || '未命名主题'
    setThemes((prev) => {
      const next = prev.map((x) =>
        x.id === activeId ? { ...x, name, css: editCss } : x
      )
      void saveThemes(store, next)
      return next
    })
    toast.success('主题已保存')
  }, [activeId, editName, editCss, store])

  const handleSelectInParent = useCallback(() => {
    if (!activeId) return
    const t = themes.find((x) => x.id === activeId)
    if (!t) return
    // Persist any unsaved edits first so the parent renders the
    // latest CSS.
    const name = editName.trim() || t.name
    const css = editCss
    const updated: CustomTheme = { ...t, name, css }
    setThemes((prev) => {
      const next = prev.map((x) => (x.id === activeId ? updated : x))
      void saveThemes(store, next)
      return next
    })
    onSelect(updated)
  }, [activeId, themes, editName, editCss, store, onSelect])

  if (!open) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        onClick={onClose}
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0,0,0,0.55)',
        }}
      />
      <div
        style={{
          position: 'relative',
          width: '80vw',
          height: '80vh',
          background: '#fff',
          borderRadius: 8,
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: '1px solid #e5e7eb',
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 15, fontWeight: 600, color: '#111' }}>
            自定义主题
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: 4,
              borderRadius: 4,
              color: '#6b7280',
              lineHeight: 1,
            }}
            title="关闭"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body: 2 columns */}
        <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
          {/* Left: theme list */}
          <div
            style={{
              width: 240,
              flexShrink: 0,
              borderRight: '1px solid #e5e7eb',
              display: 'flex',
              flexDirection: 'column',
              background: '#f9fafb',
            }}
          >
            <div
              style={{
                padding: 12,
                borderBottom: '1px solid #e5e7eb',
                display: 'flex',
                gap: 6,
              }}
            >
              <button
                onClick={handleNew}
                style={{
                  flex: 1,
                  padding: '6px 10px',
                  fontSize: 12,
                  borderRadius: 4,
                  border: '1px solid #d1d5db',
                  background: '#fff',
                  color: '#111',
                  cursor: 'pointer',
                }}
              >
                新建
              </button>
              <button
                onClick={handleDelete}
                disabled={!activeId}
                style={{
                  flex: 1,
                  padding: '6px 10px',
                  fontSize: 12,
                  borderRadius: 4,
                  border: '1px solid #d1d5db',
                  background: '#fff',
                  color: !activeId ? '#9ca3af' : '#b91c1c',
                  cursor: !activeId ? 'not-allowed' : 'pointer',
                }}
              >
                删除
              </button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 4 }}>
              {themes.length === 0 ? (
                <div
                  style={{
                    padding: 24,
                    textAlign: 'center',
                    fontSize: 12,
                    color: '#9ca3af',
                  }}
                >
                  暂无自定义主题
                </div>
              ) : (
                themes.map((t) => (
                  <div
                    key={t.id}
                    onClick={() => setActiveId(t.id)}
                    style={{
                      padding: '8px 10px',
                      margin: '2px 0',
                      borderRadius: 4,
                      cursor: 'pointer',
                      background: activeId === t.id ? '#dbeafe' : 'transparent',
                      color: activeId === t.id ? '#1d4ed8' : '#374151',
                      fontSize: 13,
                      fontWeight: activeId === t.id ? 600 : 400,
                    }}
                  >
                    {t.name}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Right: editor */}
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {!activeId ? (
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#9ca3af',
                  fontSize: 13,
                }}
              >
                左侧选择主题或点击「新建」创建
              </div>
            ) : (
              <>
                <div
                  style={{
                    padding: '12px 16px',
                    borderBottom: '1px solid #e5e7eb',
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center',
                  }}
                >
                  <label
                    style={{
                      fontSize: 12,
                      color: '#6b7280',
                      flexShrink: 0,
                    }}
                  >
                    名称
                  </label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    style={{
                      flex: 1,
                      padding: '5px 8px',
                      fontSize: 13,
                      borderRadius: 4,
                      border: '1px solid #d1d5db',
                    }}
                  />
                </div>
                <textarea
                  value={editCss}
                  onChange={(e) => setEditCss(e.target.value)}
                  spellCheck={false}
                  placeholder="/* 粘贴主题 CSS */"
                  style={{
                    flex: 1,
                    width: '100%',
                    padding: 16,
                    fontSize: 12,
                    fontFamily:
                      '"SF Mono", Menlo, Monaco, Consolas, "Courier New", monospace',
                    border: 'none',
                    outline: 'none',
                    resize: 'none',
                    lineHeight: 1.6,
                    color: '#1f2937',
                    background: '#fafafa',
                  }}
                />
                <div
                  style={{
                    padding: 12,
                    borderTop: '1px solid #e5e7eb',
                    display: 'flex',
                    justifyContent: 'flex-end',
                    gap: 8,
                    flexShrink: 0,
                  }}
                >
                  <button
                    onClick={handleSelectInParent}
                    style={{
                      padding: '6px 14px',
                      fontSize: 13,
                      fontWeight: 500,
                      borderRadius: 4,
                      border: '1px solid #d1d5db',
                      background: '#fff',
                      color: '#111',
                      cursor: 'pointer',
                    }}
                  >
                    使用此主题
                  </button>
                  <button
                    onClick={handleSave}
                    style={{
                      padding: '6px 14px',
                      fontSize: 13,
                      fontWeight: 500,
                      borderRadius: 4,
                      border: 'none',
                      background: '#111827',
                      color: '#fff',
                      cursor: 'pointer',
                    }}
                  >
                    保存
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
