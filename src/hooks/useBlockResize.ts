/**
 * useBlockResize — 统一的 BlockNote 自定义 block 宽高拖拽调整 hook
 *
 * 供 MarkmapBlockEditor / KatexBlockEditor / MermaidBlockEditor 共用，
 * 统一 resize 状态管理、事件监听、持久化逻辑和 min/max 约束。
 */
import { useEffect, useState, useRef, useCallback } from 'react'

export type ResizeHandle = 'left' | 'right' | 'bottom' | 'corner'

interface ResizeState {
  handleUsed: ResizeHandle
  initialWidth: number
  initialHeight: number
  initialClientX: number
  initialClientY: number
}

/** 约束常量 */
export const RESIZE_CONSTRAINTS = {
  MIN_WIDTH: 200,
  MAX_WIDTH_FALLBACK: 1200,
  MIN_HEIGHT: 120,
  MAX_HEIGHT: 800,
} as const

interface UseBlockResizeOptions {
  /** 初始宽度（来自 block props，0 表示未设置） */
  initialWidth: number
  /** 初始高度（来自 block props，0 表示未设置） */
  initialHeight: number
  /** BlockNote editor 实例 */
  editor: any
  /** BlockNote block 实例 */
  block: any
  /** 容器 DOM ref，用于获取 fallback 尺寸 */
  containerRef: React.RefObject<HTMLElement | null>
}

export function useBlockResize({
  initialWidth,
  initialHeight,
  editor,
  block,
  containerRef,
}: UseBlockResizeOptions) {
  const [resizeState, setResizeState] = useState<ResizeState | undefined>(undefined)
  const [currentWidth, setCurrentWidth] = useState<number>(initialWidth || 0)
  const [currentHeight, setCurrentHeight] = useState<number>(initialHeight || 0)

  // Refs 用于在事件回调中获取最新值（避免闭包过期）
  const currentWidthRef = useRef(currentWidth)
  const currentHeightRef = useRef(currentHeight)

  useEffect(() => { currentWidthRef.current = currentWidth }, [currentWidth])
  useEffect(() => { currentHeightRef.current = currentHeight }, [currentHeight])

  // 同步外部 props 变化
  useEffect(() => {
    if (initialWidth && initialWidth !== currentWidthRef.current) setCurrentWidth(initialWidth)
  }, [initialWidth])
  useEffect(() => {
    if (initialHeight && initialHeight !== currentHeightRef.current) setCurrentHeight(initialHeight)
  }, [initialHeight])

  // 拖拽事件监听
  useEffect(() => {
    if (!resizeState) return

    const getMaxWidth = () =>
      editor?.domElement?.firstElementChild?.clientWidth || RESIZE_CONSTRAINTS.MAX_WIDTH_FALLBACK

    const handleMouseMove = (e: MouseEvent | TouchEvent) => {
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY
      const maxWidth = getMaxWidth()

      if (
        resizeState.handleUsed === 'left' ||
        resizeState.handleUsed === 'right' ||
        resizeState.handleUsed === 'corner'
      ) {
        let newWidth: number
        if (resizeState.handleUsed === 'left') {
          newWidth = resizeState.initialWidth + (resizeState.initialClientX - clientX)
        } else {
          newWidth = resizeState.initialWidth + (clientX - resizeState.initialClientX)
        }
        setCurrentWidth(
          Math.min(Math.max(newWidth, RESIZE_CONSTRAINTS.MIN_WIDTH), maxWidth)
        )
      }

      if (resizeState.handleUsed === 'bottom' || resizeState.handleUsed === 'corner') {
        const newHeight = resizeState.initialHeight + (clientY - resizeState.initialClientY)
        setCurrentHeight(
          Math.min(Math.max(newHeight, RESIZE_CONSTRAINTS.MIN_HEIGHT), RESIZE_CONSTRAINTS.MAX_HEIGHT)
        )
      }
    }

    const handleMouseUp = () => {
      setResizeState(undefined)
      editor?.updateBlock(block, {
        props: { width: currentWidthRef.current, height: currentHeightRef.current },
      })
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('touchmove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    window.addEventListener('touchend', handleMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('touchmove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      window.removeEventListener('touchend', handleMouseUp)
    }
  }, [resizeState, editor, block])

  const startResize = useCallback(
    (handle: ResizeHandle, e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY
      setResizeState({
        handleUsed: handle,
        initialWidth: currentWidth || containerRef.current?.clientWidth || 400,
        initialHeight: currentHeight || containerRef.current?.clientHeight || 300,
        initialClientX: clientX,
        initialClientY: clientY,
      })
    },
    [currentWidth, currentHeight, containerRef]
  )

  return {
    currentWidth,
    currentHeight,
    /** 最新宽度的 ref，适合在异步回调中使用（避免闭包过期） */
    currentWidthRef,
    /** 最新高度的 ref，适合在异步回调中使用（避免闭包过期） */
    currentHeightRef,
    startResize,
    isResizing: !!resizeState,
  }
}
