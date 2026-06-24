/**
 * FullPathTooltip — 自定义浮层组件
 *
 * 用于显示完整文件路径。与 Radix Tooltip 不同，本组件：
 * - 使用 React Portal 渲染到 document.body，绕开任何父级 stacking context
 * - 使用 position: fixed，定位完全脱离侧边栏/容器边界
 * - 显示位置在触发元素正下方，水平方向可超出侧边栏到主编辑区
 */
import { cloneElement, isValidElement, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface FullPathTooltipProps {
  /** 触发元素 */
  children: React.ReactElement
  /** 提示内容（完整文件路径） */
  content: string
  /** 延迟显示时间（ms） */
  delay?: number
}

export function FullPathTooltip({ children, content, delay = 300 }: FullPathTooltipProps) {
  const [visible, setVisible] = useState(false)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const triggerRef = useRef<HTMLElement | null>(null)

  // 给触发元素注入 ref，用于获取位置
  const trigger = isValidElement(children)
    ? cloneElement(children as React.ReactElement<Record<string, unknown>>, {
        ref: (node: HTMLElement | null) => {
          triggerRef.current = node
        },
      })
    : children

  const showTooltip = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect()
        // Tooltip 显示在触发元素正下方，左侧对齐
        setPosition({
          left: rect.left,
          top: rect.bottom + 6,
        })
        setVisible(true)
      }
    }, delay)
  }

  const hideTooltip = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setVisible(false)
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  return (
    <>
      <span
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
        style={{ display: 'inline-block' }}
      >
        {trigger}
      </span>
      {visible && position && createPortal(
        <div
          style={{
            position: 'fixed',
            left: `${position.left}px`,
            top: `${position.top}px`,
            zIndex: 9999,
            maxWidth: 'min(600px, 80vw)',
            backgroundColor: '#000',
            color: '#fff',
            padding: '6px 10px',
            borderRadius: '6px',
            fontSize: '12px',
            lineHeight: '1.4',
            wordBreak: 'break-all',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
            pointerEvents: 'none',
          }}
        >
          {content}
        </div>,
        document.body,
      )}
    </>
  )
}
