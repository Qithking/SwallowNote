/**
 * UploadTab — drag-drop, clipboard paste, file picker, progress
 * bar, and result card.
 *
 * Layout:
 *   - Dashed drop zone (click to open file picker)
 *   - Two shortcut buttons (clipboard / file)
 *   - Per-file progress + result card
 *
 * Each picked file produces its own preview card with an
 * independent upload button so multi-file drops can be reviewed
 * before submission.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { PluginPanelProps } from '@swallow-note/plugin-sdk'
import { toast } from 'sonner'
import { open as tauriOpen } from '@tauri-apps/plugin-dialog'
import type { AllSettings, UploadResult, ProviderId } from '../types'
import { uploadImage } from '../lib/uploader'
import { resolveSettings, isProviderConfigured } from '../lib/settings'
import { readClipboardImage, clipboardImageName } from '../lib/clipboard'
import { PROVIDERS, getProviderDisplayName } from '../providers'
import { UploadResultCard } from '../components/UploadResultCard'
import { insertIntoNote } from '../lib/editor-insert'

interface PendingFile {
  id: string
  file: Blob
  filename: string
  size: number
  previewUrl: string
  status: 'idle' | 'uploading' | 'done' | 'error'
  progress: number
  result?: UploadResult
  error?: string
}

interface UploadTabProps extends Pick<PluginPanelProps, 'getAllSettings' | 'store' | 'activeNoteContent'> {
  activeProvider: ProviderId
  onProviderChange: (id: ProviderId) => void
  refreshTick: number
}

function nextId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `f-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

export function UploadTab({
  getAllSettings,
  store,
  activeNoteContent,
  activeProvider,
  onProviderChange,
  refreshTick,
}: UploadTabProps): ReactNode {
  const [pending, setPending] = useState<PendingFile[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [settings, setSettings] = useState<AllSettings | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map())

  // Load settings on mount + whenever the panel asks us to.
  useEffect(() => {
    let cancelled = false
    void getAllSettings().then((raw) => {
      if (cancelled) return
      setSettings(resolveSettings(raw))
    })
    return () => {
      cancelled = true
    }
  }, [getAllSettings, refreshTick])

  // Revoke any object URLs on unmount.
  useEffect(() => {
    const urls = pending.map((p) => p.previewUrl)
    return () => {
      for (const url of urls) URL.revokeObjectURL(url)
    }
    // We intentionally only re-run when the pending list changes.
  }, [pending])

  const addFiles = useCallback((files: File[]) => {
    if (files.length === 0) return
    setPending((cur) => {
      const next = [...cur]
      for (const f of files) {
        if (!f.type.startsWith('image/')) {
          toast.error(`仅支持图片文件：${f.name}`)
          continue
        }
        next.push({
          id: nextId(),
          file: f,
          filename: f.name,
          size: f.size,
          previewUrl: URL.createObjectURL(f),
          status: 'idle',
          progress: 0,
        })
      }
      return next
    })
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      setDragOver(false)
      const files: File[] = []
      if (e.dataTransfer.files) {
        for (let i = 0; i < e.dataTransfer.files.length; i++) {
          const f = e.dataTransfer.files[i]
          if (f) files.push(f)
        }
      }
      addFiles(files)
    },
    [addFiles]
  )

  const onPick = useCallback(async () => {
    try {
      const selected = await tauriOpen({
        multiple: true,
        filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }],
      })
      if (!selected) return
      const paths = Array.isArray(selected) ? selected : [selected]
      const files: File[] = []
      for (const p of paths) {
        // The Tauri dialog returns a filesystem path; we read it
        // through fetch on a `convertFileSrc` URL would be the
        // canonical Tauri 2 path, but a plain `fetch` on a
        // local path works in the webview. If that fails, we
        // fall back to leaving the path as a string and skipping
        // — the user can retry from clipboard.
        try {
          const resp = await fetch(`file://${p}`)
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
          const blob = await resp.blob()
          const name = p.split(/[\\/]/).pop() || `image-${Date.now()}.png`
          files.push(new File([blob], name, { type: blob.type || 'image/*' }))
        } catch (err) {
          console.warn('[picgo] failed to read picked file:', err)
          toast.error(`读取文件失败：${p}`)
        }
      }
      addFiles(files)
    } catch (err) {
      // Tauri not available — fall back to a hidden <input>.
      console.warn('[picgo] tauri dialog failed, falling back:', err)
      fileInputRef.current?.click()
    }
  }, [addFiles])

  const onClipboard = useCallback(async () => {
    const blob = await readClipboardImage()
    if (!blob) {
      toast.error('剪贴板中没有图片')
      return
    }
    const filename = clipboardImageName(blob.type || 'image/png')
    setPending((cur) => [
      ...cur,
      {
        id: nextId(),
        file: blob,
        filename,
        size: blob.size,
        previewUrl: URL.createObjectURL(blob),
        status: 'idle',
        progress: 0,
      },
    ])
  }, [])

  const startUpload = useCallback(
    async (id: string) => {
      if (!settings) {
        toast.error('设置尚未加载，请稍后重试')
        return
      }
      const item = pending.find((p) => p.id === id)
      if (!item) return

      if (!isProviderConfigured(activeProvider, settings)) {
        toast.error(`${getProviderDisplayName(activeProvider)} 未配置完整，请到设置中填写`)
        return
      }

      const ctrl = new AbortController()
      abortControllersRef.current.set(id, ctrl)

      setPending((cur) =>
        cur.map((p) => (p.id === id ? { ...p, status: 'uploading', progress: 5, error: undefined } : p))
      )

      try {
        const result = await uploadImage(
          {
            file: item.file,
            filename: item.filename,
            providerId: activeProvider,
            settings,
            signal: ctrl.signal,
            onProgress: (state) => {
              setPending((cur) =>
                cur.map((p) => (p.id === id ? { ...p, progress: state.percent } : p))
              )
            },
          },
          { getAllSettings, store }
        )
        setPending((cur) =>
          cur.map((p) =>
            p.id === id
              ? { ...p, status: 'done', progress: 100, result }
              : p
          )
        )
        // Best-effort: also build the text the user can insert.
        const { text } = insertIntoNote(result, settings.linkFormat, activeNoteContent)
        toast.success(`已上传：${result.filename}`, {
          description: text,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setPending((cur) =>
          cur.map((p) =>
            p.id === id ? { ...p, status: 'error', error: message } : p
          )
        )
        toast.error(message)
      } finally {
        abortControllersRef.current.delete(id)
      }
    },
    [pending, settings, activeProvider, getAllSettings, store, activeNoteContent]
  )

  const cancelUpload = useCallback((id: string) => {
    const ctrl = abortControllersRef.current.get(id)
    if (ctrl) ctrl.abort(new Error('cancelled by user'))
  }, [])

  const removeFile = useCallback((id: string) => {
    setPending((cur) => {
      const target = cur.find((p) => p.id === id)
      if (target) URL.revokeObjectURL(target.previewUrl)
      return cur.filter((p) => p.id !== id)
    })
  }, [])

  const clearAll = useCallback(() => {
    for (const p of pending) URL.revokeObjectURL(p.previewUrl)
    setPending([])
  }, [pending])

  const providerLabel = useMemo(
    () => getProviderDisplayName(activeProvider),
    [activeProvider]
  )

  return (
    <div className="flex flex-col gap-3 p-3 h-full overflow-auto">
      {/* Provider info bar */}
      <div className="flex items-center justify-between rounded border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm">
        <div>
          <div className="text-xs text-[var(--text-secondary)]">当前图床</div>
          <div className="font-medium">{providerLabel}</div>
        </div>
        <select
          className="rounded border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1 text-xs"
          value={activeProvider}
          onChange={(e) => onProviderChange(e.target.value as ProviderId)}
        >
          {Object.values(PROVIDERS).map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName}
            </option>
          ))}
        </select>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={onPick}
        className={`flex flex-col items-center justify-center rounded border-2 border-dashed cursor-pointer transition-colors ${
          dragOver
            ? 'border-[var(--theme-color)] bg-[var(--bg-hover)]'
            : 'border-[var(--border-color)] hover:border-[var(--theme-color)]'
        }`}
        style={{ minHeight: 120 }}
      >
        <div className="text-sm font-medium">点击或拖入图片上传</div>
        <div className="text-xs text-[var(--text-secondary)] mt-1">支持 PNG / JPG / WebP / GIF</div>
      </div>

      {/* Shortcut buttons */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onClipboard}
          className="flex-1 rounded border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm hover:bg-[var(--bg-hover)]"
        >
          从剪贴板粘贴
        </button>
        <button
          type="button"
          onClick={onPick}
          className="flex-1 rounded border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm hover:bg-[var(--bg-hover)]"
        >
          选择本地文件
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = e.target.files
          if (!files) return
          const list: File[] = []
          for (let i = 0; i < files.length; i++) {
            const f = files[i]
            if (f) list.push(f)
          }
          addFiles(list)
          e.target.value = ''
        }}
      />

      {/* Pending list */}
      {pending.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">待上传 ({pending.length})</div>
            <button
              type="button"
              onClick={clearAll}
              className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              清空
            </button>
          </div>
          {pending.map((p) => (
            <PendingItem
              key={p.id}
              item={p}
              onUpload={() => startUpload(p.id)}
              onCancel={() => cancelUpload(p.id)}
              onRemove={() => removeFile(p.id)}
              onInsert={() => {
                if (!p.result || !settings) return
                const { text } = insertIntoNote(
                  p.result,
                  settings.linkFormat,
                  activeNoteContent
                )
                toast.success('已复制插入文本', { description: text })
              }}
              formatBytes={formatBytes}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface PendingItemProps {
  item: PendingFile
  onUpload: () => void
  onCancel: () => void
  onRemove: () => void
  onInsert: () => void
  formatBytes: (n: number) => string
}

function PendingItem({ item, onUpload, onCancel, onRemove, onInsert, formatBytes }: PendingItemProps): ReactNode {
  return (
    <div className="rounded border border-[var(--border-color)] bg-[var(--bg-secondary)] p-2 flex gap-2">
      <img
        src={item.previewUrl}
        alt={item.filename}
        className="w-14 h-14 object-cover rounded border border-[var(--border-color)]"
      />
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="text-xs font-medium truncate" title={item.filename}>
          {item.filename}
        </div>
        <div className="text-xs text-[var(--text-secondary)]">{formatBytes(item.size)}</div>

        {item.status === 'uploading' && (
          <div className="mt-1">
            <div className="h-1.5 w-full rounded bg-[var(--bg-primary)] overflow-hidden">
              <div
                className="h-full bg-[var(--theme-color)] transition-all"
                style={{ width: `${item.progress}%` }}
              />
            </div>
            <div className="text-xs text-[var(--text-secondary)] mt-1">{item.progress}%</div>
          </div>
        )}

        {item.status === 'error' && (
          <div className="text-xs text-red-500 mt-1 truncate" title={item.error}>
            {item.error}
          </div>
        )}

        {item.status === 'done' && item.result && (
          <div className="mt-1">
            <UploadResultCard result={item.result} compact onInsert={onInsert} />
          </div>
        )}

        <div className="flex gap-1 mt-1">
          {item.status === 'idle' && (
            <button
              type="button"
              onClick={onUpload}
              className="text-xs rounded px-2 py-0.5 bg-[var(--theme-color)] text-white hover:opacity-90"
            >
              上传
            </button>
          )}
          {item.status === 'uploading' && (
            <button
              type="button"
              onClick={onCancel}
              className="text-xs rounded px-2 py-0.5 border border-[var(--border-color)] hover:bg-[var(--bg-hover)]"
            >
              取消
            </button>
          )}
          {(item.status === 'idle' || item.status === 'error' || item.status === 'done') && (
            <button
              type="button"
              onClick={onRemove}
              className="text-xs rounded px-2 py-0.5 border border-[var(--border-color)] hover:bg-[var(--bg-hover)]"
            >
              移除
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
