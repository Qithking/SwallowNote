/**
 * Wenyan Typesetting Dialog — 90vw×90vh modal for preview and copy.
 *
 * Layout:
 *   - Left sidebar (240px): theme picker, hl-theme picker, toggles
 *   - Right main area: preview iframe + copy button
 */
import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import type { PluginStorage } from '@swallow-note/plugin-sdk'
import {
  useWenyanRenderer,
  PLATFORMS,
  PLATFORM_DEFAULT_THEME,
  type RenderOptions,
  type ParagraphOptions,
  type CodeBlockOptions,
  type Platform,
} from './useWenyanRenderer'
import { copyHtmlToClipboard } from './copyHtml'
import { exportHtmlToPng } from './exportImage'
import {
  CustomThemeDialog,
  type CustomTheme,
} from './CustomThemeDialog'
import { PushGzhDialog } from './PushGzhDialog'
import {
  resolveGzhSettings,
  isGzhConfigured,
  type GzhSettings,
} from './gzhSettings'
import { STORAGE_KEY, PREVIEW_OPTIONS } from './constants'
import { useDebounce } from '@/components/Plugin/useDebounce'

interface WenyanDialogProps {
  open: boolean
  onClose: () => void
  activeNoteContent: string
  store: PluginStorage
  /** Invoke the plugin's backend JSON-RPC command. */
  invokeBackend: (
    command: string,
    args?: Record<string, unknown>
  ) => Promise<unknown>
  /** Read every stored setting as a flat key/value map. */
  getAllSettings: () => Promise<Record<string, unknown>>
}

// Default settings —— 各子选项的默认值从 constants.ts 的 PREVIEW_OPTIONS 复用，
// 保证 WenyanDialog 初始 settings 与 CustomThemeDialog 预览保持一致。
const DEFAULT_OPTIONS: RenderOptions = {
  ...PREVIEW_OPTIONS,
  customThemeCss: null,
}

export function WenyanDialog(props: WenyanDialogProps): ReactNode {
  const { open, onClose, activeNoteContent, store, invokeBackend, getAllSettings } = props
  const { html, title, loading, error, render } = useWenyanRenderer()
  const [options, setOptions] = useState<RenderOptions>(DEFAULT_OPTIONS)
  const [gzhThemes, setGzhThemes] = useState<Array<{ id: string; name: string }>>([])
  const [otherThemes, setOtherThemes] = useState<Array<{ id: string; name: string }>>([])
  const [hlThemes, setHlThemes] = useState<Array<{ id: string; name: string }>>([])
  const [customThemes, setCustomThemes] = useState<CustomTheme[]>([])
  const [customDialogOpen, setCustomDialogOpen] = useState(false)
  const [copyBusy, setCopyBusy] = useState(false)
  const [exportBusy, setExportBusy] = useState(false)
  const [pushDialogOpen, setPushDialogOpen] = useState(false)
  const [gzhSettings, setGzhSettings] = useState<GzhSettings | null>(null)
  const [openSections, setOpenSections] = useState({
    theme: true,
    paragraph: false,
    codeBlock: false,
  })
  const previewRef = useRef<HTMLDivElement>(null)

  // The theme id currently in use. When a custom theme is picked, this
  // is a `custom:<uuid>` id; the renderer reads the CSS from
  // `options.customThemeCss`. When a built-in theme is picked, this is
  // the plain id and `options.customThemeCss` is null.
  const isCustomThemeActive = options.customThemeCss !== null

  // Load custom themes on dialog open.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    void store.get<CustomTheme[]>(STORAGE_KEY).then((v) => {
      if (cancelled) return
      setCustomThemes(v ?? [])
    })
    return () => {
      cancelled = true
    }
  }, [open, store])

  // Load 公众号 push settings on dialog open so the push button
  // knows whether to open the push dialog or prompt for config.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    void getAllSettings().then((raw) => {
      if (cancelled) return
      setGzhSettings(resolveGzhSettings(raw))
    })
    return () => {
      cancelled = true
    }
  }, [open, getAllSettings])

  // Filter the visible theme list to the current platform. For
  // non-WeChat platforms we pin the theme to the platform's default and
  // hide the picker (the library has only one theme per platform).
  const visibleThemes = useMemo<Array<{ id: string; name: string }>>(() => {
    if (options.platform === 'wechat') return gzhThemes
    return otherThemes
  }, [options.platform, gzhThemes, otherThemes])

  // Reload custom themes when the inner dialog closes so edits show up
  // in the parent dropdown without a full dialog reopen.
  useEffect(() => {
    if (customDialogOpen) return
    void store.get<CustomTheme[]>(STORAGE_KEY).then((v) => {
      setCustomThemes(v ?? [])
    })
  }, [customDialogOpen, store])

  const debouncedContent = useDebounce(activeNoteContent, 300)

  // Load theme lists once.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    async function load() {
      const mod = await import('@wenyan-md/core')
      mod.registerAllBuiltInThemes()
      mod.registerBuiltInHlThemes()
      const gzh = mod.getAllGzhThemes()
      const hl = mod.getAllHlThemes()
      // Pull all non-gzh built-in themes by checking which registered
      // themes are NOT in the gzh list.
      const allThemes = mod.getAllThemes()
      const gzhIds = new Set(
        gzh.map((t: unknown) => String((t as { meta?: { id?: string } }).meta?.id ?? ''))
      )
      const otherThemes = allThemes.filter((t: unknown) => {
        const id = String((t as { meta?: { id?: string } }).meta?.id ?? '')
        return id && !gzhIds.has(id)
      })
      if (cancelled) return
      // @wenyan-md/core 主题结构：
      //   - gzh 主题：{ meta: { id, name, ... }, getCss }
      //   - hl  主题：{ id, getCss } （name 派生自 id）
      const gzhList = gzh.map((t: unknown) => {
        const meta = (t as { meta?: { id?: string; name?: string } }).meta ?? {}
        const id = String(meta.id ?? '')
        return { id, name: String(meta.name ?? id) }
      })
      const otherList = otherThemes.map((t: unknown) => {
        const meta = (t as { meta?: { id?: string; name?: string } }).meta ?? {}
        const id = String(meta.id ?? '')
        return { id, name: String(meta.name ?? id) }
      })
      setGzhThemes(gzhList)
      setOtherThemes(otherList)
      setHlThemes(hl.map((t: unknown) => {
        const theme = t as { id?: string }
        const id = String(theme.id ?? '')
        return { id, name: id }
      }))
    }
    load()
    return () => { cancelled = true }
  }, [open])

  // Render on content / option changes.
  useEffect(() => {
    if (!open) return
    render(debouncedContent, options)
  }, [open, debouncedContent, options, render])

  // Close on Escape.
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  const handleCopy = useCallback(async () => {
    if (copyBusy || !html) return
    setCopyBusy(true)
    try {
      const result = await copyHtmlToClipboard(html)
      if (result.ok) {
        if (result.method === 'clipboard-html') {
          toast.success('已复制到剪贴板（带样式）')
        } else {
          toast.warning(result.warning || '已复制')
        }
      } else {
        toast.error('复制失败，请手动复制')
      }
    } catch (e) {
      toast.error(`复制失败: ${String(e)}`)
    } finally {
      setCopyBusy(false)
    }
  }, [copyBusy, html])

  const handleExport = useCallback(async () => {
    if (exportBusy || !previewRef.current) return
    setExportBusy(true)
    const platformName =
      PLATFORMS.find((p) => p.id === options.platform)?.name ?? options.platform
    const ts = new Date()
      .toISOString()
      .replace(/[-:]/g, '')
      .replace('T', '-')
      .slice(0, 15)
    const filename = `wenyan-${platformName}-${ts}`
    try {
      const result = await exportHtmlToPng(previewRef.current, { filename })
      if (result.ok) {
        toast.success(`已导出长图：${result.path}`)
      } else if (result.cancelled) {
        // User cancelled the directory picker – no toast, no error.
      } else {
        toast.error(`导出失败：${result.error ?? '未知错误'}`)
      }
    } catch (e) {
      toast.error(`导出失败：${String(e)}`)
    } finally {
      setExportBusy(false)
    }
  }, [exportBusy, options.platform])

  const handlePushClick = useCallback(() => {
    if (!html || loading) return
    if (!gzhSettings || !isGzhConfigured(gzhSettings)) {
      toast.error('请先在插件设置中配置公众号 AppID 和 AppSecret')
      return
    }
    setPushDialogOpen(true)
  }, [html, loading, gzhSettings])

  if (!open) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Overlay */}
      <div
        onClick={onClose}
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0,0,0,0.6)',
        }}
      />

      {/* Dialog content */}
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
          <span style={{ fontSize: 15, fontWeight: 600, color: '#111' }}>文颜排版预览</span>
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
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
          {/* Left sidebar */}
          <div
            style={{
              width: 240,
              flexShrink: 0,
              borderRight: '1px solid #e5e7eb',
              padding: 16,
              overflowY: 'auto',
              background: '#f9fafb',
            }}
          >
            <Section title="目标平台">
              <select
                value={options.platform}
                onChange={(e) => {
                  const platform = e.target.value as Platform
                  setOptions((o) => ({
                    ...o,
                    platform,
                    // Reset theme to the platform's default so the
                    // controlled <select> always has a valid value.
                    themeId: PLATFORM_DEFAULT_THEME[platform],
                    // 同步清空 customThemeCss，避免 select 显示内置主题
                    // 但渲染管线仍叠加旧 custom CSS 的不一致问题。
                    customThemeCss: null,
                  }))
                }}
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  fontSize: 13,
                  borderRadius: 6,
                  border: '1px solid #d1d5db',
                  background: '#fff',
                  color: '#111',
                }}
              >
                {PLATFORMS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Section>

            <Section title="文章主题">
              <select
                value={options.themeId}
                onChange={(e) => {
                  const id = e.target.value
                  // When a custom theme is selected, also populate
                  // customThemeCss so the renderer can pass it
                  // directly to the library.
                  const custom = customThemes.find((t) => t.id === id)
                  setOptions((o) => ({
                    ...o,
                    themeId: id,
                    customThemeCss: custom ? custom.css : null,
                  }))
                }}
                disabled={options.platform !== 'wechat'}
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  fontSize: 13,
                  borderRadius: 6,
                  border: '1px solid #d1d5db',
                  background: options.platform !== 'wechat' ? '#f3f4f6' : '#fff',
                  color: options.platform !== 'wechat' ? '#9ca3af' : '#111',
                  cursor: options.platform !== 'wechat' ? 'not-allowed' : 'pointer',
                }}
              >
                {visibleThemes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
                {customThemes.length > 0 && (
                  <optgroup label="— 自定义主题 —">
                    {customThemes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              <button
                onClick={() => setCustomDialogOpen(true)}
                disabled={options.platform !== 'wechat'}
                style={{
                  marginTop: 6,
                  width: '100%',
                  padding: '5px 8px',
                  fontSize: 12,
                  borderRadius: 4,
                  border: '1px dashed #d1d5db',
                  background: '#fff',
                  color: options.platform !== 'wechat' ? '#9ca3af' : '#374151',
                  cursor: options.platform !== 'wechat' ? 'not-allowed' : 'pointer',
                }}
                title="管理自定义主题"
              >
                自定义主题…
              </button>
              {options.platform !== 'wechat' && (
                <div
                  style={{
                    fontSize: 11,
                    color: '#9ca3af',
                    marginTop: 4,
                  }}
                >
                  该平台仅提供内置主题
                </div>
              )}
            </Section>

            <Section title="代码高亮">
              <select
                value={options.hlThemeId}
                onChange={(e) => setOptions((o) => ({ ...o, hlThemeId: e.target.value }))}
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  fontSize: 13,
                  borderRadius: 6,
                  border: '1px solid #d1d5db',
                  background: '#fff',
                  color: '#111',
                }}
              >
                {hlThemes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Section>

            {options.platform === 'wechat' && (
              <Section title="排版选项">
                <Toggle
                  label="自动脚注"
                  checked={options.isAddFootnote}
                  onChange={(v) => setOptions((o) => ({ ...o, isAddFootnote: v }))}
                />
              </Section>
            )}

            <CollapsibleSection
              title="主题设置"
              open={openSections.theme}
              onToggle={() => setOpenSections((s) => ({ ...s, theme: !s.theme }))}
            >
              <Toggle
                label="跟随主题"
                checked={options.themeFollowTheme}
                onChange={(v) =>
                  setOptions((o) => ({ ...o, themeFollowTheme: v }))
                }
              />
              {!options.themeFollowTheme && (
                <>
                  <ColorRow
                    label="主色"
                    value={options.themeOverrides.primaryColor}
                    onChange={(v) =>
                      setOptions((o) => ({
                        ...o,
                        themeOverrides: { ...o.themeOverrides, primaryColor: v },
                      }))
                    }
                  />
                  <ColorRow
                    label="引用块背景"
                    value={options.themeOverrides.blockquoteBg}
                    onChange={(v) =>
                      setOptions((o) => ({
                        ...o,
                        themeOverrides: { ...o.themeOverrides, blockquoteBg: v },
                      }))
                    }
                  />
                  <ColorRow
                    label="文字色"
                    value={options.themeOverrides.textColor}
                    onChange={(v) =>
                      setOptions((o) => ({
                        ...o,
                        themeOverrides: { ...o.themeOverrides, textColor: v },
                      }))
                    }
                  />
                </>
              )}
            </CollapsibleSection>

            <CollapsibleSection
              title="段落设置"
              open={openSections.paragraph}
              onToggle={() =>
                setOpenSections((s) => ({ ...s, paragraph: !s.paragraph }))
              }
            >
              <Toggle
                label="跟随主题"
                checked={options.paragraphFollowTheme}
                onChange={(v) =>
                  setOptions((o) => ({ ...o, paragraphFollowTheme: v }))
                }
              />
              {!options.paragraphFollowTheme && (
                <>
                  <SelectRow
                    label="字号"
                    value={String(options.paragraphOptions.fontSize)}
                    onChange={(v) =>
                      setOptions((o) => ({
                        ...o,
                        paragraphOptions: {
                          ...o.paragraphOptions,
                          fontSize: Number(v) as ParagraphOptions['fontSize'],
                        },
                      }))
                    }
                    options={[
                      { value: '12', label: '12px 紧凑' },
                      { value: '13', label: '13px' },
                      { value: '14', label: '14px 小' },
                      { value: '15', label: '15px' },
                      { value: '16', label: '16px 标准' },
                      { value: '17', label: '17px' },
                      { value: '18', label: '18px 大' },
                      { value: '19', label: '19px' },
                      { value: '20', label: '20px 加大' },
                    ]}
                  />
                  <SelectRow
                    label="行高"
                    value={String(options.paragraphOptions.lineHeight)}
                    onChange={(v) =>
                      setOptions((o) => ({
                        ...o,
                        paragraphOptions: {
                          ...o.paragraphOptions,
                          lineHeight: Number(v) as ParagraphOptions['lineHeight'],
                        },
                      }))
                    }
                    options={[
                      { value: '1.25', label: '1.25 紧凑' },
                      { value: '1.5', label: '1.5 标准' },
                      { value: '1.75', label: '1.75 较大' },
                      { value: '2', label: '2 大' },
                    ]}
                  />
                  <SelectRow
                    label="行间距"
                    value={String(options.paragraphOptions.lineSpacing)}
                    onChange={(v) =>
                      setOptions((o) => ({
                        ...o,
                        paragraphOptions: {
                          ...o.paragraphOptions,
                          lineSpacing: Number(v) as ParagraphOptions['lineSpacing'],
                        },
                      }))
                    }
                    options={[
                      { value: '0', label: '小 (0em)' },
                      { value: '0.1', label: '正常 (0.1em)' },
                      { value: '0.2', label: '较大 (0.2em)' },
                      { value: '0.3', label: '大 (0.3em)' },
                    ]}
                  />
                  <SelectRow
                    label="字体"
                    value={options.paragraphOptions.fontFamily}
                    onChange={(v) =>
                      setOptions((o) => ({
                        ...o,
                        paragraphOptions: {
                          ...o.paragraphOptions,
                          fontFamily: v as ParagraphOptions['fontFamily'],
                        },
                      }))
                    }
                    options={[
                      { value: 'sans-serif', label: '无衬线' },
                      { value: 'serif', label: '衬线' },
                      { value: 'monospace', label: '等宽' },
                    ]}
                  />
                  <SelectRow
                    label="字间距"
                    value={options.paragraphOptions.letterSpacing}
                    onChange={(v) =>
                      setOptions((o) => ({
                        ...o,
                        paragraphOptions: {
                          ...o.paragraphOptions,
                          letterSpacing: v as ParagraphOptions['letterSpacing'],
                        },
                      }))
                    }
                    options={[
                      { value: 'tight', label: '紧凑 (-0.02em)' },
                      { value: 'small', label: '小 (-0.01em)' },
                      { value: 'normal', label: '正常' },
                      { value: 'loose', label: '宽松 (0.05em)' },
                    ]}
                  />
                  <SelectRow
                    label="段间距"
                    value={options.paragraphOptions.paragraphSpacing}
                    onChange={(v) =>
                      setOptions((o) => ({
                        ...o,
                        paragraphOptions: {
                          ...o.paragraphOptions,
                          paragraphSpacing: v as ParagraphOptions['paragraphSpacing'],
                        },
                      }))
                    }
                    options={[
                      { value: 'compact', label: '紧凑 (0.3em)' },
                      { value: 'small', label: '小 (0.5em)' },
                      { value: 'standard', label: '标准 (1em)' },
                      { value: 'loose', label: '宽松 (1.6em)' },
                    ]}
                  />
                  <SelectRow
                    label="段落对齐"
                    value={options.paragraphOptions.textAlign}
                    onChange={(v) =>
                      setOptions((o) => ({
                        ...o,
                        paragraphOptions: {
                          ...o.paragraphOptions,
                          textAlign: v as ParagraphOptions['textAlign'],
                        },
                      }))
                    }
                    options={[
                      { value: 'left', label: '左对齐' },
                      { value: 'center', label: '居中' },
                      { value: 'right', label: '右对齐' },
                      { value: 'justify', label: '两端' },
                    ]}
                  />
                  <SelectRow
                    label="首行缩进"
                    value={String(options.paragraphOptions.textIndent)}
                    onChange={(v) =>
                      setOptions((o) => ({
                        ...o,
                        paragraphOptions: {
                          ...o.paragraphOptions,
                          textIndent: Number(v) as ParagraphOptions['textIndent'],
                        },
                      }))
                    }
                    options={[
                      { value: '0', label: '无' },
                      { value: '2', label: '2em' },
                    ]}
                  />
                </>
              )}
            </CollapsibleSection>

            <CollapsibleSection
              title="代码块设置"
              open={openSections.codeBlock}
              onToggle={() =>
                setOpenSections((s) => ({ ...s, codeBlock: !s.codeBlock }))
              }
            >
              <Toggle
                label="跟随主题"
                checked={options.codeBlockFollowTheme}
                onChange={(v) =>
                  setOptions((o) => ({ ...o, codeBlockFollowTheme: v }))
                }
              />
              {!options.codeBlockFollowTheme && (
                <>
                  <SelectRow
                    label="圆角"
                    value={String(options.codeBlockOptions.borderRadius)}
                    onChange={(v) =>
                      setOptions((o) => ({
                        ...o,
                        codeBlockOptions: {
                          ...o.codeBlockOptions,
                          borderRadius: Number(v) as CodeBlockOptions['borderRadius'],
                        },
                      }))
                    }
                    options={[
                      { value: '0', label: '无圆角' },
                      { value: '5', label: '5px' },
                      { value: '10', label: '10px' },
                    ]}
                  />
                  <SelectRow
                    label="字号"
                    value={String(options.codeBlockOptions.fontSize)}
                    onChange={(v) =>
                      setOptions((o) => ({
                        ...o,
                        codeBlockOptions: {
                          ...o.codeBlockOptions,
                          fontSize: Number(v) as CodeBlockOptions['fontSize'],
                        },
                      }))
                    }
                    options={[
                      { value: '12', label: '12px' },
                      { value: '13', label: '13px' },
                      { value: '14', label: '14px' },
                      { value: '15', label: '15px' },
                      { value: '16', label: '16px' },
                      { value: '17', label: '17px' },
                      { value: '18', label: '18px' },
                    ]}
                  />
                  <SelectRow
                    label="阴影"
                    value={options.codeBlockOptions.shadow}
                    onChange={(v) =>
                      setOptions((o) => ({
                        ...o,
                        codeBlockOptions: {
                          ...o.codeBlockOptions,
                          shadow: v as CodeBlockOptions['shadow'],
                        },
                      }))
                    }
                    options={[
                      { value: 'none', label: '无' },
                      { value: 'light', label: '轻' },
                      { value: 'heavy', label: '重' },
                    ]}
                  />
                  <Toggle
                    label="macOS 风格"
                    checked={options.codeBlockOptions.isMacStyle}
                    onChange={(v) =>
                      setOptions((o) => ({
                        ...o,
                        codeBlockOptions: { ...o.codeBlockOptions, isMacStyle: v },
                      }))
                    }
                  />
                </>
              )}
            </CollapsibleSection>

            <div style={{ marginTop: 20 }}>
              <button
                onClick={handleCopy}
                disabled={copyBusy || !html || loading}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  fontSize: 13,
                  fontWeight: 500,
                  borderRadius: 6,
                  border: 'none',
                  background: copyBusy || !html || loading ? '#d1d5db' : '#111827',
                  color: '#fff',
                  cursor: copyBusy || !html || loading ? 'not-allowed' : 'pointer',
                }}
              >
                {copyBusy ? '复制中…' : '复制到剪贴板'}
              </button>
              <button
                onClick={handleExport}
                disabled={exportBusy || !html || loading}
                style={{
                  marginTop: 6,
                  width: '100%',
                  padding: '8px 12px',
                  fontSize: 13,
                  fontWeight: 500,
                  borderRadius: 6,
                  border: '1px solid #111827',
                  background: exportBusy || !html || loading ? '#f3f4f6' : '#fff',
                  color: exportBusy || !html || loading ? '#9ca3af' : '#111827',
                  cursor: exportBusy || !html || loading ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                {exportBusy ? '导出中…' : '导出长图'}
              </button>
              <button
                onClick={handlePushClick}
                disabled={!html || loading}
                style={{
                  marginTop: 6,
                  width: '100%',
                  padding: '8px 12px',
                  fontSize: 13,
                  fontWeight: 500,
                  borderRadius: 6,
                  border: '1px solid #1aad19',
                  background: !html || loading ? '#f3f4f6' : '#fff',
                  color: !html || loading ? '#9ca3af' : '#1aad19',
                  cursor: !html || loading ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
                推送到公众号
              </button>
            </div>
          </div>

          {/* Right preview */}
          <div
            style={{
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              background: '#f3f4f6',
            }}
          >
            {loading && (
              <div
                style={{
                  position: 'absolute',
                  top: 56,
                  right: 24,
                  zIndex: 10,
                  padding: '6px 12px',
                  background: 'rgba(0,0,0,0.7)',
                  color: '#fff',
                  borderRadius: 20,
                  fontSize: 12,
                }}
              >
                渲染中…
              </div>
            )}

            {error && (
              <div
                style={{
                  margin: 16,
                  padding: 12,
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: 6,
                  color: '#b91c1c',
                  fontSize: 13,
                }}
              >
                渲染失败: {error}
              </div>
            )}

            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: 24,
              }}
            >
              <div
                ref={previewRef}
                dangerouslySetInnerHTML={{ __html: html }}
                style={{
                  maxWidth: 720,
                  margin: '0 auto',
                  background: '#fff',
                  minHeight: '100%',
                  padding: '32px 24px',
                  boxSizing: 'border-box',
                  borderRadius: 4,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                  // 强制允许文本选择：Tauri macOS WKWebView 在透明无边框
                  // 窗口下可能默认禁用文本选择，需显式覆盖。
                  userSelect: 'text',
                  WebkitUserSelect: 'text',
                }}
              />
            </div>
          </div>
        </div>
      </div>

      <CustomThemeDialog
        store={store}
        open={customDialogOpen}
        onClose={() => setCustomDialogOpen(false)}
        selectedId={isCustomThemeActive ? options.themeId : null}
        markdown={activeNoteContent}
        onSelect={(theme) => {
          setOptions((o) => ({
            ...o,
            themeId: theme.id,
            customThemeCss: theme.css,
          }))
          setCustomDialogOpen(false)
          toast.success(`已切换到自定义主题「${theme.name}」`)
        }}
      />

      {gzhSettings && (
        <PushGzhDialog
          open={pushDialogOpen}
          onClose={() => setPushDialogOpen(false)}
          html={html}
          defaultTitle={title}
          settings={gzhSettings}
          invokeBackend={invokeBackend}
        />
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: '#6b7280',
          textTransform: 'uppercase',
          marginBottom: 8,
          letterSpacing: 0.5,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  )
}

function CollapsibleSection({
  title,
  open,
  onToggle,
  children,
}: {
  title: string
  open: boolean
  onToggle: () => void
  children: ReactNode
}): ReactNode {
  return (
    <div style={{ marginBottom: 12 }}>
      <button
        onClick={onToggle}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 0',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          fontSize: 12,
          fontWeight: 600,
          color: '#6b7280',
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}
        aria-expanded={open}
      >
        <span>{title}</span>
        <span
          style={{
            fontSize: 10,
            transition: 'transform 0.15s',
            transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
          }}
        >
          ▶
        </span>
      </button>
      {open && (
        <div
          style={{
            padding: '4px 0 8px',
            borderTop: '1px solid #e5e7eb',
            marginTop: 4,
            paddingTop: 12,
          }}
        >
          {children}
        </div>
      )}
    </div>
  )
}

function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}): ReactNode {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '4px 0',
        fontSize: 13,
        color: '#374151',
      }}
    >
      <span>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{
            width: 28,
            height: 22,
            padding: 0,
            border: '1px solid #d1d5db',
            borderRadius: 4,
            cursor: 'pointer',
            background: 'transparent',
          }}
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{
            width: 80,
            padding: '3px 6px',
            fontSize: 11,
            borderRadius: 4,
            border: '1px solid #d1d5db',
            fontFamily: 'monospace',
            color: '#111',
          }}
        />
      </div>
    </label>
  )
}

function SelectRow({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: Array<{ value: string; label: string }>
}): ReactNode {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '4px 0',
        fontSize: 13,
        color: '#374151',
        gap: 8,
      }}
    >
      <span style={{ flexShrink: 0 }}>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          flex: 1,
          padding: '4px 6px',
          fontSize: 12,
          borderRadius: 4,
          border: '1px solid #d1d5db',
          background: '#fff',
          color: '#111',
          minWidth: 0,
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}): ReactNode {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '6px 0',
        cursor: 'pointer',
        fontSize: 13,
        color: '#374151',
      }}
    >
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ cursor: 'pointer' }}
      />
    </label>
  )
}
