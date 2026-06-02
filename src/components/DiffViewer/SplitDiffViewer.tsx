/**
 * SplitDiffViewer - Side-by-side diff comparison component
 * Shows local content on the left and remote content on the right
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface SplitDiffViewerProps {
  localContent: string
  remoteContent: string
  localLabel?: string
  remoteLabel?: string
}

interface DiffLine {
  type: 'context' | 'added' | 'removed' | 'empty'
  content: string
  lineNum: number
}

function computeDiffLines(localLines: string[], remoteLines: string[]): { left: DiffLine[], right: DiffLine[] } {
  // Simple LCS-based diff algorithm
  const m = localLines.length
  const n = remoteLines.length

  // Build LCS table
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (localLines[i - 1] === remoteLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  // Backtrack to find diff
  const left: DiffLine[] = []
  const right: DiffLine[] = []
  let i = m, j = n

  const changes: Array<{ type: 'context' | 'added' | 'removed'; localIdx: number; remoteIdx: number }> = []

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && localLines[i - 1] === remoteLines[j - 1]) {
      changes.unshift({ type: 'context', localIdx: i - 1, remoteIdx: j - 1 })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      changes.unshift({ type: 'added', localIdx: -1, remoteIdx: j - 1 })
      j--
    } else {
      changes.unshift({ type: 'removed', localIdx: i - 1, remoteIdx: -1 })
      i--
    }
  }

  // Build paired lines
  let li = 0, ri = 0
  for (const change of changes) {
    if (change.type === 'context') {
      left.push({ type: 'context', content: localLines[change.localIdx], lineNum: li + 1 })
      right.push({ type: 'context', content: remoteLines[change.remoteIdx], lineNum: ri + 1 })
      li++
      ri++
    } else if (change.type === 'removed') {
      left.push({ type: 'removed', content: localLines[change.localIdx], lineNum: li + 1 })
      right.push({ type: 'empty', content: '', lineNum: -1 })
      li++
    } else {
      left.push({ type: 'empty', content: '', lineNum: -1 })
      right.push({ type: 'added', content: remoteLines[change.remoteIdx], lineNum: ri + 1 })
      ri++
    }
  }

  return { left, right }
}

function SplitDiffViewer({ localContent, remoteContent, localLabel, remoteLabel }: SplitDiffViewerProps) {
  const { t } = useTranslation()
  const [diffData, setDiffData] = useState<{ left: DiffLine[], right: DiffLine[] }>({ left: [], right: [] })
  const leftRef = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)
  const isSyncingScroll = useRef(false)

  useEffect(() => {
    console.log('[SplitDiffViewer] localContent length:', localContent?.length, 'remoteContent length:', remoteContent?.length)
    console.log('[SplitDiffViewer] localContent preview:', localContent?.substring(0, 100))
    console.log('[SplitDiffViewer] remoteContent preview:', remoteContent?.substring(0, 100))
    const localLines = localContent.split('\n')
    const remoteLines = remoteContent.split('\n')
    console.log('[SplitDiffViewer] localLines count:', localLines.length, 'remoteLines count:', remoteLines.length)
    const result = computeDiffLines(localLines, remoteLines)
    console.log('[SplitDiffViewer] result left count:', result.left.length, 'right count:', result.right.length)
    setDiffData(result)
  }, [localContent, remoteContent])

  // Sync scrolling between left and right panels
  const handleScroll = (source: 'left' | 'right') => {
    if (isSyncingScroll.current) return
    isSyncingScroll.current = true

    const sourceEl = source === 'left' ? leftRef.current : rightRef.current
    const targetEl = source === 'left' ? rightRef.current : leftRef.current

    if (sourceEl && targetEl) {
      targetEl.scrollTop = sourceEl.scrollTop
      targetEl.scrollLeft = sourceEl.scrollLeft
    }

    requestAnimationFrame(() => {
      isSyncingScroll.current = false
    })
  }

  const renderLine = (line: DiffLine) => {
    let bgColor = ''
    let textColor = 'var(--text-primary)'

    switch (line.type) {
      case 'added':
        bgColor = 'rgba(34, 197, 94, 0.15)'
        textColor = '#22c55e'
        break
      case 'removed':
        bgColor = 'rgba(239, 68, 68, 0.15)'
        textColor = '#ef4444'
        break
      case 'empty':
        bgColor = 'var(--bg-tertiary, rgba(0,0,0,0.05))'
        break
    }

    return (
      <div
        className="flex"
        style={{ backgroundColor: bgColor, minHeight: line.type === 'empty' ? '20px' : undefined }}
      >
        <span
          className="w-10 shrink-0 text-right pr-2 py-0.5 select-none text-[11px]"
          style={{ color: 'var(--text-muted)' }}
        >
          {line.lineNum > 0 ? line.lineNum : ''}
        </span>
        <pre
          className="flex-1 py-0.5 px-2 whitespace-pre-wrap break-all text-xs font-mono"
          style={{ color: textColor, margin: 0 }}
        >
          {line.content}
        </pre>
      </div>
    )
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left panel - Local */}
      <div className="flex-1 flex flex-col border-r" style={{ borderColor: 'var(--border-color)' }}>
        <div className="flex items-center justify-center h-7 px-3 text-xs font-medium shrink-0 border-b"
          style={{ borderColor: 'var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-muted)' }}>
          {localLabel || t('git.local')}
        </div>
        <div
          ref={leftRef}
          className="flex-1 overflow-auto"
          onScroll={() => handleScroll('left')}
        >
          <div className="font-mono text-xs">
            {diffData.left.map((line, idx) => (
              <div key={`left-${idx}`}>{renderLine(line)}</div>
            ))}
          </div>
        </div>
      </div>

      {/* Right panel - Remote */}
      <div className="flex-1 flex flex-col">
        <div className="flex items-center justify-center h-7 px-3 text-xs font-medium shrink-0 border-b"
          style={{ borderColor: 'var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-muted)' }}>
          {remoteLabel || t('git.remote')}
        </div>
        <div
          ref={rightRef}
          className="flex-1 overflow-auto"
          onScroll={() => handleScroll('right')}
        >
          <div className="font-mono text-xs">
            {diffData.right.map((line, idx) => (
              <div key={`right-${idx}`}>{renderLine(line)}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default SplitDiffViewer
