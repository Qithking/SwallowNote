/**
 * BlockResizeHandles — 统一的 block 宽高拖拽手柄组件
 *
 * 供 MarkmapBlockEditor / KatexBlockEditor / MermaidBlockEditor 共用，
 * 四个方向手柄（left / right / bottom / corner）统一样式和交互。
 */
import { GripVertical, GripHorizontal } from 'lucide-react'
import type { ResizeHandle } from '@/hooks/useBlockResize'

interface BlockResizeHandlesProps {
  /** 鼠标/触摸按下回调，由 useBlockResize.startResize 提供 */
  onStartResize: (handle: ResizeHandle, e: React.MouseEvent | React.TouchEvent) => void
  /** group-hover 前缀（markmap / katex / mermaid），控制 hover 显示 */
  groupHoverClass: string
}

export function BlockResizeHandles({ onStartResize, groupHoverClass }: BlockResizeHandlesProps) {
  const base = `opacity-0 ${groupHoverClass}:opacity-100 transition-opacity`

  return (
    <>
      {/* Left resize handle */}
      <div
        className={`absolute left-0 top-0 h-full w-2 cursor-ew-resize ${base} bg-primary/20 hover:bg-primary/40 flex items-center justify-center`}
        onMouseDown={(e) => onStartResize('left', e)}
        onTouchStart={(e) => onStartResize('left', e)}
        title="拖拽调整宽度"
      >
        <GripVertical className="w-3 h-3 text-primary/60 rotate-90" />
      </div>
      {/* Right resize handle */}
      <div
        className={`absolute right-0 top-0 h-full w-2 cursor-ew-resize ${base} bg-primary/20 hover:bg-primary/40 flex items-center justify-center`}
        onMouseDown={(e) => onStartResize('right', e)}
        onTouchStart={(e) => onStartResize('right', e)}
        title="拖拽调整宽度"
      >
        <GripVertical className="w-3 h-3 text-primary/60 rotate-90" />
      </div>
      {/* Bottom resize handle */}
      <div
        className={`absolute bottom-0 left-0 w-full h-2 cursor-ns-resize ${base} bg-primary/20 hover:bg-primary/40 flex items-center justify-center`}
        onMouseDown={(e) => onStartResize('bottom', e)}
        onTouchStart={(e) => onStartResize('bottom', e)}
        title="拖拽调整高度"
      >
        <GripHorizontal className="w-3 h-3 text-primary/60" />
      </div>
      {/* Corner resize handle (bottom-right) */}
      <div
        className={`absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize ${base} bg-primary/30 hover:bg-primary/50 rounded-tl-sm flex items-center justify-center`}
        onMouseDown={(e) => onStartResize('corner', e)}
        onTouchStart={(e) => onStartResize('corner', e)}
        title="拖拽调整宽高"
      >
        <svg className="w-2.5 h-2.5 text-primary/60" viewBox="0 0 10 10" fill="currentColor">
          <circle cx="8" cy="8" r="1.2" />
          <circle cx="4" cy="8" r="1.2" />
          <circle cx="8" cy="4" r="1.2" />
        </svg>
      </div>
    </>
  )
}
