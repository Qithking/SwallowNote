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
 * is derived from `editCss` via `parseThemeCss(editCss)`; every form
 * control writes back via `setEditCss(configToCss(newConfig, extraCss))`.
 * 桥接函数（map / merge / CATEGORY_FIELD_SHOW）抽离到 ./themeConfigBridges.ts。
 */
import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import type { PluginStorage } from '@swallow-note/plugin-sdk'
import { toast } from 'sonner'
import { useWenyanRenderer } from './useWenyanRenderer'
import {
  configToCss,
  DEFAULT_THEME_CONFIG,
  categoryAtLine,
  categorySelector,
  findSelectorLine,
  parseThemeCss,
  type ThemeConfig,
  type HeadingLevel,
} from './themeConfig'
import { VisualEditor, type VisualCategory } from './CustomThemeVisual'
import { CodeEditor, type CodeEditorRef } from '@/components/CodeEditor'
import { useDebounce } from '@/components/Plugin/useDebounce'
import { STORAGE_KEY, PREVIEW_OPTIONS, EXAMPLE_CUSTOM_CSS } from './constants'

export interface CustomTheme {
  /** Stable id of the form `custom:<uuid>`. */
  id: string
  name: string
  /** Raw CSS for the theme. */
  css: string
}

function newId(): string {
  // crypto.randomUUID exists in modern browsers / Tauri webview; the
  // fallback handles the standalone dev server.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `custom:${crypto.randomUUID()}`
  }
  return `custom:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 工具栏按钮共享样式。放在文件顶部（OPT-1/2/3/4 复用）。
 */
const TOOLBAR_BTN_STYLE: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: 12,
  borderRadius: 4,
  border: '1px solid #d1d5db',
  background: '#fff',
  color: '#111',
  cursor: 'pointer',
}

const TOOLBAR_BTN_DISABLED_STYLE: React.CSSProperties = {
  ...TOOLBAR_BTN_STYLE,
  color: '#9ca3af',
  cursor: 'not-allowed',
}

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
  /** Active note markdown content, used by the live preview. Optional. */
  markdown?: string
}

type EditMode = 'visual' | 'css'

/** 主题列表项（OPT-3：双击进入 inline 重命名） */
function ThemeListItem({
  name,
  active,
  onSelect,
  onRename,
}: {
  name: string
  active: boolean
  onSelect: () => void
  onRename: (newName: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // 进入编辑态时聚焦
  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  const commit = () => {
    setEditing(false)
    if (draft.trim() && draft !== name) onRename(draft)
    else setDraft(name)
  }

  return (
    <div
      onClick={!editing ? onSelect : undefined}
      onDoubleClick={() => {
        setDraft(name)
        setEditing(true)
      }}
      style={{
        padding: '8px 10px',
        margin: '2px 0',
        borderRadius: 4,
        cursor: editing ? 'text' : 'pointer',
        background: active ? '#dbeafe' : 'transparent',
        color: active ? '#1d4ed8' : '#374151',
        fontSize: 13,
        fontWeight: active ? 600 : 400,
      }}
    >
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            } else if (e.key === 'Escape') {
              setDraft(name)
              setEditing(false)
            }
          }}
          // 阻止点击/双击冒泡触发选中
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          style={{
            width: '100%',
            border: '1px solid #93c5fd',
            borderRadius: 3,
            padding: '2px 4px',
            fontSize: 13,
            outline: 'none',
          }}
        />
      ) : (
        <>
          {name}
          <span style={{ fontSize: 10, color: '#9ca3af', marginLeft: 6 }}>
            （双击重命名）
          </span>
        </>
      )}
    </div>
  )
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

  // 派生 ThemeConfig + extraCss（始终以 editCss 为单一来源）。
  // extraCss 收集用户手写但 ThemeConfig 不可识别的规则，
  // 改 visual 时由 configToCss(next, extraCss) 末尾追加，避免 roundtrip 丢失。
  const { themeConfig, extraCss } = useMemo<{
    themeConfig: ThemeConfig
    extraCss: string
  }>(() => {
    if (!editCss.trim()) return { themeConfig: DEFAULT_THEME_CONFIG, extraCss: '' }
    const parsed = parseThemeCss(editCss)
    return { themeConfig: parsed.config, extraCss: parsed.extraCss }
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
      // 把 extraCss 串回去，保留手写 CSS 额外规则
      setEditCss(configToCss(next, extraCss))
    },
    [themeConfig, extraCss]
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

  // OPT-1: 复制当前主题为新主题（id 用 newId()，name 加「-副本」）
  const handleDuplicate = useCallback(() => {
    if (!activeId) return
    const t = themes.find((x) => x.id === activeId)
    if (!t) return
    const id = newId()
    const dup: CustomTheme = {
      id,
      name: `${t.name}-副本`,
      css: t.css,
    }
    setThemes((prev) => {
      const next = [...prev, dup]
      void saveThemes(store, next)
      return next
    })
    setActiveId(id)
    toast.success('已复制主题')
  }, [activeId, themes, store])

  // OPT-2: 导出当前主题为 .json 文件（用 a 标签触发下载）
  const handleExport = useCallback(() => {
    if (!activeId) return
    const t = themes.find((x) => x.id === activeId)
    if (!t) return
    try {
      const blob = new Blob([JSON.stringify({ name: t.name, css: t.css }, null, 2)], {
        type: 'application/json',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${t.name || 'theme'}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      toast.error('导出主题失败')
      console.error('Export failed:', err)
    }
  }, [activeId, themes])

  // OPT-2: 导入主题（接受 .json；如失败则回退为 raw css 字符串）
  const handleImport = useCallback(() => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json,.css,text/css'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => {
        const text = String(reader.result ?? '')
        let name = file.name.replace(/\.(json|css)$/i, '')
        let css = text
        if (file.name.toLowerCase().endsWith('.json')) {
          try {
            const obj = JSON.parse(text)
            if (typeof obj.name === 'string') name = obj.name
            if (typeof obj.css === 'string') css = obj.css
          } catch (err) {
            toast.error('JSON 解析失败')
            return
          }
        }
        const id = newId()
        const theme: CustomTheme = { id, name, css }
        setThemes((prev) => {
          const next = [...prev, theme]
          void saveThemes(store, next)
          return next
        })
        setActiveId(id)
        toast.success('已导入主题')
      }
      reader.readAsText(file)
    }
    input.click()
  }, [store])

  // OPT-4: 删除带 undo（toast 提供 5s 撤销窗口）
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
    // 提供撤销能力
    const undo = () => {
      setThemes((prev) => {
        if (prev.some((x) => x.id === t.id)) return prev
        const next = [...prev, t]
        void saveThemes(store, next)
        return next
      })
      setActiveId(t.id)
    }
    toast.success(`已删除主题「${t.name}」`, {
      description: '5 秒内可撤销',
      action: { label: '撤销', onClick: undo },
      duration: 5000,
    })
  }, [activeId, themes, store])

  // OPT-3: inline 重命名（双击列表项进入编辑，blur/Enter 保存）
  const handleRename = useCallback(
    (id: string, name: string) => {
      const trimmed = name.trim()
      if (!trimmed) return
      setThemes((prev) => {
        const next = prev.map((x) => (x.id === id ? { ...x, name: trimmed } : x))
        void saveThemes(store, next)
        return next
      })
      toast.success('已重命名')
    },
    [store]
  )

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

  // OPT-7: 复制当前编辑区 CSS 到剪贴板（不依赖「保存」按钮，已存盘 vs 草稿都支持）
  const handleCopyCss = useCallback(async () => {
    if (!editCss.trim()) {
      toast.error('当前没有可复制的 CSS')
      return
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(editCss)
      } else {
        // 兜底：旧 webview / 非安全上下文下的 textarea 复制
        const ta = document.createElement('textarea')
        ta.value = editCss
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      }
      toast.success('CSS 已复制到剪贴板')
    } catch (err) {
      console.error('Copy CSS failed:', err)
      toast.error('复制失败，请手动选择文本')
    }
  }, [editCss])

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
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {/* OPT-7: 复制当前编辑区 CSS 到剪贴板 */}
            <button
              onClick={handleCopyCss}
              disabled={!editCss.trim()}
              title="复制当前 CSS 到剪贴板"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                background: 'transparent',
                border: '1px solid #d1d5db',
                cursor: editCss.trim() ? 'pointer' : 'not-allowed',
                padding: '4px 8px',
                borderRadius: 4,
                color: editCss.trim() ? '#374151' : '#9ca3af',
                fontSize: 12,
                lineHeight: 1,
              }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              复制 CSS
            </button>
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
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 6,
              }}
            >
              <button
                onClick={handleNew}
                style={TOOLBAR_BTN_STYLE}
              >
                新建
              </button>
              <button
                onClick={handleDuplicate}
                disabled={!activeId}
                style={!activeId ? TOOLBAR_BTN_DISABLED_STYLE : TOOLBAR_BTN_STYLE}
              >
                复制
              </button>
              <button
                onClick={handleImport}
                style={TOOLBAR_BTN_STYLE}
              >
                导入
              </button>
              <button
                onClick={handleExport}
                disabled={!activeId}
                style={!activeId ? TOOLBAR_BTN_DISABLED_STYLE : TOOLBAR_BTN_STYLE}
              >
                导出
              </button>
              <button
                onClick={handleDelete}
                disabled={!activeId}
                style={
                  !activeId
                    ? TOOLBAR_BTN_DISABLED_STYLE
                    : { ...TOOLBAR_BTN_STYLE, color: '#b91c1c', gridColumn: 'span 2' }
                }
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
                  <ThemeListItem
                    key={t.id}
                    name={t.name}
                    active={activeId === t.id}
                    onSelect={() => setActiveId(t.id)}
                    onRename={(newName) => handleRename(t.id, newName)}
                  />
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

/** 嵌套分类 tab 与可视化设计编辑器已抽离到 ./CustomThemeVisual.tsx
 *  - VisualCategoryTabs
 *  - VisualEditor
 *  - VisualCategory
 */
