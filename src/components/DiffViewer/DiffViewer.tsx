import { useEffect, useState } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Loader2 } from 'lucide-react'

interface DiffViewerProps {
  diffContent: string
}

interface DiffLine {
  type: 'header' | 'added' | 'removed' | 'context' | 'hunk'
  content: string
  oldLineNum?: number
  newLineNum?: number
}

function parseDiff(diffContent: string): DiffLine[] {
  const lines: DiffLine[] = []
  const rawLines = diffContent.split('\n')
  
  let oldLineNum = 0
  let newLineNum = 0
  let inHunk = false
  
  for (const line of rawLines) {
    if (line.startsWith('diff --git')) {
      lines.push({ type: 'header', content: line })
      inHunk = false
    } else if (line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ ')) {
      lines.push({ type: 'header', content: line })
    } else if (line.startsWith('@@')) {
      // Parse hunk header: @@ -oldStart,oldCount +newStart,newCount @@
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      if (match) {
        oldLineNum = parseInt(match[1], 10)
        newLineNum = parseInt(match[2], 10)
      }
      lines.push({ type: 'hunk', content: line, oldLineNum, newLineNum })
      inHunk = true
    } else if (inHunk) {
      if (line.startsWith('+')) {
        lines.push({ type: 'added', content: line, newLineNum })
        newLineNum++
      } else if (line.startsWith('-')) {
        lines.push({ type: 'removed', content: line, oldLineNum })
        oldLineNum++
      } else if (line.startsWith('\\')) {
        // "\ No newline at end of file"
        lines.push({ type: 'context', content: line })
      } else {
        lines.push({ type: 'context', content: line, oldLineNum, newLineNum })
        oldLineNum++
        newLineNum++
      }
    } else {
      lines.push({ type: 'context', content: line })
    }
  }
  
  return lines
}

function DiffViewer({ diffContent }: DiffViewerProps) {
  const [lines, setLines] = useState<DiffLine[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const parsed = parseDiff(diffContent)
    setLines(parsed)
    setLoading(false)
  }, [diffContent])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={24} className="animate-spin text-[var(--text-muted)]" />
      </div>
    )
  }

  if (!diffContent || diffContent.trim() === '') {
    return (
      <div className="flex items-center justify-center h-full text-[var(--text-muted)]">
        <p className="text-sm">暂无差异内容</p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col ">
      <div className="flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="font-mono text-xs">
            {lines.map((line, index) => {
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
                case 'hunk':
                  bgColor = 'var(--bg-hover)'
                  textColor = 'var(--text-muted)'
                  break
                case 'header':
                  textColor = 'var(--text-muted)'
                  break
              }

              return (
                <div
                  key={`${line.type}-${line.oldLineNum}-${line.newLineNum}-${index}`}
                  className="flex"
                  style={{ backgroundColor: bgColor }}
                >
                  {/* Line numbers */}
                  <div className="flex shrink-0 select-none" style={{ minWidth: '80px' }}>
                    <span
                      className="w-10 text-right pr-2 py-0.5"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      {line.oldLineNum || ''}
                    </span>
                    <span
                      className="w-10 text-right pr-2 py-0.5"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      {line.newLineNum || ''}
                    </span>
                  </div>
                  
                  {/* Content */}
                  <pre
                    className="flex-1 py-0.5 px-2 whitespace-pre-wrap break-all"
                    style={{ color: textColor, margin: 0 }}
                  >
                    {line.content}
                  </pre>
                </div>
              )
            })}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}

export default DiffViewer
