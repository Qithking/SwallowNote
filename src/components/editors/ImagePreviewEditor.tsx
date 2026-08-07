/**
 * ImagePreviewEditor — 只读图片预览编辑器
 * Source: spec/image-preview AC-1, AC-4, AC-5, AC-6, AC-7
 *
 * 交互:滚轮缩放 + 拖拽平移 + 双击还原
 * 加载失败:显示文件名 + 错误信息
 */
import { useState, useRef, useCallback, useEffect } from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import { useTranslation } from 'react-i18next'
import { FileCode } from 'lucide-react'
import type { EditorProps } from './editor-registry'

const MIN_SCALE = 0.1
const MAX_SCALE = 10
const SCALE_STEP = 0.15

export function ImagePreviewEditor({ tab }: EditorProps) {
  const { t } = useTranslation()
  const [error, setError] = useState<string | null>(null)
  const [scale, setScale] = useState(1)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const dragStart = useRef<{ x: number; y: number; posX: number; posY: number } | null>(null)

  const src = convertFileSrc(tab.path)

  const handleError = useCallback(() => {
    setError(t('editor.image.loadFailed'))
  }, [t])

  const handleLoad = useCallback(() => {
    setError(null)
  }, [])

  // 滚轮缩放
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? -SCALE_STEP : SCALE_STEP
    setScale((s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s + delta)))
  }, [])

  // 拖拽平移
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    dragStart.current = {
      x: e.clientX,
      y: e.clientY,
      posX: position.x,
      posY: position.y,
    }
  }, [position])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragStart.current) return
    const dx = e.clientX - dragStart.current.x
    const dy = e.clientY - dragStart.current.y
    setPosition({
      x: dragStart.current.posX + dx,
      y: dragStart.current.posY + dy,
    })
  }, [])

  const handleMouseUp = useCallback(() => {
    dragStart.current = null
  }, [])

  // 双击还原
  const handleDoubleClick = useCallback(() => {
    setScale(1)
    setPosition({ x: 0, y: 0 })
  }, [])

  // 全局 mouseup(鼠标移出组件也能停止拖拽)
  useEffect(() => {
    const onUp = () => { dragStart.current = null }
    window.addEventListener('mouseup', onUp)
    return () => window.removeEventListener('mouseup', onUp)
  }, [])

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[var(--bg-primary-gradient,var(--bg-primary))]">
        <div className="text-center">
          <FileCode size={48} className="mx-auto mb-4 opacity-40" />
          <p className="text-lg text-[var(--text-muted)]">{t('editor.image.loadFailed')}</p>
          <p className="text-sm text-[var(--text-muted)] mt-2">{tab.name}</p>
        </div>
      </div>
    )
  }

  return (
    <div
      className="w-full h-full overflow-hidden flex items-center justify-center cursor-grab active:cursor-grabbing select-none"
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onDoubleClick={handleDoubleClick}
    >
      <img
        src={src}
        alt={tab.name}
        onError={handleError}
        onLoad={handleLoad}
        draggable={false}
        className="max-w-[80%] max-h-[80%] object-contain pointer-events-none"
        style={{
          transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
          transition: dragStart.current ? 'none' : 'transform 0.1s ease-out',
        }}
      />
    </div>
  )
}
