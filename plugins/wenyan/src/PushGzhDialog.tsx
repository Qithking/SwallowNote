/**
 * Push-to-GZH confirmation dialog.
 *
 * Pops up when the user clicks "推送到公众号" in the WenyanDialog.
 * Lets the user confirm / edit the article metadata (title, author,
 * digest, thumb, source URL) before invoking the Rust backend's
 * `push_to_gzh` JSON-RPC method.
 *
 * Field defaults are seeded from the plugin's `settings.json` values
 * (resolved via {@link resolveGzhSettings}); the title is pre-filled
 * from the Markdown front matter (surfaced by `useWenyanRenderer`).
 */
import { useState, useEffect, useCallback } from 'react'
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import type { GzhSettings } from './gzhSettings'

interface PushGzhDialogProps {
  open: boolean
  onClose: () => void
  /** Rendered HTML content to push (from useWenyanRenderer). */
  html: string
  /** Title extracted from front matter (pre-fill). */
  defaultTitle: string
  /** Resolved settings (AppID/AppSecret/defaults). */
  settings: GzhSettings
  /** Invoke the plugin's backend JSON-RPC command. */
  invokeBackend: (
    command: string,
    args?: Record<string, unknown>
  ) => Promise<unknown>
}

/**
 * Pull a JSON-RPC `code` and human-readable `message` out of an
 * unknown thrown value. The host wraps the backend's JSON-RPC error
 * response into a JS error whose `message` is the backend's
 * `display_with_code()` output, e.g. `"[ERR_CODE=2001] access_token
 * 获取失败: errcode=40125 ..."`.
 *
 * Mirrors the export plugin's `extractErrCode` helper.
 */
function extractErrCode(err: unknown): { code: number; message: string } {
  const raw = err instanceof Error ? err.message : String(err)
  const codeMatch = raw.match(/^\[ERR_CODE=(-?\d+)\]\s*([\s\S]*)$/)
  if (codeMatch) {
    const code = Number.parseInt(codeMatch[1], 10)
    return {
      code: Number.isFinite(code) ? code : 0,
      message: codeMatch[2].trim(),
    }
  }
  return { code: 0, message: raw }
}

export function PushGzhDialog(props: PushGzhDialogProps): ReactNode {
  const { open, onClose, html, defaultTitle, settings, invokeBackend } = props
  const [title, setTitle] = useState(defaultTitle)
  const [author, setAuthor] = useState(settings.gzhDefaultAuthor)
  const [digest, setDigest] = useState(settings.gzhDefaultDigest)
  const [thumbMediaId, setThumbMediaId] = useState(settings.gzhDefaultThumbMediaId)
  const [contentSourceUrl, setContentSourceUrl] = useState(
    settings.gzhContentSourceUrl
  )
  const [pushing, setPushing] = useState(false)

  // Re-seed local state whenever the dialog opens or the
  // defaults change (e.g. user edited settings then re-opened).
  useEffect(() => {
    if (!open) return
    setTitle(defaultTitle)
    setAuthor(settings.gzhDefaultAuthor)
    setDigest(settings.gzhDefaultDigest)
    setThumbMediaId(settings.gzhDefaultThumbMediaId)
    setContentSourceUrl(settings.gzhContentSourceUrl)
  }, [
    open,
    defaultTitle,
    settings.gzhDefaultAuthor,
    settings.gzhDefaultDigest,
    settings.gzhDefaultThumbMediaId,
    settings.gzhContentSourceUrl,
  ])

  const handlePush = useCallback(async () => {
    if (pushing) return
    if (!title.trim()) {
      toast.error('请填写标题')
      return
    }
    if (!html) {
      toast.error('内容为空，无法推送')
      return
    }
    setPushing(true)
    try {
      const result = (await invokeBackend('push_to_gzh', {
        app_id: settings.gzhAppId,
        app_secret: settings.gzhAppSecret,
        title: title.trim(),
        content: html,
        author: author.trim() || undefined,
        digest: digest.trim() || undefined,
        thumb_media_id: thumbMediaId.trim() || undefined,
        content_source_url: contentSourceUrl.trim() || undefined,
        need_open_comment: settings.gzhNeedOpenComment,
        only_fans_can_comment: settings.gzhOnlyFansCanComment,
      })) as { media_id?: string } | undefined

      const mediaId = result?.media_id ?? ''
      toast.success(
        mediaId
          ? `已推送到草稿箱，media_id: ${mediaId}`
          : '已推送到草稿箱'
      )
      onClose()
    } catch (e) {
      const { code, message } = extractErrCode(e)
      if (code === 2001) {
        toast.error(`access_token 获取失败: ${message}`)
      } else if (code === 2002) {
        toast.error(`草稿推送失败: ${message}`)
      } else if (code === 2003) {
        toast.error(`网络错误: ${message}`)
      } else {
        toast.error(`推送失败: ${message}`)
      }
    } finally {
      setPushing(false)
    }
  }, [
    pushing,
    title,
    html,
    author,
    digest,
    thumbMediaId,
    contentSourceUrl,
    settings,
    invokeBackend,
    onClose,
  ])

  // Close on Escape.
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !pushing) onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, pushing, onClose])

  if (!open) return null

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '6px 8px',
    fontSize: 13,
    borderRadius: 6,
    border: '1px solid #d1d5db',
    background: '#fff',
    color: '#111',
    boxSizing: 'border-box',
  }
  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 12,
    fontWeight: 600,
    color: '#6b7280',
    marginBottom: 4,
  }

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
        onClick={() => !pushing && onClose()}
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0,0,0,0.6)',
        }}
      />
      <div
        style={{
          position: 'relative',
          width: 480,
          maxHeight: '85vh',
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
            推送到公众号草稿箱
          </span>
          <button
            onClick={() => !pushing && onClose()}
            disabled={pushing}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: pushing ? 'not-allowed' : 'pointer',
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

        {/* Body */}
        <div
          style={{
            padding: 16,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <div>
            <label style={labelStyle}>
              标题 <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={pushing}
              style={inputStyle}
              placeholder="图文标题"
            />
          </div>

          <div>
            <label style={labelStyle}>作者</label>
            <input
              type="text"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              disabled={pushing}
              style={inputStyle}
              placeholder="作者名（可选）"
            />
          </div>

          <div>
            <label style={labelStyle}>摘要</label>
            <textarea
              value={digest}
              onChange={(e) => setDigest(e.target.value)}
              disabled={pushing}
              rows={3}
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
              placeholder="120字以内摘要，留空则公众号自动截取正文开头"
            />
          </div>

          <div>
            <label style={labelStyle}>封面图素材ID</label>
            <input
              type="text"
              value={thumbMediaId}
              onChange={(e) => setThumbMediaId(e.target.value)}
              disabled={pushing}
              style={inputStyle}
              placeholder="已上传素材的 media_id（可选）"
            />
          </div>

          <div>
            <label style={labelStyle}>原文链接</label>
            <input
              type="text"
              value={contentSourceUrl}
              onChange={(e) => setContentSourceUrl(e.target.value)}
              disabled={pushing}
              style={inputStyle}
              placeholder="「阅读原文」链接（可选）"
            />
          </div>

          <div
            style={{
              padding: '8px 10px',
              background: '#f9fafb',
              border: '1px solid #e5e7eb',
              borderRadius: 6,
              fontSize: 11,
              color: '#6b7280',
              lineHeight: 1.5,
            }}
          >
            推送目标：公众号「{settings.gzhAppId}」草稿箱。
            确认后将在公众号后台「草稿箱」中生成新图文，需手动发布。
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            padding: '12px 16px',
            borderTop: '1px solid #e5e7eb',
            flexShrink: 0,
          }}
        >
          <button
            onClick={() => !pushing && onClose()}
            disabled={pushing}
            style={{
              padding: '7px 16px',
              fontSize: 13,
              borderRadius: 6,
              border: '1px solid #d1d5db',
              background: '#fff',
              color: '#374151',
              cursor: pushing ? 'not-allowed' : 'pointer',
            }}
          >
            取消
          </button>
          <button
            onClick={handlePush}
            disabled={pushing || !title.trim() || !html}
            style={{
              padding: '7px 16px',
              fontSize: 13,
              fontWeight: 500,
              borderRadius: 6,
              border: 'none',
              background:
                pushing || !title.trim() || !html ? '#d1d5db' : '#1aad19',
              color: '#fff',
              cursor:
                pushing || !title.trim() || !html ? 'not-allowed' : 'pointer',
            }}
          >
            {pushing ? '推送中…' : '推送'}
          </button>
        </div>
      </div>
    </div>
  )
}
