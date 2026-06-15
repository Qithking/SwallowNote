/**
 * Toolbar button for the typist plugin.
 *
 * Mirrors the dropdown pattern from `plugins/export`:
 *   - "打开排版面板" activates the floating panel
 *   - "复制到公众号"  copies the current note directly without
 *     opening the panel
 *   - "保存为 HTML"   writes the rendered HTML to disk
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { PluginPanelProps, ToolbarButtonProps } from '@swallow-note/plugin-sdk'
import { usePluginStorage } from '@swallow-note/plugin-sdk'
import { save } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import { TypistIcon, CopyIcon, SaveIcon } from '../panel/icons'
import { copyToClipboard } from '../lib/copyToClipboard'
import { sanitizeHtmlForWeChat } from '../lib/htmlSanitizer'
import { DEFAULT_THEME_ID, DEFAULT_PLATFORM } from '../lib/themes'

export function TypistToolbarButton(props: ToolbarButtonProps): ReactNode {
  const { size, activate, activeNoteContent, activeNotePath, invokeBackend, store } = props
  const [menuOpen, setMenuOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  // The toolbar runs outside a `PluginPanelProps` context, but the
  // storage API is the same — it just needs a `pluginId` on a
  // PanelProps-shaped object. We synthesise a minimal adapter so the
  // shared hook works without the `panel.*` extras the panel has.
  const storeAdapter = {
    ...({ pluginId: props.pluginId } as Pick<PluginPanelProps, 'pluginId'>),
    store,
  } as unknown as PluginPanelProps

  // Read both theme and platform from the shared store. Previously the
  // platform was hard-coded to 'wechat' here, which meant a user who
  // switched to xiaohongshu (v0.2) in the panel would still get a
  // wechat-themed copy from the toolbar — the two entry points were
  // silently out of sync.
  const [themeId] = usePluginStorage<string>(storeAdapter, 'theme', DEFAULT_THEME_ID)
  const [platform] = usePluginStorage<string>(storeAdapter, 'platform', DEFAULT_PLATFORM)

  // Close on outside click
  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  const doCopy = useCallback(async () => {
    setMenuOpen(false)
    if (busy || !activeNoteContent) return
    setBusy(true)
    try {
      const html = (await invokeBackend('markdown_to_themed_html', {
        markdown: activeNoteContent,
        theme: themeId,
        platform,
      })) as string
      const safe = sanitizeHtmlForWeChat(html)
      // Toolbar has no preview DOM, so the L3 image-strategy in
      // copyToClipboard is intentionally bypassed. If both clipboard
      // strategies fail the helper returns ok:false with a generic
      // message; here we override it with one that actually tells
      // the user what to do next (open the panel, or save HTML).
      const result = await copyToClipboard(safe, null)
      if (result.ok) {
        if (result.method === 'clipboard-html') {
          toast.success('已复制到剪贴板（带样式）')
        } else if (result.method === 'clipboard-text') {
          toast.warning(result.warning)
        } else {
          // Unreachable: image method requires a preview element.
          toast.error('请打开排版面板后再试「复制为图片」')
        }
      } else {
        toast.error('所有复制方式均不可用，请打开排版面板后再试或保存为 HTML')
      }
    } catch (e) {
      toast.error(`复制失败: ${String(e)}`)
    } finally {
      setBusy(false)
    }
  }, [busy, activeNoteContent, themeId, platform, invokeBackend])

  const doSaveHtml = useCallback(async () => {
    setMenuOpen(false)
    if (busy || !activeNoteContent) return
    setBusy(true)
    try {
      const html = (await invokeBackend('markdown_to_themed_html', {
        markdown: activeNoteContent,
        theme: themeId,
        platform,
      })) as string
      const baseName = (activeNotePath.split('/').pop() || 'untitled').replace(
        /\.(md|markdown)$/i,
        '',
      )
      const fullDoc = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${baseName}</title>
<style>body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;max-width:720px;margin:40px auto;padding:0 16px;color:#333;}</style>
</head>
<body>
${html}
</body>
</html>`
      const target = await save({
        defaultPath: `${baseName}.html`,
        filters: [{ name: 'HTML', extensions: ['html'] }],
      })
      if (!target) {
        setBusy(false)
        return
      }
      const path = (typeof target === 'string' ? target : target).replace(/\\/g, '/')
      await invoke('write_text_file', { path, content: fullDoc })
      toast.success('已保存为 HTML')
    } catch (e) {
      toast.error(`保存失败: ${String(e)}`)
    } finally {
      setBusy(false)
    }
  }, [busy, activeNoteContent, activeNotePath, themeId, platform, invokeBackend])

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setMenuOpen(!menuOpen)}
        className="flex items-center justify-center w-6 h-6 rounded hover:bg-[var(--bg-hover)] cursor-pointer"
        style={{
          color: menuOpen ? 'var(--theme-color)' : 'var(--text-primary)',
        }}
        title="公众号排版"
      >
        <TypistIcon size={size} />
      </button>
      {menuOpen && (
        <div
          className="absolute right-0 top-full mt-1 z-50 rounded-lg py-1 min-w-[160px]"
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          }}
        >
          <MenuItem
            icon={<TypistIcon size={12} />}
            label="打开排版面板"
            onClick={() => {
              setMenuOpen(false)
              activate()
            }}
          />
          <MenuItem
            icon={<CopyIcon size={12} />}
            label="复制到公众号"
            onClick={doCopy}
            disabled={busy || !activeNoteContent}
          />
          <MenuItem
            icon={<SaveIcon size={12} />}
            label="保存为 HTML"
            onClick={doSaveHtml}
            disabled={busy || !activeNoteContent}
          />
        </div>
      )}
    </div>
  )
}

function MenuItem(props: {
  icon: ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
}): ReactNode {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        width: '100%',
        padding: '5px 12px',
        fontSize: 11,
        textAlign: 'left',
        background: 'transparent',
        border: 'none',
        color: 'var(--text-primary)',
        cursor: props.disabled ? 'not-allowed' : 'pointer',
        opacity: props.disabled ? 0.5 : 1,
      }}
      onMouseEnter={(e) => {
        if (!props.disabled) e.currentTarget.style.background = 'var(--bg-hover)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
      }}
    >
      {props.icon}
      {props.label}
    </button>
  )
}
