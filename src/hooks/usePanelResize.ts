import { useState, useCallback, useEffect, useRef } from 'react'
import { useUIStore } from '@/stores'
import type { UIState } from '@/stores'
import { logger } from '@/lib/logger'

export function usePanelResize(saveSessionStateNow: () => Promise<void>) {
  const setSidebarWidth = useUIStore((s: UIState) => s.setSidebarWidth)
  const setRightPanelWidth = useUIStore((s: UIState) => s.setRightPanelWidth)

  const [isDraggingLeft, setIsDraggingLeft] = useState(false)
  const [isDraggingRight, setIsDraggingRight] = useState(false)
  const [isHoveringLeft, setIsHoveringLeft] = useState(false)
  const [isHoveringRight, setIsHoveringRight] = useState(false)
  const rafRef = useRef<number | null>(null)

  const handleMouseDownLeft = useCallback(() => {
    setIsDraggingLeft(true)
  }, [])

  const handleMouseMoveLeft = useCallback((e: MouseEvent) => {
    if (!isDraggingLeft) return
    if (rafRef.current) return
    const clientX = e.clientX
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      const newWidth = clientX - 48
      const maxWidth = window.innerWidth * 0.5
      if (newWidth >= 200 && newWidth <= maxWidth) {
        setSidebarWidth(newWidth)
      }
    })
  }, [isDraggingLeft, setSidebarWidth])

  const handleMouseDownRight = useCallback(() => {
    setIsDraggingRight(true)
  }, [])

  const handleMouseMoveRight = useCallback((e: MouseEvent) => {
    if (!isDraggingRight) return
    if (rafRef.current) return
    const clientX = e.clientX
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      const newWidth = window.innerWidth - clientX
      const maxWidth = window.innerWidth * 0.5
      if (newWidth >= 250 && newWidth <= maxWidth) {
        setRightPanelWidth(newWidth)
      }
    })
  }, [isDraggingRight, setRightPanelWidth])

  const handleMouseUp = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    setIsDraggingLeft(false)
    setIsDraggingRight(false)
    saveSessionStateNow().catch((err) => logger.error('app', 'Session save failed:', err))
  }, [saveSessionStateNow])

  useEffect(() => {
    if (isDraggingLeft || isDraggingRight) {
      document.body.style.userSelect = 'none'
      document.body.style.webkitUserSelect = 'none'
    } else {
      document.body.style.userSelect = ''
      document.body.style.webkitUserSelect = ''
    }
    return () => {
      document.body.style.userSelect = ''
      document.body.style.webkitUserSelect = ''
    }
  }, [isDraggingLeft, isDraggingRight])

  useEffect(() => {
    if (isDraggingLeft) {
      document.addEventListener('mousemove', handleMouseMoveLeft)
      document.addEventListener('mouseup', handleMouseUp)
      return () => {
        document.removeEventListener('mousemove', handleMouseMoveLeft)
        document.removeEventListener('mouseup', handleMouseUp)
      }
    }
    if (isDraggingRight) {
      document.addEventListener('mousemove', handleMouseMoveRight)
      document.addEventListener('mouseup', handleMouseUp)
      return () => {
        document.removeEventListener('mousemove', handleMouseMoveRight)
        document.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [isDraggingLeft, isDraggingRight, handleMouseMoveLeft, handleMouseMoveRight, handleMouseUp])

  return {
    isDraggingLeft,
    isDraggingRight,
    isHoveringLeft,
    isHoveringRight,
    setIsHoveringLeft,
    setIsHoveringRight,
    handleMouseDownLeft,
    handleMouseDownRight,
  }
}
