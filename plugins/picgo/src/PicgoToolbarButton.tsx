/** 工具栏按钮：切换 picgo 右侧面板可见性 */
import { useCallback } from 'react'
import type { ReactNode } from 'react'
import type { ToolbarButtonProps } from '@swallow-note/plugin-sdk'
import { PicgoIcon } from './PicgoIcon'

export function PicgoToolbarButton(props: ToolbarButtonProps): ReactNode {
  const { size, isActive, activate, deactivate } = props

  const handleClick = useCallback(() => {
    if (isActive) deactivate()
    else activate()
  }, [isActive, activate, deactivate])

  return (
    <button
      type="button"
      onClick={handleClick}
      className="flex items-center justify-center w-6 h-6 rounded hover:bg-[var(--bg-hover)] cursor-pointer"
      style={{
        color: isActive ? 'var(--theme-color)' : 'var(--text-primary)',
      }}
      title="图床"
      aria-label="图床"
      aria-pressed={isActive}
    >
      <PicgoIcon size={size} />
    </button>
  )
}
