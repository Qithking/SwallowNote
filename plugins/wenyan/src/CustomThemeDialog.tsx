/**
 * CustomThemeDialog — manage user-authored themes.
 *
 * Layout:
 *   - Left column lists saved custom themes (with rename / delete actions)
 *   - Right column is split into Editor + Preview.
 *   - Editor top: theme name input, then mode Tabs (可视化设计 / 手写 CSS)
 *   - Editor body: in `手写 CSS` shows a `<textarea>` of the raw CSS;
 *     in `可视化设计` shows nested Tabs (全局 / 标题 / 段落 / 引用) with
 *     form controls that drive a ThemeConfig.
 *   - Preview right: live-renders the active note's markdown with the
 *     currently edited CSS (300ms debounced).
 *
 * Data model: `editCss` is the single source of truth. `ThemeConfig`
 * is derived from `editCss` via `cssToConfig(editCss)`; every form
 * control writes back via `setEditCss(configToCss(newConfig))`.
 */
import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import type { PluginStorage } from '@swallow-note/plugin-sdk'
import { toast } from 'sonner'
import { useWenyanRenderer, type RenderOptions } from './useWenyanRenderer'
import {
  configToCss,
  cssToConfig,
  DEFAULT_THEME_CONFIG,
  FONT_FAMILY_CSS,
  resolveFontFamily,
  categoryAtLine,
  categorySelector,
  findSelectorLine,
  type ThemeConfig,
  type ThemeTypography,
  type HeadingLevel,
  type HeadingLevelFields,
} from './themeConfig'
import {
  ElementStyleEditor,
  type ElementStyle,
} from './components/ElementStyle'
import { CodeEditor, type CodeEditorRef } from '@/components/CodeEditor'

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

/** Debounce helper (matches the one used in WenyanDialog). */
function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
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
  /** Active note markdown content, used by the live preview. Optional. */
  markdown?: string
}

type EditMode = 'visual' | 'css'
type VisualCategory = 'global' | 'heading' | 'paragraph' | 'quote'

/** 固定平台与代码高亮主题预览参数。 */
const PREVIEW_OPTIONS: RenderOptions = {
  platform: 'wechat',
  themeId: 'default',
  hlThemeId: 'solarized-light',
  customThemeCss: null,
  isAddFootnote: false,
  themeFollowTheme: true,
  paragraphFollowTheme: true,
  codeBlockFollowTheme: true,
  themeOverrides: {
    primaryColor: '#1aad19',
    blockquoteBg: '#afb8c133',
    textColor: '#3f3f3f',
  },
  paragraphOptions: {
    fontSize: 16,
    lineHeight: 1.75,
    lineSpacing: 0,
    fontFamily: 'sans-serif',
    letterSpacing: 'normal',
    paragraphSpacing: 'standard',
    textAlign: 'left',
    textIndent: 0,
  },
  codeBlockOptions: {
    borderRadius: 5,
    fontSize: 12,
    shadow: 'heavy',
    isMacStyle: true,
  },
}

export function CustomThemeDialog(props: CustomThemeDialogProps): ReactNode {
  const { store, open, onClose, onSelect, selectedId, markdown } = props
  const [themes, setThemes] = useState<CustomTheme[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editCss, setEditCss] = useState('')
  const [editMode, setEditMode] = useState<EditMode>('visual')
  const [visualCategory, setVisualCategory] = useState<VisualCategory>('global')

  // Live preview.
  const { html, loading, error, render } = useWenyanRenderer()
  const debouncedCss = useDebounce(editCss, 300)
  const debouncedMarkdown = useDebounce(markdown ?? '', 300)

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

  // 派生 ThemeConfig（始终以 editCss 为单一来源）
  const themeConfig = useMemo<ThemeConfig>(() => {
    if (!editCss.trim()) return DEFAULT_THEME_CONFIG
    return cssToConfig(editCss)
  }, [editCss])

  // 触发预览渲染。
  useEffect(() => {
    if (!open) return
    if (!debouncedCss.trim() || !debouncedMarkdown.trim()) {
      return
    }
    void render(debouncedMarkdown, {
      ...PREVIEW_OPTIONS,
      customThemeCss: debouncedCss,
    })
  }, [open, debouncedCss, debouncedMarkdown, render])

  const updateConfig = useCallback(
    (updater: (cfg: ThemeConfig) => ThemeConfig) => {
      const next = updater(themeConfig)
      setEditCss(configToCss(next))
    },
    [themeConfig]
  )

  // ── 可视化设计 ↔ 手写 CSS 同步分类切换 ──────────────────────
  const codeEditorRef = useRef<CodeEditorRef>(null)
  // 防抖切换 visualCategory（避免光标拖动时频繁切换）
  const lastCssSelectLineRef = useRef<number>(-1)
  const handleCodeSelectionChange = useCallback(
    (line: number) => {
      // 仅在 css 模式下联动
      if (editMode !== 'css') return
      if (lastCssSelectLineRef.current === line) return
      lastCssSelectLineRef.current = line
      const cat = categoryAtLine(editCss, line)
      if (cat && cat !== visualCategory) {
        setVisualCategory(cat as VisualCategory)
      }
    },
    [editMode, editCss, visualCategory]
  )

  /** visual 字段点击 → 切到 CSS Tab + 滚动定位 */
  const handleVisualFieldClick = useCallback(
    (cat: VisualCategory) => {
      setEditMode('css')
      // 等一帧让 CodeEditor mount 后再 scroll
      requestAnimationFrame(() => {
        const selector = categorySelector(cat)
        const line = findSelectorLine(editCss, selector)
        if (line && codeEditorRef.current) {
          codeEditorRef.current.scrollToLine(line)
        }
      })
    },
    [editCss]
  )

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
        zIndex: 10001,
        // isolation 让 dialog 子元素形成独立 stacking context，
        // 避免父级 WenyanDialog 的 z-index 影响内部 portal 弹层。
        isolation: 'isolate',
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
          width: '90vw',
          height: '90vh',
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

          {/* Right: editor + preview */}
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
                {/* 名称输入 */}
                <div
                  style={{
                    padding: '12px 16px',
                    borderBottom: '1px solid #e5e7eb',
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center',
                    flexShrink: 0,
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

                {/* Mode tabs */}
                <div
                  style={{
                    display: 'flex',
                    gap: 4,
                    padding: '8px 16px 0',
                    borderBottom: '1px solid #e5e7eb',
                    flexShrink: 0,
                  }}
                >
                  <ModeTab
                    label="可视化设计"
                    active={editMode === 'visual'}
                    onClick={() => setEditMode('visual')}
                  />
                  <ModeTab
                    label="手写 CSS"
                    active={editMode === 'css'}
                    onClick={() => setEditMode('css')}
                  />
                </div>

                {/* Editor + preview body */}
                <div
                  style={{
                    flex: 1,
                    minHeight: 0,
                    display: 'flex',
                    flexDirection: 'row',
                  }}
                >
                  {/* Editor (left, 55%) */}
                  <div
                    style={{
                      flex: 1.2,
                      minWidth: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      borderRight: '1px solid #e5e7eb',
                    }}
                  >
                    {editMode === 'visual' ? (
                      <VisualEditor
                        config={themeConfig}
                        category={visualCategory}
                        onCategoryChange={setVisualCategory}
                        onChange={updateConfig}
                        onFieldClick={handleVisualFieldClick}
                      />
                    ) : (
                      <CodeEditor
                        ref={codeEditorRef}
                        value={editCss}
                        onChange={setEditCss}
                        language="css"
                        theme="oneDark"
                        onSelectionChange={handleCodeSelectionChange}
                        className="h-full w-full"
                      />
                    )}
                  </div>

                  {/* Preview (right, 45%) */}
                  <div
                    style={{
                      flex: 1,
                      minWidth: 0,
                      background: '#f3f4f6',
                      overflowY: 'auto',
                      padding: 24,
                      position: 'relative',
                    }}
                  >
                    {loading && (
                      <div
                        style={{
                          position: 'absolute',
                          top: 12,
                          right: 24,
                          zIndex: 10,
                          padding: '4px 10px',
                          background: 'rgba(0,0,0,0.7)',
                          color: '#fff',
                          borderRadius: 20,
                          fontSize: 11,
                        }}
                      >
                        渲染中…
                      </div>
                    )}
                    {error && (
                      <div
                        style={{
                          padding: 12,
                          background: '#fef2f2',
                          border: '1px solid #fecaca',
                          borderRadius: 6,
                          color: '#b91c1c',
                          fontSize: 12,
                          marginBottom: 12,
                        }}
                      >
                        渲染失败: {error}
                      </div>
                    )}
                    {!markdown ? (
                      <div
                        style={{
                          padding: 24,
                          textAlign: 'center',
                          color: '#9ca3af',
                          fontSize: 12,
                        }}
                      >
                        暂无可预览的 Markdown 内容
                      </div>
                    ) : (
                      <div
                        dangerouslySetInnerHTML={{ __html: html }}
                        style={{
                          maxWidth: 720,
                          margin: '0 auto',
                          background: '#fff',
                          minHeight: 200,
                          padding: '32px 24px',
                          boxSizing: 'border-box',
                          borderRadius: 4,
                          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                        }}
                      />
                    )}
                  </div>
                </div>

                {/* Bottom actions */}
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
                      background: '#1aad19',
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

// ---- 子组件 ----

/** 顶部模式 tab（可视化设计 / 手写 CSS） */
function ModeTab({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}): ReactNode {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 14px',
        fontSize: 12,
        fontWeight: active ? 600 : 400,
        color: active ? '#1aad19' : '#6b7280',
        background: 'transparent',
        border: 'none',
        borderBottom: active ? '2px solid #1aad19' : '2px solid transparent',
        marginBottom: -1,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  )
}

/** 嵌套分类 tab（全局 / 标题 / 段落 / 引用） */
function VisualCategoryTabs({
  category,
  onChange,
}: {
  category: VisualCategory
  onChange: (c: VisualCategory) => void
}): ReactNode {
  const items: Array<{ id: VisualCategory; label: string }> = [
    { id: 'global', label: '全局' },
    { id: 'heading', label: '标题' },
    { id: 'paragraph', label: '段落' },
    { id: 'quote', label: '引用' },
  ]
  return (
    <div
      style={{
        display: 'flex',
        gap: 6,
        padding: '10px 16px',
        borderBottom: '1px solid #e5e7eb',
        background: '#fafafa',
        flexShrink: 0,
      }}
    >
      {items.map((it) => {
        const active = category === it.id
        return (
          <button
            key={it.id}
            onClick={() => onChange(it.id)}
            style={{
              padding: '4px 12px',
              fontSize: 12,
              fontWeight: active ? 600 : 400,
              color: active ? '#fff' : '#374151',
              background: active ? '#1aad19' : '#fff',
              border: active ? '1px solid #1aad19' : '1px solid #d1d5db',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            {it.label}
          </button>
        )
      })}
    </div>
  )
}

// ---- 4 个分类面板的 ThemeConfig ↔ ElementStyle 桥接函数 ----
//
// 设计原则：editCss 是单一来源；ThemeConfig 通过 cssToConfig(editCss) 派生；
// ElementStyleEditor 的 value 由 ThemeConfig 派生而来，onChange 触发
// ThemeConfig 更新后再次 setEditCss(configToCss(next)) 写回。
// 桥接函数负责「主题模型 ↔ 通用样式模型」的双向转换。

/** 全局面板：绑 typography（注：colors.textColor 在 configToCss 中未输出，
 *  全局面板不再暴露 color 字段以避免无效操作） */
function mapGlobalToElementStyle(config: ThemeConfig): ElementStyle {
  return {
    // 把 FontFamily 关键字展开为 ElementStyle 的 CSS 字符串，便于在编辑器中显示
    fontFamily: FONT_FAMILY_CSS[config.typography.fontFamily],
    fontSize: config.typography.fontSize,
    lineHeight: config.typography.lineHeight,
    letterSpacing: config.typography.letterSpacing,
  }
}

function mergeGlobalFromElementStyle(
  config: ThemeConfig,
  next: ElementStyle
): ThemeConfig {
  // fontFamily 受 FontFamily 枚举约束，需要把 CSS 字符串归一化为关键字
  const fontFamilyKey: ThemeTypography['fontFamily'] =
    next.fontFamily !== undefined
      ? (resolveFontFamily(next.fontFamily) as ThemeTypography['fontFamily'])
      : config.typography.fontFamily
  return {
    ...config,
    typography: {
      ...config.typography,
      fontFamily: fontFamilyKey,
      fontSize: next.fontSize ?? config.typography.fontSize,
      lineHeight: next.lineHeight ?? config.typography.lineHeight,
      letterSpacing: next.letterSpacing ?? config.typography.letterSpacing,
    },
  }
}

/** 标题面板：绑 heading（按 level 拆分） */
function mapHeadingToElementStyle(
  config: ThemeConfig,
  level: HeadingLevel
): ElementStyle {
  // level 字段优先于 all；缺失字段回退到 all
  const fields: HeadingLevelFields = {
    ...(config.heading.all ?? {}),
    ...(config.heading[level] ?? {}),
  }
  return {
    color: fields.color,
    fontSize: fields.fontSize,
    lineHeight: fields.lineHeight,
    letterSpacing: fields.letterSpacing,
    textAlign: fields.textAlign,
    display: fields.display,
  }
}

function mergeHeadingFromElementStyle(
  config: ThemeConfig,
  level: HeadingLevel,
  next: ElementStyle
): ThemeConfig {
  // `all` 级别合并到 heading.all；具体 level 合并到 heading[level]
  const updateFields = (
    prev: HeadingLevelFields | undefined,
    src: ElementStyle
  ): HeadingLevelFields => {
    const merged: HeadingLevelFields = { ...(prev ?? {}) }
    if (next.color !== undefined) merged.color = next.color
    if (next.fontSize !== undefined) merged.fontSize = next.fontSize
    if (next.lineHeight !== undefined) merged.lineHeight = next.lineHeight
    if (next.letterSpacing !== undefined) merged.letterSpacing = next.letterSpacing
    if (next.textAlign !== undefined) merged.textAlign = next.textAlign
    if (next.display !== undefined) merged.display = next.display
    return merged
  }

  if (level === 'all') {
    return {
      ...config,
      heading: {
        ...config.heading,
        all: updateFields(config.heading.all, next),
      },
    }
  }
  return {
    ...config,
    heading: {
      ...config.heading,
      [level]: updateFields(config.heading[level], next),
    },
  }
}

/** 段落面板：绑 paragraph */
function mapParagraphToElementStyle(config: ThemeConfig): ElementStyle {
  return {
    fontFamily: config.paragraph.fontFamily,
    fontSize: config.paragraph.fontSize,
    color: config.paragraph.color,
    lineHeight: config.paragraph.lineHeight,
    letterSpacing: config.paragraph.letterSpacing,
    textAlign: config.paragraph.textAlign,
    padding: config.paragraph.padding,
    margin: config.paragraph.margin,
  }
}

function mergeParagraphFromElementStyle(
  config: ThemeConfig,
  next: ElementStyle
): ThemeConfig {
  return {
    ...config,
    paragraph: {
      ...config.paragraph,
      fontFamily: next.fontFamily,
      fontSize: next.fontSize,
      color: next.color,
      lineHeight: next.lineHeight,
      letterSpacing: next.letterSpacing,
      textAlign: next.textAlign,
      padding: next.padding,
      margin: next.margin,
    },
  }
}

/** 引用面板：绑 quote */
function mapQuoteToElementStyle(config: ThemeConfig): ElementStyle {
  return {
    color: config.quote.color,
    backgroundColor: config.quote.backgroundColor,
    borderRadius: config.quote.borderRadius,
    padding: config.quote.padding,
    border: config.quote.border,
    fontSize: config.quote.fontSize,
    display: config.quote.display,
  }
}

function mergeQuoteFromElementStyle(
  config: ThemeConfig,
  next: ElementStyle
): ThemeConfig {
  return {
    ...config,
    quote: {
      ...config.quote,
      color: next.color,
      backgroundColor: next.backgroundColor,
      borderRadius: next.borderRadius,
      padding: next.padding,
      border: next.border,
      fontSize: next.fontSize,
      display: next.display,
    },
  }
}

/** 可视化设计编辑器主组件 */
function VisualEditor({
  config,
  category,
  onCategoryChange,
  onChange,
  onFieldClick,
}: {
  config: ThemeConfig
  category: VisualCategory
  onCategoryChange: (c: VisualCategory) => void
  onChange: (updater: (cfg: ThemeConfig) => ThemeConfig) => void
  onFieldClick?: (cat: VisualCategory) => void
}): ReactNode {
  // 标题级别选择（仅在 heading 分类下生效）
  const [headingLevel, setHeadingLevel] = useState<HeadingLevel>('all')

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        // 横向不滚动（与 overflowY 区分；子控件用 box model 布局不再撑破）
        maxWidth: '100%',
      }}
    >
      <VisualCategoryTabs category={category} onChange={onCategoryChange} />
      {category === 'heading' && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 16px 0',
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 12, color: '#6b7280' }}>标题级别</span>
          <select
            value={headingLevel}
            onChange={(e) => setHeadingLevel(e.target.value as HeadingLevel)}
            style={{
              padding: '4px 8px',
              fontSize: 12,
              border: '1px solid #d1d5db',
              borderRadius: 4,
              background: '#fff',
              outline: 'none',
            }}
          >
            <option value="all">全部 (h1..h6)</option>
            <option value="h1">H1</option>
            <option value="h2">H2</option>
            <option value="h3">H3</option>
            <option value="h4">H4</option>
            <option value="h5">H5</option>
            <option value="h6">H6</option>
          </select>
          <span style={{ fontSize: 11, color: '#9ca3af' }}>
            {headingLevel === 'all'
              ? '编辑将应用到所有 h1-h6 标题'
              : `仅编辑 ${headingLevel} 标题，其它继承自「全部」`}
          </span>
        </div>
      )}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: 16,
        }}
      >
        {category === 'global' && (
          <ElementStyleEditor
            value={mapGlobalToElementStyle(config)}
            onChange={(next) => onChange((cfg) => mergeGlobalFromElementStyle(cfg, next))}
            onFieldClick={onFieldClick ? () => onFieldClick('global') : undefined}
            show={{
              fontFamily: true,
              fontSize: true,
              lineHeight: true,
              letterSpacing: true,
            }}
          />
        )}
        {category === 'heading' && (
          <ElementStyleEditor
            value={mapHeadingToElementStyle(config, headingLevel)}
            onChange={(next) =>
              onChange((cfg) => mergeHeadingFromElementStyle(cfg, headingLevel, next))
            }
            onFieldClick={onFieldClick ? () => onFieldClick('heading') : undefined}
            show={{
              color: true,
              fontSize: true,
              lineHeight: true,
              letterSpacing: true,
              textAlign: true,
              display: true,
            }}
          />
        )}
        {category === 'paragraph' && (
          <ElementStyleEditor
            value={mapParagraphToElementStyle(config)}
            onChange={(next) =>
              onChange((cfg) => mergeParagraphFromElementStyle(cfg, next))
            }
            onFieldClick={onFieldClick ? () => onFieldClick('paragraph') : undefined}
            show={{
              fontFamily: true,
              fontSize: true,
              color: true,
              lineHeight: true,
              letterSpacing: true,
              textAlign: true,
              padding: true,
              margin: true,
            }}
          />
        )}
        {category === 'quote' && (
          <ElementStyleEditor
            value={mapQuoteToElementStyle(config)}
            onChange={(next) => onChange((cfg) => mergeQuoteFromElementStyle(cfg, next))}
            onFieldClick={onFieldClick ? () => onFieldClick('quote') : undefined}
            show={{
              color: true,
              backgroundColor: true,
              borderRadius: true,
              padding: true,
              border: true,
              fontSize: true,
              display: true,
            }}
          />
        )}
      </div>
    </div>
  )
}
