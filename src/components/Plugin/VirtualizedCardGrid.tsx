/**
 * VirtualizedCardGrid — a responsive grid that only renders visible
 * rows of plugin cards. Uses `@tanstack/react-virtual` to virtualize
 * the card list, significantly reducing DOM node count for large
 * plugin sets (50+ cards).
 *
 * The component renders its own scrollable container with
 * `overflow-y: auto` and fills the available height via `flex: 1`.
 * Each row is rendered as a CSS grid with dynamic column count
 * detected via ResizeObserver.
 */
import { useRef, useState, useEffect, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

const MIN_CARD_WIDTH = 280
const CARD_GAP = 12
const OVERSCAN = 4

interface VirtualizedCardGridProps<T> {
  items: T[]
  renderItem: (item: T, index: number) => ReactNode
  /** Estimated row height in px. Used for scroll height estimation. */
  estimatedRowHeight?: number
  className?: string
}

export function VirtualizedCardGrid<T>({
  items,
  renderItem,
  estimatedRowHeight = 200,
  className = 'pa-market-grid pa-installed-grid',
}: VirtualizedCardGridProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [columns, setColumns] = useState(3)

  // Detect column count from container width
  // Re-measure when items change to handle initial render with empty list
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const measure = () => {
      const w = el.clientWidth
      const cols = Math.max(1, Math.floor((w + CARD_GAP) / (MIN_CARD_WIDTH + CARD_GAP)))
      setColumns(cols)
    }

    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [items.length])

  const rowCount = Math.ceil(items.length / columns)

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimatedRowHeight,
    overscan: OVERSCAN,
  })

  const virtualRows = virtualizer.getVirtualItems()
  const totalHeight = virtualizer.getTotalSize()

  return (
    <div
      ref={scrollRef}
      className={className}
      style={{ overflowY: 'auto', flex: 1, minHeight: 0, position: 'relative', display: 'block' }}
    >
      <div style={{ height: totalHeight, position: 'relative', width: '100%' }}>
        {virtualRows.map((virtualRow) => {
          const startIndex = virtualRow.index * columns
          const rowItems = items.slice(startIndex, startIndex + columns)
          return (
            <div
              key={virtualRow.index}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
                display: 'grid',
                gridTemplateColumns: `repeat(${columns}, 1fr)`,
                gap: CARD_GAP,
              }}
            >
              {rowItems.map((item, colIdx) =>
                renderItem(item, startIndex + colIdx),
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
